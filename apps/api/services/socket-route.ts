/// <reference lib="deno.ns" />
import { Hono } from "hono"
import type { Context } from "hono"
import { adaptWebSocket } from "@spy4x/realtime"
import { createSameOriginUpgradeGuard } from "@spy4x/server/http/same-origin"
import type { APIContext } from "../_types.ts"
import type { Realtime } from "./realtime.ts"
import type { AppAuthState, SignIn } from "./sign-in.ts"

/** What {@link createSocketRoute} needs from the app. */
export interface SocketRouteDependencies {
  /** The session guards. `isAuthenticated2FA` runs before the Origin check. */
  auth: Pick<SignIn["auth"], "isAuthenticated2FA">
  /**
   * The web app's origin, such as `https://app.example.com`. Behind the TLS-terminating proxy the
   * API sees `http://…`, so it comes from configuration, never from the request.
   */
  expectedOrigin: string
  /** Where an accepted socket goes. */
  realtime: Pick<Realtime, "attach">
  /** Opens the socket and hands it to {@link realtime}. Defaults to `Deno.upgradeWebSocket`. */
  upgrade?: (c: Context<APIContext>, auth: AppAuthState) => Response
}

/**
 * Builds the `GET /` WebSocket route. This is the only place a socket is authenticated:
 *
 * 1. `isAuthenticated2FA` reads the session cookie the handshake carried, with the same rules as a
 *    REST request: no session is 401, and a session that still owes its second factor is 401 too.
 * 2. `Origin` must equal the web app's origin, or the upgrade is refused with 403. A browser
 *    attaches the session cookie to a socket that a page on a sibling subdomain opens, and that
 *    page can read every message; `SameSite=Lax` does not stop it, and CORS does not govern
 *    handshakes.
 *
 * Every later frame is authorized again by {@link Realtime}; nothing here is trusted afterwards.
 */
export function createSocketRoute(deps: SocketRouteDependencies): Hono<APIContext> {
  const upgrade = deps.upgrade ?? ((c, auth) => upgradeWebSocket(c, auth, deps.realtime))
  return new Hono<APIContext>()
    .use(deps.auth.isAuthenticated2FA)
    .get(
      "/",
      createSameOriginUpgradeGuard<APIContext>({ expectedOrigin: deps.expectedOrigin }),
      (c) => {
        const auth = c.get("auth")
        if (!auth) {
          return c.json({ error: "Not authenticated" }, 401)
        }
        if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
          return c.json({ error: "Upgrade required" }, 426)
        }
        return upgrade(c, auth)
      },
    )
}

function upgradeWebSocket(
  c: Context<APIContext>,
  auth: AppAuthState,
  realtime: Pick<Realtime, "attach">,
): Response {
  const { socket, response } = Deno.upgradeWebSocket(c.req.raw)
  realtime.attach(adaptWebSocket(socket), auth)
  return response
}
