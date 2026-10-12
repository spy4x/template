import { Hono } from "hono"
import type { Context } from "hono"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { requestInfoFromContext } from "@spy4x/platform/request-info"
import {
  OAUTH_NOTICE_PARAM,
  OAUTH_PAGES,
  type OAuthNotice,
  oauthProviderId,
  type OAuthProvidersResponse,
} from "@domain/identity"
import type { SignIn } from "@api/services/sign-in.ts"
import { UnlinkOutcome } from "@api/services/oauth-sign-in.ts"
import { UserSignedOutEvent } from "@api/cqrs/events.ts"
import type { APIContext } from "../_types.ts"
import type { MutationGuards } from "../middlewares/mutation-guards.ts"
import type { AuthRateLimits } from "../middlewares/auth-rate-limits.ts"

/** What the provider sign-in routes call. `index.ts` passes the app's singletons; tests pass fakes. */
export interface OAuthRouteDependencies {
  signIn: Pick<SignIn, "auth" | "oauth">
  /** Announces a sign-out, so the person's open sockets close. */
  emit(event: UserSignedOutEvent): void
  mutationGuards: MutationGuards
  rateLimits: Pick<AuthRateLimits, "strictByIp" | "normal">
  /** The web app's origin: every redirect after a callback goes to a page under it. */
  origin: string
}

/** The answer when the question page confirms a sign-up that no longer waits. */
export const SIGN_UP_EXPIRED = "This took too long. Start again from the sign-in page."

/** The answer for a provider that is off, or a name that is no provider. */
export const PROVIDER_OFF = "This sign-in method is not available."

/** The answer when the method to unlink is not one of the account's provider methods. */
export const METHOD_NOT_FOUND = "This sign-in method is already unlinked."

/** The answer when the method to unlink is the only way into the account. */
export const METHOD_IS_LAST = "This is your only way to sign in. Add another one first."

/** A key id as the methods card sends it: a positive integer that fits Postgres `integer`. */
const KEY_ID = /^[1-9][0-9]{0,9}$/
const MAX_KEY_ID = 2_147_483_647

/** The page parameter `/:provider/start` reads the return page from, as the sign-in pages do. */
const NEXT_PARAM = "next"

/** `path` with `next` as its query, or `path` alone without one. */
function withNext(path: string, next: string | null): string {
  return next ? `${path}?${new URLSearchParams({ [NEXT_PARAM]: next })}` : path
}

/**
 * Sign-in with Google and GitHub: starting a flow, the provider's callback, the question before a
 * provider creates an account, and the account's sign-in methods. Mounted at `/auth` BEFORE
 * `createAuthRoute`, whose session middleware would otherwise answer 401 for the public routes
 * here. For the same reason every route below names its own middleware and none is added with
 * `use`: such a middleware would also run for the routes mounted after this one.
 */
export function createOAuthRoute(
  { signIn, emit, mutationGuards, rateLimits, origin }: OAuthRouteDependencies,
): Hono<APIContext> {
  const { oauth } = signIn
  const { isAuthenticated2FA } = signIn.auth
  const page = (path: string) => new URL(path, origin).href
  const withNotice = (path: string, notice: OAuthNotice) =>
    page(`${path}?${new URLSearchParams({ [OAUTH_NOTICE_PARAM]: notice })}`)
  /** The provider a route's `:provider` names, when it is on. */
  const providerOf = (c: Context<APIContext>) => {
    const id = oauthProviderId(c.req.param("provider"))
    return id !== null && oauth.providers().includes(id) ? id : null
  }

  return new Hono<APIContext>()
    // Which buttons the sign-in pages show. Public: the buttons are on a public page.
    .get(`/providers`, rateLimits.normal, (c) => {
      return c.json({ providers: oauth.providers() } satisfies OAuthProvidersResponse)
    })
    // A plain link opens this: the browser leaves for the provider and comes back to the callback.
    .get(`/:provider{google|github}/start`, rateLimits.strictByIp, async (c) => {
      const id = providerOf(c)
      const url = id && await oauth.start(c, id, { next: c.req.query(NEXT_PARAM) })
      if (!url) return c.json({ error: PROVIDER_OFF }, 404)
      return c.redirect(url, 302)
    })
    .get(`/:provider{google|github}/callback`, rateLimits.strictByIp, async (c) => {
      const id = providerOf(c)
      if (!id) return c.json({ error: PROVIDER_OFF }, 404)
      const result = await oauth.callback(c, id, c.get("auth"))
      if (result.kind === "confirm") return c.redirect(page(OAUTH_PAGES.confirmSignUp), 302)
      if (result.kind === "notice") {
        return c.redirect(
          withNotice(result.linking ? OAUTH_PAGES.profile : OAUTH_PAGES.signIn, result.notice),
          302,
        )
      }
      const owesCode = result.signedIn.session.secondFactor === SecondFactorStatus.Pending
      return c.redirect(
        page(
          owesCode
            ? withNext(OAUTH_PAGES.oneTimeCode, result.next)
            : result.next ?? OAUTH_PAGES.profile,
        ),
        302,
      )
    })
    // What the question page shows. 204 when nothing waits, so the page can send the person back.
    .get(`/sign-up/pending`, rateLimits.normal, (c) => {
      const pending = oauth.pendingSignUp(c)
      return pending ? c.json(pending) : c.body(null, 204)
    })
    .post(
      `/sign-up/confirm`,
      mutationGuards.anonymous,
      rateLimits.strictByIp,
      async (c) => {
        const signedIn = await oauth.confirmSignUp(c)
        if (!signedIn) return c.json({ error: SIGN_UP_EXPIRED }, 400)
        // As a password sign-in answers: 202 while the authenticator code is owed.
        if (signedIn.session.secondFactor === SecondFactorStatus.Pending) {
          return c.json({ secondFactor: "Pending" }, 202)
        }
        return c.json(signedIn.user, 201)
      },
    )
    // "I already have an account": nothing was created, so this only forgets the token here.
    .post(`/sign-up/cancel`, mutationGuards.anonymous, rateLimits.normal, (c) => {
      oauth.cancelSignUp(c)
      return c.json({ success: true })
    })
    .get(`/methods`, isAuthenticated2FA, rateLimits.normal, async (c) => {
      return c.json(await oauth.methods(c.get("auth")!))
    })
    // A POST, not a link: another site must not be able to start a link for a signed-in person.
    .post(
      `/methods/:provider{google|github}/link`,
      isAuthenticated2FA,
      mutationGuards.signedIn,
      rateLimits.normal,
      async (c) => {
        const id = providerOf(c)
        const url = id && await oauth.start(c, id, { linking: c.get("auth")! })
        if (!url) return c.json({ error: PROVIDER_OFF }, 404)
        return c.json({ url })
      },
    )
    .delete(
      `/methods/:id`,
      isAuthenticated2FA,
      mutationGuards.signedIn,
      rateLimits.normal,
      async (c) => {
        const raw = c.req.param("id")
        const keyId = KEY_ID.test(raw) ? Number(raw) : 0
        if (keyId < 1 || keyId > MAX_KEY_ID) return c.json({ error: METHOD_NOT_FOUND }, 404)
        const state = c.get("auth")!
        const outcome = await oauth.unlink(c, state, keyId)
        if (outcome === UnlinkOutcome.NotFound) return c.json({ error: METHOD_NOT_FOUND }, 404)
        if (outcome === UnlinkOutcome.LastMethod) return c.json({ error: METHOD_IS_LAST }, 409)
        // The method's sessions ended with it: their sockets close. The sockets of the person's
        // other sessions reconnect by themselves.
        emit(
          new UserSignedOutEvent({
            userId: state.user.id,
            request: requestInfoFromContext(c, { trustedProxy: true }),
          }),
        )
        return c.json({ signedOut: outcome === UnlinkOutcome.UnlinkedAndSignedOut })
      },
    )
}
