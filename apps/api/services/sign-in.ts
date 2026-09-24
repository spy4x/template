/**
 * The app's sign-in, wired onto `@spy4x/server/sign-in` and `@spy4x/server/auth`: sessions, the
 * session cookie, the guards, password hashing and authenticator-app codes all come from the
 * package; this file decides what the template adds on top of them.
 *
 * - **Usernames, not addresses.** The template signs in with a free username. The package's
 *   `createPasswordSignIn` accepts only email addresses for sign-up and sign-in, so those two are
 *   built here on the package's `AuthStore` and `PasswordHasher`: one `password` key per user,
 *   subject = the normalised username. Password change uses the package provider as it is.
 * - **One sign-up transaction.** The auth user and key, the `users` profile row (same id), the
 *   personal group and the session are written in one `db.begin()`.
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
  SecondFactorStatus,
  SessionCookie,
  SessionManager,
  type SessionStore,
  totpEnrolment,
  verifyTotp,
} from "@spy4x/server/sign-in"
import { AuthConflictError, type AuthSessionRecord, type NewAuthKey } from "@spy4x/server/auth"
import {
  createPasswordSignIn,
  PASSWORD_METHOD,
  PasswordSignInError,
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
  /** Removes a finished enrolment. */
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
 * Lower-cases and trims a username, as the template always did. `null` when the result is empty,
 * longer than {@link USERNAME_MAX_LENGTH}, or holds text Postgres cannot store as given (NUL, a
 * lone surrogate).
 */
export function normalizeUsername(raw: string): string | null {
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
  const hasher = createPasswordHasher({ pepper: options.pepper })

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

  // Only `changePassword` of the package provider is used; see the module comment.
  const passwords = createPasswordSignIn({
    store: db.authStore,
    sessions,
    hasher,
    async secondFactorFor(authUser) {
      const user = await db.user.findOne({ id: authUser.id })
      return user?.mfa === UserMFAStatus.CONFIGURED
        ? SecondFactorStatus.Completed
        : SecondFactorStatus.NotRequired
    },
  })

  const passwordKey = (username: string, secret: string): NewAuthKey => ({
    method: PASSWORD_METHOD,
    subject: username,
    email: null,
    secret,
    provenAt: null,
  })

  return {
    auth,

    async signUp(c, rawUsername, password, personalGroupId = crypto.randomUUID()) {
      const username = normalizeUsername(rawUsername)
      if (username === null) return null
      const secret = await hasher.hash(password)
      let created
      try {
        created = await db.begin(async (tx) => {
          const { user: authUser, key } = await tx.authStore.createUserWithKey(
            passwordKey(username, secret),
          )
          const user = await tx.user.createForAuthUser(authUser.id, {
            firstName: "",
            lastName: "",
            mfa: UserMFAStatus.NOT_CONFIGURED,
            role: UserRole.VIEWER,
            lastLoginAt: new Date(),
          })
          await tx.group.createPersonal({ id: personalGroupId, name: "Personal" }, user.id)
          const { session, cookieValue } = await sessionsOver(tx.sessionStore).create({
            userId: user.id,
            keyId: key.id,
            secondFactor: SecondFactorStatus.NotRequired,
          })
          return { user, session, cookieValue }
        })
      } catch (error) {
        if (error instanceof AuthConflictError && error.reason === "key-exists") return null
        throw error
      }
      await cookie.set(c, created.session, created.cookieValue)
      return { user: created.user, session: created.session }
    },

    async signIn(c, rawUsername, password) {
      const username = normalizeUsername(rawUsername)
      const key = username === null ? null : await db.authStore.findKey(PASSWORD_METHOD, username)
      if (!key || key.secret === null) return null
      const check = await hasher.verify(password, key.secret)
      if (!check.valid) return null
      const authUser = await db.authStore.findUser(key.userId)
      const user = await db.user.findOne({ id: key.userId })
      if (!authUser || authUser.deletedAt !== null || !user) return null
      if (check.needsRehash) await db.authStore.updateKeySecret(key.id, await hasher.hash(password))

      const session = await auth.startSession(c, {
        userId: user.id,
        keyId: key.id,
        secondFactor: user.mfa === UserMFAStatus.CONFIGURED
          ? SecondFactorStatus.Pending
          : SecondFactorStatus.NotRequired,
      })
      const updated = await db.user.updateOne({ id: user.id, data: { lastLoginAt: new Date() } })
      // `updateOne` returns `undefined` only when the row vanished between the check above and
      // this statement - a race, not a normal "not found".
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
        result = await passwords.changePassword({
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

/**
 * An issuer or label the key URI format accepts: `:` separates the two there, so it is replaced,
 * and an empty result falls back.
 */
function accountPart(value: string, fallback: string): string {
  const cleaned = value.replaceAll(":", " ").trim()
  return cleaned === "" ? fallback : cleaned
}
