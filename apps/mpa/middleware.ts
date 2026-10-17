import type { MpaConfig } from "./config.ts"
import { createApi } from "./api.ts"
import { renderErrorPage } from "./error-page.tsx"
import { createNewsletterStatus } from "./newsletter.ts"
import { define } from "./utils.ts"
import { HttpError } from "fresh"
import { HTTPException } from "hono/http-exception"
import { createSameOriginCheck, type SameOriginRefusal } from "@spy4x/server/http/same-origin"
import { securityHeaderList, withSecurityHeaders } from "@spy4x/server/http/security-headers"

/**
 * The header set `securityHeaders` of `@spy4x/server` sends; the helper itself is Hono middleware
 * and the MPA runs on Fresh. A page here loads one stylesheet from its own origin and no script,
 * inline block, image or font, so the policy is the library's strictest: everything from `'self'`
 * only, no plugins and no framing. Its `Referrer-Policy: no-referrer` also covers the newsletter
 * pages, whose address carries a token.
 *
 * One directive is widened. The pricing page's form posts to the MPA, which redirects to the SPA's
 * sign-up, and a browser applies `form-action` to that redirect too. On a domain of its own the
 * MPA therefore allows the SPA's origin there.
 */
function securityHeaderSet(config: MpaConfig): Promise<[string, string][]> {
  return securityHeaderList({
    extraSources: config.apiOrigin === config.webAppOrigin
      ? undefined
      : { formAction: [config.apiOrigin] },
  })
}

/**
 * Puts the security headers on every response: pages, static files, redirects, refusals and the
 * answer to an error a route throws. It goes first in the app, before the static files.
 */
export async function securityHeadersMiddleware(config: MpaConfig) {
  const set = await securityHeaderSet(config)
  return define.middleware(async (ctx) => {
    let response: Response
    try {
      response = await ctx.next()
    } catch (error) {
      response = errorResponse(error)
    }
    return withSecurityHeaders(response, set)
  })
}

/**
 * Runs around every page and action:
 *
 * 1. refuses a post from another site with 403 before anything else runs: the API's own rule
 *    (`Sec-Fetch-Site: same-origin`, and `Origin` equal to `webAppOrigin` or `null`), without its
 *    session cookie check, since the MPA has no session. One case is wider than the API's rule: a
 *    post with no `Sec-Fetch-Site` at all passes when its `Origin` equals `webAppOrigin`, because
 *    old browsers and some privacy tools send no such header (see {@link originAloneIsEnough});
 * 2. gives the route an API client bound to this request, which presents an MPA on its own domain
 *    to the API as the API's origin once step 1 has passed;
 * 3. tells the route whether the newsletter is on, as `newsletter()` says. It is required, so a
 *    caller cannot leave the status out by accident: the website starts through
 *    {@link newsletterPageMiddleware};
 * 4. answers a form it cannot read with the status `readFormBody` names (413, 408 or 400);
 * 5. answers any other error, the 404 of an unknown address included, with the error page inside
 *    the site's frame (`error-page.tsx`);
 * 6. keeps pages out of shared caches, since the newsletter pages carry a token in their address.
 *
 * Framing is forbidden by {@link securityHeadersMiddleware}, which runs before this one.
 */
export function pageMiddleware(
  config: MpaConfig,
  fetch: typeof globalThis.fetch,
  newsletter: () => boolean,
) {
  const crossSiteRefusal = createSameOriginCheck({
    expectedOrigin: config.webAppOrigin,
    requireSessionCookie: false,
  })
  return define.middleware(async (ctx) => {
    const refusal = crossSiteRefusal(ctx.req)
    const byOriginAlone = originAloneIsEnough(refusal, ctx.req)
    if (refusal && !byOriginAlone) {
      return withPageHeaders(new Response("Cross-site request refused", { status: 403 }))
    }
    ctx.state.webAppOrigin = config.webAppOrigin
    ctx.state.spaOrigin = config.apiOrigin
    ctx.state.api = createApi({
      apiUrl: config.apiUrl,
      request: ctx.req,
      remoteAddress: remoteAddress(ctx.info),
      origins: config.webAppOrigin === config.apiOrigin
        ? undefined
        : { page: config.webAppOrigin, api: config.apiOrigin },
      sameOriginByOrigin: byOriginAlone,
      fetch,
    })
    ctx.state.newsletter = newsletter()
    let response: Response
    try {
      response = await ctx.next()
    } catch (error) {
      response = error instanceof HTTPException
        ? new Response(error.message, { status: error.status })
        : await renderErrorPage(ctx, error)
    }
    return withPageHeaders(response)
  })
}

/**
 * Whether a post the same-origin check refused may pass after all: it carries no `Sec-Fetch-Site`
 * header, and that is the only thing the check found wrong. The check reports a wrong `Origin`
 * first, so `not-same-origin-fetch` means `Origin` equals the site's own exactly; a missing one,
 * another site's and `null` are all `origin-mismatch` and stay refused. A `Sec-Fetch-Site` the
 * browser did send, whatever its value, is the browser's own verdict and is never overruled.
 *
 * A page cannot set or remove either header on a form post, and every browser without
 * `Sec-Fetch-Site` either sends the posting page's `Origin` on a cross-site post or sends none.
 */
function originAloneIsEnough(refusal: SameOriginRefusal | undefined, request: Request): boolean {
  return refusal === "not-same-origin-fetch" && request.headers.get("sec-fetch-site") === null
}

/**
 * The last resort, in plain text: the answer to an error {@link pageMiddleware} did not turn into
 * the error page, because it came from a static file or from rendering that page. It is what
 * Fresh's default handler answers; Fresh makes that answer outside every middleware, so it would
 * leave without the security headers.
 */
function errorResponse(error: unknown): Response {
  if (error instanceof HttpError && error.status < 500) {
    return new Response(error.message, { status: error.status })
  }
  console.error(error)
  const status = error instanceof HttpError ? error.status : 500
  return new Response("Internal server error", { status })
}

function remoteAddress(info: Deno.ServeHandlerInfo): string {
  const address = info.remoteAddr
  return address.transport === "tcp" || address.transport === "udp" ? address.hostname : ""
}

function withPageHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  if (headers.get("content-type")?.startsWith("text/html")) {
    headers.set("cache-control", "no-store")
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * `pageMiddleware` wired to the API's own word on the newsletter, as the website runs it. The API
 * is asked once here, before the first page, so that page already knows; after that, see
 * `NewsletterStatus.isOn`.
 */
export async function newsletterPageMiddleware(
  config: MpaConfig,
  fetch: typeof globalThis.fetch = globalThis.fetch,
) {
  const newsletter = createNewsletterStatus({ apiUrl: config.apiUrl, fetch })
  await newsletter.refresh()
  return pageMiddleware(config, fetch, newsletter.isOn)
}
