import type { MpaConfig } from "./config.ts"
import { createApi } from "./api.ts"
import { FormRejected } from "./forms.ts"
import { crossSiteRefusal } from "./guard.ts"
import { define } from "./utils.ts"

/**
 * Runs around every page and action:
 *
 * 1. refuses a post from another site with 403 before anything else runs;
 * 2. gives the route an API client bound to this request;
 * 3. hands the browser every cookie the API set, exactly as the API wrote it (`HttpOnly`, `Secure`
 *    outside development, `SameSite=Lax`);
 * 4. answers a form it cannot read with {@link FormRejected}'s status;
 * 5. forbids framing, so another site cannot trick a click on a form, and keeps signed-in pages out
 *    of shared caches and the back-button cache.
 */
export function pageMiddleware(
  config: MpaConfig,
  fetch: typeof globalThis.fetch = globalThis.fetch,
) {
  return define.middleware(async (ctx) => {
    if (crossSiteRefusal(ctx.req, config.webAppOrigin)) {
      return withPageHeaders(new Response("Cross-site request refused", { status: 403 }), [])
    }
    const setCookies: string[] = []
    ctx.state.api = createApi({
      apiUrl: config.apiUrl,
      request: ctx.req,
      remoteAddress: remoteAddress(ctx.info),
      setCookies,
      fetch,
    })
    let response: Response
    try {
      response = await ctx.next()
    } catch (error) {
      if (!(error instanceof FormRejected)) throw error
      response = new Response(error.message, { status: error.status })
    }
    return withPageHeaders(response, setCookies)
  })
}

function remoteAddress(info: Deno.ServeHandlerInfo): string {
  const address = info.remoteAddr
  return address.transport === "tcp" || address.transport === "udp" ? address.hostname : ""
}

function withPageHeaders(response: Response, setCookies: readonly string[]): Response {
  const headers = new Headers(response.headers)
  for (const cookie of setCookies) headers.append("set-cookie", cookie)
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
