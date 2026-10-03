import type { MpaConfig } from "./config.ts"
import { createApi } from "./api.ts"
import { FormRejected } from "./forms.ts"
import { define } from "./utils.ts"
import { createSameOriginCheck } from "@spy4x/server/http/same-origin"

/**
 * Runs around every page and action:
 *
 * 1. refuses a post from another site with 403 before anything else runs: the API's own rule
 *    (`Sec-Fetch-Site: same-origin`, and `Origin` equal to `webAppOrigin` or `null`), without its
 *    session cookie check, since the MPA has no session;
 * 2. gives the route an API client bound to this request, which presents an MPA on its own domain
 *    to the API as the API's origin once step 1 has passed;
 * 3. answers a form it cannot read with {@link FormRejected}'s status;
 * 4. forbids framing, so another site cannot trick a click on a form, and keeps pages out of shared
 *    caches, since the newsletter pages carry a token in their address.
 */
export function pageMiddleware(
  config: MpaConfig,
  fetch: typeof globalThis.fetch = globalThis.fetch,
) {
  const crossSiteRefusal = createSameOriginCheck({
    expectedOrigin: config.webAppOrigin,
    requireSessionCookie: false,
  })
  return define.middleware(async (ctx) => {
    if (crossSiteRefusal(ctx.req)) {
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
      fetch,
    })
    let response: Response
    try {
      response = await ctx.next()
    } catch (error) {
      if (!(error instanceof FormRejected)) throw error
      response = new Response(error.message, { status: error.status })
    }
    return withPageHeaders(response)
  })
}

function remoteAddress(info: Deno.ServeHandlerInfo): string {
  const address = info.remoteAddr
  return address.transport === "tcp" || address.transport === "udp" ? address.hostname : ""
}

function withPageHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set("x-frame-options", "DENY")
  headers.set("content-security-policy", "frame-ancestors 'none'")
  if (headers.get("content-type")?.startsWith("text/html")) {
    headers.set("cache-control", "no-store")
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
