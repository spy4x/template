/**
 * The app's sign-in, wired onto `@spy4x/server/sign-in` and `@spy4x/server/auth`: sessions, the
 * session cookie, the guards, password hashing and authenticator-app codes all come from the
 * package; this file decides what the template adds on top of them.
 *
 * - **Usernames, not addresses.** The template signs in with a free username: the package's
 *   `createPasswordSignIn` with `normalizeSubject: normalizeUsername` writes one `password` key per
 *   user whose subject is the normalised username. Password reset is not wired; the package refuses
 *   it in this mode, because it mails the subject.
 * - **One sign-up transaction.** The auth user and key, the session, the `users` profile row (same
 *   id) and the personal group are written in one `db.begin()`: the sign-up provider is built over
 *   that transaction's stores.
 * - **Authenticator app.** Secret and last accepted time step live in `user_totp`; `users.mfa`
 *   keeps its three states.
 *
 * Reads no environment and imports no singleton, so the integration tests construct it against
 * their own schema.
 *
 * @module
 */

import type { Context } from "hono"
import {
  type Auth,
  type AuthState,
  createAuth,
  createPasswordHasher,
  generateTotpSecret,
  type PasswordHasher,
  SecondFactorStatus,
  SessionCookie,
  SessionManager,
  type SessionStore,
  totpEnrolment,
  verifyTotp,
} from "@spy4x/server/sign-in"
import type { AuthSessionRecord } from "@spy4x/server/auth"
import {
  createPasswordSignIn,
  type PasswordSignIn,
  PasswordSignInError,
  type PasswordSignInOptions,
} from "@spy4x/server/auth/password"
import { GroupError } from "@domain/groups"
import { type User, UserMFAStatus, UserRole } from "@domain/identity"
import type { AppDbBase } from "./db-base.ts"

/** Longest username, in characters (code points), after normalisation. */
export const USERNAME_MAX_LENGTH = 50

/** What `c.get("auth")` holds for a signed-in request. */
export type AppAuthState = AuthState<AuthSessionRecord, User>

/** A user who just signed up or signed in, and the session the cookie now carries. */
export interface SignedIn {
  user: User
  session: AuthSessionRecord
}

/** The answer of {@link SignIn.connectTotpStart}: an error, or the enrolment to show. */
export type TotpConnectStart =
  | { error: string; qrcode: null; secret: null }
  | { error: null; qrcode: string; secret: string }

/** Options for {@link createSignIn}. */
export interface SignInOptions {
  db: AppDbBase
  /** Pepper for password hashes and session tokens, at least 32 characters. */
  pepper: string
  /** Secret that signs the session cookie, at least 32 characters. */
  cookieSecret: string
  /** Adds `Secure` to the cookies. `false` only for local development over plain HTTP. */
  secureCookie: boolean
  /** Session lifetime in minutes. */
  sessionMinutes: number
  /** Service name shown in the authenticator app. */
  totpIssuer: string
  /** Hashes and verifies passwords. Defaults to `createPasswordHasher` with `pepper`. */
  hasher?: PasswordHasher
}

/** The sign-in operations the routes call. */
export interface SignIn {
  /** Middleware and guards from `createAuth`. */
  auth: Auth<AuthSessionRecord, User>
  /**
   * Creates the auth user, password key, profile, personal group and session in one transaction
   * and sets the cookie. `null` when the username is empty, too long or taken.
   *
   * @param personalGroupId The id of the new personal group. Defaults to a random UUID.
   */
  signUp(
    c: Context,
    username: string,
    password: string,
    personalGroupId?: string,
  ): Promise<SignedIn | null>
  /** Checks the password, starts a session and sets the cookie. `null` when refused. */
  signIn(c: Context, username: string, password: string): Promise<SignedIn | null>
  /** Signs out the session in the request's cookie, if any, and clears the cookie. */
  signOut(c: Context): Promise<void>
  /** Starts authenticator-app enrolment, or returns the unfinished one. */
  connectTotpStart(state: AppAuthState): Promise<TotpConnectStart>
  /** Finishes enrolment with a code; signs out every other session of the user. */
  connectTotpFinish(state: AppAuthState, code: string): Promise<boolean>
  /** Gives the second factor for this session. A code is never accepted twice. */
  checkTotp(state: AppAuthState, code: string): Promise<boolean>
  /**
   * Removes a finished enrolment, and lets the user's other sessions that still owed the second
   * factor through without it.
   */
  disconnectTotp(state: AppAuthState): Promise<boolean>
  /**
   * Replaces the password, signs out every other session and sets the new session's cookie.
   * `false` when the current password is wrong.
   */
  changePassword(
    c: Context,
    state: AppAuthState,
    password: string,
    newPassword: string,
  ): Promise<boolean>
  /** Marks every active session that has run out as expired. */
  expireSessions(): Promise<void>
}

/**
 * Lower-cases and trims a username, as the template always did. `null` when it is not a string, or
 * the result is empty, longer than {@link USERNAME_MAX_LENGTH}, or holds text Postgres cannot store
 * as given (NUL, a lone surrogate). Never throws: the package's `normalizeSubject` must not.
 */
export function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const username = raw.trim().toLowerCase()
  const length = Array.from(username).length
  if (length < 1 || length > USERNAME_MAX_LENGTH) return null
  if (username.includes("\u0000") || !username.isWellFormed()) return null
  return username
}

/** Builds the app's sign-in over the package building blocks. */
export function createSignIn(options: SignInOptions): SignIn {
  const { db } = options
  const sessionsOver = (store: SessionStore<AuthSessionRecord>) =>
    new SessionManager<AuthSessionRecord>({
      store,
      pepper: options.pepper,
      durationMinutes: options.sessionMinutes,
    })
  const sessions = sessionsOver(db.sessionStore)
  const cookie = new SessionCookie({ secret: options.cookieSecret, secure: options.secureCookie })
  const hasher = options.hasher ?? createPasswordHasher({ pepper: options.pepper })

  const auth = createAuth<AuthSessionRecord, User>({
    sessions,
    cookie,
    async loadUser(userId) {
      const user = await db.user.findOne({ id: userId })
      if (!user) return null
      try {
        await db.group.ensurePersonal({ id: crypto.randomUUID(), name: "Personal" }, user.id)
      } catch (error) {
        if (error instanceof GroupError && error.code === "USER_NOT_ACTIVE") return null
        throw error
      }
      return user
    },
    hasSecondFactor: (user) => user.mfa === UserMFAStatus.CONFIGURED,
  })

  /** What `secondFactorFor` answers for the auth user's `users` row, or `null` without one. */
  const secondFactorFrom =
    (decide: (user: User | null) => SecondFactorStatus) =>
    async (authUser: { id: number }): Promise<SecondFactorStatus> =>
      decide(await db.user.findOne({ id: authUser.id }) ?? null)

  /**
   * The package's password provider, by username. Each instance makes one dummy hash when it is
   * created, for the equal work of a sign-in to a missing account.
   */
  const passwordsOver = (
    options: Pick<PasswordSignInOptions, "store" | "sessions"> & Partial<PasswordSignInOptions>,
  ): PasswordSignIn =>
    createPasswordSignIn({ hasher, normalizeSubject: normalizeUsername, ...options })

  // Sign-in: a user with an authenticator app owes it. A user without a profile row gets no
  // session at all, as before: the throw stops the provider before `sessions.create`.
  const signInPasswords = passwordsOver({
    store: db.authStore,
    sessions,
    secondFactorFor: secondFactorFrom((user) => {
      if (!user) throw new MissingProfileError()
      return user.mfa === UserMFAStatus.CONFIGURED
        ? SecondFactorStatus.Pending
        : SecondFactorStatus.NotRequired
    }),
  })
  // Password change: the session that changed it already gave the second factor.
  const changePasswords = passwordsOver({
    store: db.authStore,
    sessions,
    secondFactorFor: secondFactorFrom((user) =>
      user?.mfa === UserMFAStatus.CONFIGURED
        ? SecondFactorStatus.Completed
        : SecondFactorStatus.NotRequired
    ),
  })

  return {
    auth,

    async signUp(c, rawUsername, password, personalGroupId = crypto.randomUUID()) {
      // Checked here too, so a refused username opens no transaction and makes no provider.
      if (normalizeUsername(rawUsername) === null) return null
      let created
      try {
        created = await db.begin(async (tx) => {
          // Built over the transaction's stores, so the auth user, key and session join it.
          const signedUp = await passwordsOver({
            store: tx.authStore,
            sessions: sessionsOver(tx.sessionStore),
            // The route schema is the sign-up length rule (8 to 50 UTF-16 units), as before; the
            // package's own minimum counts code points and would refuse some passwords it accepts.
            minPasswordLength: 1,
          }).signUp({ email: rawUsername, password })
          const user = await tx.user.createForAuthUser(signedUp.user.id, {
            firstName: "",
            lastName: "",
            mfa: UserMFAStatus.NOT_CONFIGURED,
            role: UserRole.VIEWER,
            lastLoginAt: new Date(),
          })
          await tx.group.createPersonal({ id: personalGroupId, name: "Personal" }, user.id)
          return { user, ...signedUp.session }
        })
      } catch (error) {
        if (error instanceof PasswordSignInError) return null
        throw error
      }
      await cookie.set(c, created.session, created.cookieValue)
      return { user: created.user, session: created.session }
    },

    async signIn(c, rawUsername, password) {
      let result
      try {
        result = await signInPasswords.signIn({ email: rawUsername, password })
      } catch (error) {
        if (error instanceof PasswordSignInError || error instanceof MissingProfileError) {
          return null
        }
        throw error
      }
      const { session, cookieValue } = result.session
      await cookie.set(c, session, cookieValue)
      const updated = await db.user.updateOne({
        id: result.user.id,
        data: { lastLoginAt: new Date() },
      })
      // `updateOne` returns `undefined` only when the row vanished after the provider read it - a
      // race, not a normal "not found".
      if (!updated) throw new Error("User not found")
      return { user: updated, session }
    },

    async signOut(c) {
      await auth.endSession(c)
    },

    async connectTotpStart({ user, session }) {
      if (user.mfa === UserMFAStatus.CONFIGURED) {
        return { error: "OTP already activated for your account", qrcode: null, secret: null }
      }
      const key = await db.authStore.findKeyById(session.keyId)
      if (!key) return { error: "User not found", qrcode: null, secret: null }

      const existing = await db.userTotp.find(user.id)
      let secret: string
      if (existing && existing.confirmedAt === null) {
        secret = existing.secret
      } else {
        secret = generateTotpSecret()
        const saved = await db.begin(async (tx) => {
          if (!(await tx.userTotp.savePending(user.id, secret))) return false
          await tx.user.updateOne({
            id: user.id,
            data: { mfa: UserMFAStatus.CONFIGURATION_NOT_FINISHED },
          })
          return true
        })
        if (!saved) {
          return { error: "OTP already activated for your account", qrcode: null, secret: null }
        }
      }
      const { qrCodeSvg } = totpEnrolment(secret, {
        issuer: accountPart(options.totpIssuer, "App"),
        label: accountPart(key.subject, `user ${user.id}`),
      })
      return { error: null, qrcode: qrCodeSvg, secret }
    },

    async connectTotpFinish({ user, session }, code) {
      const enrolment = await db.userTotp.find(user.id)
      if (!enrolment || enrolment.confirmedAt !== null) return false
      const step = verifyTotp(enrolment.secret, code, {
        lastAcceptedStep: enrolment.lastAcceptedStep,
      })
      if (step === null) return false
      try {
        return await db.begin(async (tx) => {
          if (!(await tx.userTotp.confirm(user.id, step))) return false
          await tx.user.updateOne({ id: user.id, data: { mfa: UserMFAStatus.CONFIGURED } })
          const txSessions = sessionsOver(tx.sessionStore)
          await txSessions.completeSecondFactor(session.id)
          await txSessions.signOutUser(user.id, { except: session.id })
          return true
        })
      } catch (error) {
        console.error(error)
        return false
      }
    },

    async checkTotp({ user, session }, code) {
      const enrolment = await db.userTotp.find(user.id)
      if (!enrolment || enrolment.confirmedAt === null) return false
      const step = verifyTotp(enrolment.secret, code, {
        lastAcceptedStep: enrolment.lastAcceptedStep,
      })
      if (step === null) return false
      if (!(await db.userTotp.acceptStep(user.id, step))) return false
      return await sessions.completeSecondFactor(session.id)
    },

    async disconnectTotp({ user }) {
      if (user.mfa === UserMFAStatus.NOT_CONFIGURED) return false
      try {
        return await db.begin(async (tx) => {
          if (!(await tx.userTotp.deleteConfirmed(user.id))) return false
          await tx.user.updateOne({ id: user.id, data: { mfa: UserMFAStatus.NOT_CONFIGURED } })
          // Sessions still waiting for the removed factor would be refused for good otherwise.
          await sessionsOver(tx.sessionStore).clearPendingSecondFactors(user.id)
          return true
        })
      } catch (error) {
        console.error(error)
        return false
      }
    },

    async changePassword(c, { user }, password, newPassword) {
      let result
      try {
        result = await changePasswords.changePassword({
          userId: user.id,
          currentPassword: password,
          newPassword,
        })
      } catch (error) {
        if (error instanceof PasswordSignInError) return false
        throw error
      }
      await cookie.set(c, result.session.session, result.session.cookieValue)
      return true
    },

    async expireSessions() {
      await sessions.expireStale()
    },
  }
}

/** Thrown by sign-in's `secondFactorFor` when the auth user has no `users` row: a refusal. */
class MissingProfileError extends Error {
  constructor() {
    super("the auth user has no profile row")
    this.name = "MissingProfileError"
  }
}

/**
 * An issuer or label the key URI format accepts: `:` separates the two there, so it is replaced,
 * and an empty result falls back.
 */
function accountPart(value: string, fallback: string): string {
  const cleaned = value.replaceAll(":", " ").trim()
  return cleaned === "" ? fallback : cleaned
}
