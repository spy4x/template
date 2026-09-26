import type { MiddlewareHandler } from "hono"
import { createSameOriginMutationGuard } from "@spy4x/server/http/same-origin"
import type { APIContext } from "../_types.ts"

/**
 * The two same-origin guards every mutating route mounts. Both let GET, HEAD and OPTIONS through
 * and refuse any other request with 403 unless `Origin` is the web app's origin and
 * `Sec-Fetch-Site` is `same-origin`, so another site cannot make a signed-in browser change state.
 */
export interface MutationGuards {
  /**
   * Also requires the session cookie. Mount it after `isAuthenticated1FA` or `isAuthenticated2FA`,
   * so a request with an expired or missing session gets their 401, which sends the front end to
   * sign-in, instead of this guard's 403.
   */
  signedIn: MiddlewareHandler<APIContext>
  /**
   * Does not require the session cookie: for sign-in, sign-up and sign-out, which must work without
   * one. It still stops another site from signing the browser in to an attacker's account.
   */
  anonymous: MiddlewareHandler<APIContext>
}

/**
 * Builds the guards for the web app at `webAppUrl`, such as `https://app.example.com`.
 *
 * The expected origin comes from configuration, never from the request: behind the proxy that
 * terminates TLS the API sees `http://…` while the browser sends `Origin: https://…`, so the
 * request URL's own origin would refuse every mutation.
 */
export function createMutationGuards(webAppUrl: string): MutationGuards {
  const expectedOrigin = new URL(webAppUrl).origin
  return {
    signedIn: createSameOriginMutationGuard<APIContext>({ expectedOrigin }),
    anonymous: createSameOriginMutationGuard<APIContext>({
      expectedOrigin,
      requireSessionCookie: false,
    }),
  }
}
