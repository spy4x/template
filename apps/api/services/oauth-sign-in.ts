/**
 * Sign-in with Google and GitHub (#141), and the question before a provider creates an account
 * (#142), on `@spy4x/server/auth/oauth`. The package does the protocol (PKCE, a single-use
 * `state`, the token and profile requests) and decides who a provider account is: the user whose
 * key carries the provider's id, else the user who owns the provider's verified address proven,
 * else nobody. This file decides what the template adds:
 *
 * - **A provider is on only when it was given.** `createSignIn` gets the providers whose client id
 *   and secret are set; every operation answers "off" for any other.
 * - **Nothing is created in the callback.** The package runs with `signUp: "confirm"`: a callback
 *   for an unknown person holds the profile for 10 minutes under a single-use token, which goes to
 *   the browser in an HttpOnly cookie. `confirmSignUp` spends it and creates the auth user, key,
 *   session, profile, first group and audit row in one transaction, as the password sign-up does.
 *   "Go back" takes the held profile out of the flow store, so the token is dead at once, and
 *   leaving the page creates nothing: the token expires by itself.
 * - **The question says what creating costs.** The package deletes every other user's unproven
 *   claim to an address the moment someone proves it, so nobody can sit on an address they do
 *   not own. A password account that never confirmed its address therefore loses its password
 *   when the provider's verified owner of that address creates an account. Joining the two
 *   instead would hand the newcomer an account whose password someone else chose, so the rule
 *   stays; the question page warns first, and the account that lost its password gets an audit
 *   row (`UNCONFIRMED_ADDRESS_TAKEN`).
 * - **An address that is not verified links nothing.** The package ignores it when it resolves the
 *   person, so such a callback always ends at the question, never inside someone's account.
 * - **Linking from the profile.** The package cannot attach a provider to the signed-in user; it
 *   links only by a verified address that a user owns proven. So a link started from the profile
 *   is a provider sign-in whose result must be the signed-in user: otherwise the session the
 *   package started is deleted and the page says why. One thing is still kept then: when the
 *   provider's verified address is another account's proven address, the package has already
 *   linked the provider to that account, as a signed-out sign-in with it would. That ends when
 *   linking moves to the package's connect call (https://github.com/spy4x/ts-libs/pull/591).
 * - **Unlinking.** Only a provider method, and never the last way in. The key's sessions end with
 *   it through the foreign key, so unlinking the method this device signed in with signs it out.
 *
 * Reads no environment and imports no singleton, like `sign-in.ts`.
 *
 * @module
 */

import type { Context } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { type Type, type } from "arktype"
import { validate } from "@spy4x/validation"
import {
  type AuthKey,
  type AuthSessionRecord,
  type AuthStore,
  type AuthUser,
  normalizeEmail,
} from "@spy4x/server/auth"
import {
  type ConfirmableOAuthSignIn,
  createMemoryOAuthFlowStore,
  createOAuthSignIn,
  type OAuthFlowStore,
  OAuthOutcome,
  type OAuthProviderConfig,
  OAuthSignInError,
  type OAuthSignInResult,
} from "@spy4x/server/auth/oauth"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import {
  SecondFactorStatus,
  type SessionCookie,
  type SessionDevice,
  type SessionManager,
  type SessionStore,
} from "@spy4x/server/sign-in"
import {
  type AuthAuditBase,
  AuthAuditEventType,
  OAUTH_PROVIDERS,
  type OAuthNotice,
  type OAuthProviderId,
  oauthProviderId,
  type PendingSignUp,
  type SignInMethod,
  type SignInMethodsResponse,
  type User,
  UserMFAStatus,
  UserRole,
} from "@domain/identity"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { safeRedirectPath } from "@spy4x/net/redirect-path"
import type { AppDbBase } from "./db-base.ts"
import type { AppAuthState, SignedIn } from "./sign-in.ts"

/** How long a started flow and its cookie live: the package's default, in seconds. */
const FLOW_SECONDS = 600

/** The cookies below go only to the auth routes. */
const COOKIE_PATH = "/api/auth"

/** Holds a started flow's `state`, and the user who is linking when it started on the profile. */
const stateCookie = (id: OAuthProviderId) => `oauth_state_${id}`

/** Holds the token of a sign-up that waits for its confirmation, and what the page shows. */
const SIGN_UP_COOKIE = "oauth_sign_up"

/** Longest address the confirmation page is given to show. */
const MAX_SHOWN_EMAIL = 320

const stateCookieSchema = type({
  state: "string > 0",
  /** The user who started the flow from the profile, to link the provider. */
  "link?": "number.integer > 0",
  /** The page sign-in returns to, checked when it was stored and again when it is read. */
  "next?": "string",
})

/**
 * `next` when it is a page of the web app, else `null`: `safeRedirectPath`'s rules, and no `/api`
 * path. The same check the SPA's sign-in pages make (`checkedNext`).
 */
function pageOrNull(next: string | null | undefined): string | null {
  if (!next) return null
  return safeRedirectPath(next, { fallback: "", refuse: ["/api"] }) || null
}

const signUpCookieSchema = type({
  provider: type.enumerated(...OAUTH_PROVIDERS),
  token: "string > 0",
  /** Where the flow store keeps the held profile, so "go back" can take it out. */
  held: "string > 0",
  email: "string | null",
  /** Whether the provider vouches for `email`. */
  verified: "boolean",
  expiresAt: "string.date.iso",
})

/** The JSON value of cookie `name` when it fits `schema`, else `null`. */
function readJsonCookie<T>(c: Context, name: string, schema: Type<T>): T | null {
  const raw = getCookie(c, name)
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  return (validate(schema, parsed).data as T | undefined) ?? null
}

/** What `createSignIn` is given to turn provider sign-in on. */
export interface OAuthOptions {
  /**
   * The providers that are on, each made by the package (`createGoogleOAuthProvider`,
   * `createGitHubOAuthProvider`): its `id` is one of `OAUTH_PROVIDERS`.
   */
  providers: readonly OAuthProviderConfig[]
  /** The web app's origin. A provider's callback is `<origin>/api/auth/<id>/callback`. */
  origin: string
  /**
   * Keeps started flows and waiting sign-ups. Defaults to the package's memory store, which only
   * suits one process; the API passes `createKvOAuthFlowStore` over Valkey.
   */
  flows?: OAuthFlowStore
  /** Sends the token and profile requests. Defaults to `fetch`; tests pass a fake provider. */
  fetch?: (request: Request) => Promise<Response>
  /** The time, for expiry. Defaults to the system's. */
  clock?: { now(): number }
}

/** What the sign-in hands this module of its own parts. */
export interface OAuthInternals {
  db: AppDbBase
  sessionsOver(store: SessionStore<AuthSessionRecord>): SessionManager<AuthSessionRecord>
  cookie: SessionCookie
  secureCookie: boolean
  auditRow(
    c: Context,
    userId: number,
    eventType: AuthAuditEventType,
    identifier?: string | null,
  ): AuthAuditBase
  deviceOf(c: Context): SessionDevice
  /**
   * The second factor a provider sign-in of an existing user owes, restoring an account that waits
   * to be deleted as a password sign-in does. Throws what {@link isRefusal} recognises when the
   * user may not sign in.
   */
  secondFactorFor(c: Context): (user: AuthUser) => Promise<SecondFactorStatus>
  /** The second factor at a confirmed sign-up: none for a new user, the user's own otherwise. */
  secondFactorAtSignUp(user: AuthUser): Promise<SecondFactorStatus>
  /** The profile of a user who waits to be deleted with two-factor on, else `null`. */
  waitingForCode(userId: number): Promise<User | null>
  /** Whether `error` means "this user may not sign in" rather than a fault. */
  isRefusal(error: unknown): boolean
}

/** How a provider's callback ended. */
export type OAuthCallbackResult =
  /** Signed in: the session cookie is set. */
  | { kind: "signed-in"; signedIn: SignedIn; next: string | null }
  /** Nobody has this provider account: the sign-up cookie is set and the page asks. */
  | { kind: "confirm" }
  /** Nothing to continue with: `notice` says why, `linking` whether it started on the profile. */
  | { kind: "notice"; notice: OAuthNotice; linking: boolean }

/** What {@link OAuthOperations.unlink} did. */
export enum UnlinkOutcome {
  Unlinked = 1,
  /** Unlinked, and it was the method this device signed in with: the cookie is cleared. */
  UnlinkedAndSignedOut = 2,
  /** No provider method with this id on the account. The password is never unlinked. */
  NotFound = 3,
  /** It is the only way in. Nothing changed. */
  LastMethod = 4,
}

/** The provider sign-in operations the routes call. */
export interface OAuthOperations {
  /** The providers that are on. */
  providers(): OAuthProviderId[]
  /**
   * Starts a flow and sets its state cookie. Returns the provider's page to send the browser to,
   * or `null` when the provider is off. With `linking`, the callback only links to that user.
   * `next` is the page a finished sign-in returns to; anything but a page of the web app is dropped.
   */
  start(
    c: Context,
    id: OAuthProviderId,
    options?: { linking?: AppAuthState | null; next?: string | null },
  ): Promise<string | null>
  /** Finishes a flow from the provider's redirect. `current` is the request's session, if any. */
  callback(
    c: Context,
    id: OAuthProviderId,
    current: AppAuthState | null,
  ): Promise<OAuthCallbackResult>
  /** The sign-up this browser may confirm, or `null` when none waits or it has expired. */
  pendingSignUp(c: Context): Promise<PendingSignUp | null>
  /**
   * Creates the account the waiting sign-up asks for and signs it in, in one transaction, and
   * clears the sign-up cookie. `null` when nothing waits, or the token is used or expired. The
   * session the browser had before (`current`) ends: the device is the new account's now.
   *
   * @param firstGroupId The id of the person's first group. Defaults to a new UUID.
   */
  confirmSignUp(
    c: Context,
    current: AppAuthState | null,
    firstGroupId?: string,
  ): Promise<SignedIn | null>
  /**
   * Answers "I already have an account": nothing was created, the cookie goes and the held
   * profile leaves the flow store, so a kept copy of the cookie confirms nothing either.
   */
  cancelSignUp(c: Context): Promise<void>
  /** The user's ways in, and the providers they could still link. */
  methods(state: AppAuthState): Promise<SignInMethodsResponse>
  /** Removes provider method `keyId` of the user, with its sessions, unless it is the last way in. */
  unlink(c: Context, state: AppAuthState, keyId: number): Promise<UnlinkOutcome>
}

/** Builds the provider sign-in over the sign-in's own parts. Without `options` every provider is off. */
export function createOAuthOperations(
  options: OAuthOptions | undefined,
  own: OAuthInternals,
): OAuthOperations {
  const { db, cookie } = own
  const clock = options?.clock ?? { now: () => Date.now() }
  const flows = options?.flows ?? createMemoryOAuthFlowStore({ clock })
  const enabled = new Map<OAuthProviderId, OAuthProviderConfig>()
  for (const provider of options?.providers ?? []) {
    const id = oauthProviderId(provider.id)
    if (id === null) throw new TypeError(`unknown sign-in provider "${provider.id}"`)
    enabled.set(id, provider)
  }
  const sessions = own.sessionsOver(db.sessionStore)
  const cookieOptions = {
    httpOnly: true,
    secure: own.secureCookie,
    sameSite: "Lax",
    path: COOKIE_PATH,
  } as const

  /** The package's sign-in with `id` over these stores. Cheap: it only checks its options. */
  function signInWith(
    id: OAuthProviderId,
    over: {
      store: AuthStore
      sessions: SessionManager<AuthSessionRecord>
      secondFactorFor: (user: AuthUser) => Promise<SecondFactorStatus>
    },
    /** Told where the flow store keeps a profile that waits for the person's answer. */
    onHeld?: (key: string) => void,
  ): ConfirmableOAuthSignIn {
    return createOAuthSignIn({
      ...over,
      provider: enabled.get(id)!,
      redirectUri: `${options!.origin}/api/auth/${id}/callback`,
      flows: onHeld
        ? {
          take: (key) => flows.take(key),
          async put(key, flow, expiresAt) {
            await flows.put(key, flow, expiresAt)
            if (flow.signUp) onHeld(key)
          },
        }
        : flows,
      fetch: options!.fetch,
      clock,
      signUp: "confirm",
    })
  }

  /** Which way in a key is, or `null` for a key nobody can sign in with now. */
  function kindOf(key: AuthKey): SignInMethod["kind"] | null {
    if (key.method === PASSWORD_METHOD) return key.secret ? "password" : null
    const id = key.method.startsWith("oauth:") ? oauthProviderId(key.method.slice(6)) : null
    return id !== null && enabled.has(id) ? id : null
  }

  function describe(keys: AuthKey[], currentKeyId: number): SignInMethodsResponse {
    const ways = keys.flatMap((key) => {
      const kind = kindOf(key)
      return kind === null ? [] : [{ key, kind }]
    })
    return {
      methods: ways.map(({ key, kind }) => ({
        id: key.id,
        kind,
        // An older account's password key carries a username and no address.
        email: key.email ?? (kind === "password" ? key.subject : null),
        current: key.id === currentKeyId,
        canUnlink: kind !== "password" && ways.length > 1,
      })),
      available: [...enabled.keys()].filter((id) => !ways.some((way) => way.kind === id)),
    }
  }

  /**
   * The password key that claims the waiting sign-up's address without having proven it, or
   * `null`. Only an address the provider vouches for can take such a claim away.
   */
  async function unconfirmedClaim(
    store: AuthStore,
    waiting: typeof signUpCookieSchema.infer,
  ): Promise<AuthKey | null> {
    const email = waiting.verified ? normalizeEmail(waiting.email) : null
    const key = email === null ? null : await store.findKey(PASSWORD_METHOD, email)
    return key && key.provenAt === null ? key : null
  }

  /** The waiting sign-up in the request's cookie, token included, or `null`. */
  function readSignUp(c: Context) {
    const data = readJsonCookie(c, SIGN_UP_COOKIE, signUpCookieSchema)
    if (!data || !enabled.has(data.provider)) return null
    return Date.parse(data.expiresAt) > clock.now() ? data : null
  }

  /**
   * After the package signed an existing user in: the last sign-in time and the audit rows, in one
   * transaction, then the cookie. When they cannot be written the session is deleted again.
   */
  async function finishSignIn(c: Context, result: OAuthSignInResult): Promise<SignedIn> {
    const { session, cookieValue } = result.session
    let user: User
    try {
      const waiting = await own.waitingForCode(result.user.id)
      user = await db.begin(async (tx) => {
        // A deleted row takes no update; the code that restores it comes later.
        const row = waiting ?? await tx.user.updateOne({
          id: result.user.id,
          data: { lastLoginAt: new Date() },
        })
        if (!row) throw new Error("User not found")
        await writeSignInAudit(c, tx, result)
        return row
      })
    } catch (error) {
      await sessions.deleteForUser(result.user.id, session.id)
      throw error
    }
    await cookie.set(c, session, cookieValue)
    return { user, session }
  }

  /** The audit rows of a provider sign-in of an existing user: the link, when one was made, then the sign-in. */
  async function writeSignInAudit(
    c: Context,
    tx: AppDbBase,
    { user, key, outcome }: OAuthSignInResult,
  ): Promise<void> {
    if (outcome === OAuthOutcome.Linked) {
      await tx.authAudit.insert(
        own.auditRow(c, user.id, AuthAuditEventType.SIGN_IN_METHOD_LINKED, key.method),
      )
    }
    await tx.authAudit.insert(own.auditRow(c, user.id, AuthAuditEventType.SIGNED_IN, key.method))
  }

  return {
    providers: () => [...enabled.keys()],

    async start(c, id, { linking = null, next = null } = {}) {
      if (!enabled.has(id)) return null
      const { url, state } = await signInWith(id, {
        store: db.authStore,
        sessions,
        secondFactorFor: own.secondFactorFor(c),
      }).authorizationUrl()
      const kept: typeof stateCookieSchema.infer = { state }
      if (linking) kept.link = linking.user.id
      else if (pageOrNull(next)) kept.next = pageOrNull(next)!
      setCookie(c, stateCookie(id), JSON.stringify(kept), {
        ...cookieOptions,
        maxAge: FLOW_SECONDS,
      })
      return url.href
    },

    async callback(c, id, current) {
      const kept = readJsonCookie(c, stateCookie(id), stateCookieSchema)
      deleteCookie(c, stateCookie(id), cookieOptions)
      const linking = kept?.link !== undefined
      const failed = (notice: OAuthNotice = "failed"): OAuthCallbackResult => ({
        kind: "notice",
        notice,
        linking,
      })
      if (!enabled.has(id)) return failed()
      // A link belongs to the person who started it: signed out or replaced since, it is void.
      if (linking && current?.user.id !== kept.link) return failed()

      let held = ""
      let result
      try {
        result = await signInWith(id, {
          store: db.authStore,
          sessions,
          // A link keeps no session of its own, so it must not restore a deleted account either:
          // the session below is deleted at once, and owes the code until then.
          secondFactorFor: linking
            ? () => Promise.resolve(SecondFactorStatus.Pending)
            : own.secondFactorFor(c),
        }, (key) => held = key).handleCallback({
          query: new URL(c.req.url).searchParams,
          browserState: kept?.state,
          device: own.deviceOf(c),
        })
      } catch (error) {
        if (error instanceof OAuthSignInError || own.isRefusal(error)) return failed()
        throw error
      }

      if (result.outcome === OAuthOutcome.PendingSignUp) {
        // Nobody owns this provider account or its address: a link has nothing to attach to, and
        // the held profile is left to expire.
        if (linking) return failed("link-mismatch")
        const { email } = result.profile
        const shown: typeof signUpCookieSchema.infer = {
          provider: id,
          token: result.token,
          held,
          email: typeof email === "string" && email.length <= MAX_SHOWN_EMAIL ? email : null,
          verified: result.profile.emailVerified === true,
          expiresAt: result.expiresAt.toISOString(),
        }
        setCookie(c, SIGN_UP_COOKIE, JSON.stringify(shown), {
          ...cookieOptions,
          expires: result.expiresAt,
        })
        return { kind: "confirm" }
      }

      if (!linking) {
        const signedIn = await finishSignIn(c, result)
        // The cookie now names the new session; the one this browser had would only linger.
        if (current) await sessions.deleteForUser(current.user.id, current.session.id)
        return { kind: "signed-in", signedIn, next: pageOrNull(kept?.next) }
      }

      // A link keeps the session the person already has: the one the package started goes.
      await sessions.deleteForUser(result.user.id, result.session.session.id)
      // The package links by the verified address, whoever is signed in here: the row goes to the
      // account that got the method.
      if (result.outcome === OAuthOutcome.Linked) {
        await db.authAudit.insert(
          own.auditRow(
            c,
            result.user.id,
            AuthAuditEventType.SIGN_IN_METHOD_LINKED,
            result.key.method,
          ),
        )
      }
      if (result.user.id !== current!.user.id) return failed("link-other-account")
      return { kind: "notice", notice: "linked", linking }
    },

    async pendingSignUp(c) {
      const waiting = readSignUp(c)
      if (!waiting) return null
      return {
        provider: waiting.provider,
        email: waiting.email,
        expiresAt: waiting.expiresAt,
        unconfirmedAccount: await unconfirmedClaim(db.authStore, waiting) !== null,
      }
    },

    async confirmSignUp(c, current, firstGroupId = uuidV7()) {
      const waiting = readSignUp(c)
      deleteCookie(c, SIGN_UP_COOKIE, cookieOptions)
      if (!waiting) return null
      let created
      try {
        created = await db.begin(async (tx) => {
          const claim = await unconfirmedClaim(tx.authStore, waiting)
          // Built over the transaction's stores, so the auth user, key and session join it.
          const result = await signInWith(waiting.provider, {
            store: tx.authStore,
            sessions: own.sessionsOver(tx.sessionStore),
            secondFactorFor: own.secondFactorAtSignUp,
          }).confirmSignUp(waiting.token, own.deviceOf(c))
          let user: User | undefined
          if (result.outcome === OAuthOutcome.SignedUp) {
            user = await tx.user.createForAuthUser(result.user.id, {
              firstName: "",
              lastName: "",
              mfa: UserMFAStatus.NOT_CONFIGURED,
              role: UserRole.VIEWER,
              lastLoginAt: new Date(),
            })
            await tx.group.createFirst({ id: firstGroupId, name: "Personal" }, user.id)
            await tx.starterData.queue(user.id)
            // The package took the unproven claim to this address away: say so where the owner
            // of the product will look when that account's person asks what happened.
            if (claim && await tx.authStore.findKeyById(claim.id) === null) {
              await tx.authAudit.insert(
                own.auditRow(
                  c,
                  claim.userId,
                  AuthAuditEventType.UNCONFIRMED_ADDRESS_TAKEN,
                  result.key.method,
                ),
              )
            }
            await tx.authAudit.insert(
              own.auditRow(
                c,
                user.id,
                AuthAuditEventType.SIGNED_UP,
                result.key.email ?? result.key.method,
              ),
            )
          } else {
            // Someone signed up with this provider account, or proved its address, while the
            // question was open: the package signed that user in instead of making a second one.
            user = await tx.user.updateOne({
              id: result.user.id,
              data: { lastLoginAt: new Date() },
            })
            if (!user) throw new OAuthSignInError("user-deleted")
            await writeSignInAudit(c, tx, result)
          }
          return { user, ...result.session }
        })
      } catch (error) {
        if (error instanceof OAuthSignInError) return null
        throw error
      }
      await cookie.set(c, created.session, created.cookieValue)
      if (current) await sessions.deleteForUser(current.user.id, current.session.id)
      return { user: created.user, session: created.session }
    },

    async cancelSignUp(c) {
      const waiting = readSignUp(c)
      deleteCookie(c, SIGN_UP_COOKIE, cookieOptions)
      if (waiting) await flows.take(waiting.held)
    },

    async methods({ user, session }) {
      return describe(await db.authStore.listKeys(user.id), session.keyId)
    },

    async unlink(c, { user, session }, keyId) {
      const outcome = await db.begin(async (tx) => {
        // Two unlinks at once each see the other's method as the one that remains; the lock makes
        // the second read after the first has finished.
        await tx.lockUser(user.id)
        const { methods } = describe(await tx.authStore.listKeys(user.id), session.keyId)
        const method = methods.find((candidate) => candidate.id === keyId)
        if (!method || method.kind === "password") return UnlinkOutcome.NotFound
        if (!method.canUnlink) return UnlinkOutcome.LastMethod
        const removed = await signInWith(method.kind, {
          store: tx.authStore,
          sessions: own.sessionsOver(tx.sessionStore),
          secondFactorFor: own.secondFactorAtSignUp,
        }).disconnect(user.id, keyId)
        if (!removed) return UnlinkOutcome.NotFound
        await tx.authAudit.insert(
          own.auditRow(
            c,
            user.id,
            AuthAuditEventType.SIGN_IN_METHOD_UNLINKED,
            `oauth:${method.kind}`,
          ),
        )
        return method.current ? UnlinkOutcome.UnlinkedAndSignedOut : UnlinkOutcome.Unlinked
      })
      if (outcome === UnlinkOutcome.UnlinkedAndSignedOut) {
        cookie.clear(c)
        c.set("auth", null)
      }
      return outcome
    },
  }
}
