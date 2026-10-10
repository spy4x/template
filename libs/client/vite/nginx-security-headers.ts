import { securityHeaders } from "@spy4x/server/http/security-headers"
import { Hono } from "hono"

/**
 * The nginx variable that holds the origin of the error tracker, or nothing. The container sets it
 * when it starts (`apps/spa/csp-connect.sh`), because the tracker differs per deployment and the
 * image is built once.
 */
export const ERROR_TRACKER_VARIABLE = "$csp_error_tracker"

/**
 * What the SPA loads from another origin, added to the defaults of `securityHeaders`:
 *
 * - the Google Fonts stylesheet `index.html` links, and the font files that stylesheet names;
 * - the error tracker the reporter posts to, when the deployment has one.
 *
 * The API and its WebSocket are on the SPA's own origin (the proxy routes `/api` and `/ws`), so
 * `'self'` covers them, as it covers the service worker and the web manifest.
 */
const EXTRA_SOURCES = {
  styleSrc: ["https://fonts.googleapis.com"],
  fontSrc: ["https://fonts.gstatic.com"],
  connectSrc: [ERROR_TRACKER_VARIABLE],
}

/**
 * The header set `securityHeaders` of `@spy4x/server` sends for the built page `shellHtml`, as
 * `[name, value]` pairs. The hash of every inline `<script>` and `<style>` block in the page is in
 * the policy, so it needs no `'unsafe-inline'`.
 */
export async function spaSecurityHeaders(shellHtml: string): Promise<[string, string][]> {
  const middleware = await securityHeaders({ shellHtml, extraSources: EXTRA_SOURCES })
  const app = new Hono().use(middleware).get("/", (c) => c.body(null))
  return [...(await app.request("/")).headers]
}

/**
 * The same headers as lines of nginx configuration, one `add_header … always;` each, so nginx sends
 * them with error pages too. nginx serves the SPA, so the library's middleware cannot run there:
 * the build writes this text to a file that `apps/spa/nginx.conf` includes.
 *
 * Throws on a value that would end the quoted string or name another nginx variable.
 */
export async function nginxSecurityHeaders(shellHtml: string): Promise<string> {
  const lines = (await spaSecurityHeaders(shellHtml)).map(([name, value]) => {
    if (/["\\\n\r]/.test(value) || value.split(ERROR_TRACKER_VARIABLE).join("").includes("$")) {
      throw new Error(`The value of ${name} cannot be written into nginx configuration: ${value}`)
    }
    return `add_header ${name} "${value}" always;`
  })
  return [
    "# Written by the SPA's build (apps/spa/vite.config.ts) from the built index.html.",
    "# Do not edit: change libs/client/vite/nginx-security-headers.ts and build again.",
    ...lines,
    "",
  ].join("\n")
}
