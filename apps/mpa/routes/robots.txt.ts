import { define } from "../utils.ts"

/** Lets every crawler in and points it at the sitemap, on this website's own origin. */
export const handler = define.handlers({
  GET(ctx) {
    const body = `User-agent: *\nAllow: /\n\nSitemap: ${ctx.state.webAppOrigin}/sitemap.xml\n`
    return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } })
  },
})
