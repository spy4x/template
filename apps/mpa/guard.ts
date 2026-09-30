/** Methods that must not change state, and so pass unchecked. */
const SAFE_METHODS: readonly string[] = ["GET", "HEAD", "OPTIONS"]

/**
 * Why a request that may change state did not come from this app's own page, or `undefined` when
 * it did. The same rule as the API's guard (`@spy4x/server/http/same-origin`), which works on a Hono
 * context only: `Sec-Fetch-Site` must be `same-origin`, and `Origin` must be `expectedOrigin`, or
 * `null` (a same-origin form post under `Referrer-Policy: no-referrer`).
 *
 * A browser sets both headers itself and a page on another site cannot forge them, so a form there
 * that posts here, sign-out included, is refused before anything reaches the API.
 */
export function crossSiteRefusal(
  request: Request,
  expectedOrigin: string,
): "not-same-origin-fetch" | "origin-mismatch" | undefined {
  if (SAFE_METHODS.includes(request.method)) return undefined
  if (request.headers.get("sec-fetch-site") !== "same-origin") return "not-same-origin-fetch"
  const origin = request.headers.get("origin")
  if (origin !== expectedOrigin && origin !== "null") return "origin-mismatch"
  return undefined
}
