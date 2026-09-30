import { Context, Hono } from "hono"
import type { RequestInfo } from "@spy4x/platform/request-info"
import { requestInfoFromContext } from "@spy4x/platform/request-info"
import { createSameOriginUpgradeGuard } from "@spy4x/server/http/same-origin"
import type { WsProfileEvent } from "@domain/identity"
import { APIContext } from "../_types.ts"
import type { SignIn } from "./sign-in.ts"
import { validate } from "@spy4x/validation"
import { wsReadyEventSchema } from "@domain/identity"
type WsClient = {
  userId: number
  socket: WebSocket
}

class WsHub {
  private clients = new Map<string, WsClient>()

  upgradeProfile(c: Context<APIContext>, userId: number, request: RequestInfo): Response {
    const upgrade = c.req.raw.headers.get("upgrade")?.toLowerCase()
    if (upgrade !== "websocket") {
      return c.json({ error: "Upgrade required" }, 426)
    }
    const { socket, response } = Deno.upgradeWebSocket(c.req.raw)
    const clientId = crypto.randomUUID()

    socket.addEventListener("open", () => {
      this.clients.set(clientId, { userId, socket })
      const payload = { kind: "ws.ready", payload: { requestId: request.requestId ?? null } }
      const validationResult = validate(wsReadyEventSchema, payload)
      if (!validationResult.error) {
        socket.send(JSON.stringify(validationResult.data))
      }
    })
    socket.addEventListener("close", () => {
      this.clients.delete(clientId)
    })
    socket.addEventListener("error", () => {
      this.clients.delete(clientId)
    })

    return response
  }

  broadcastToUser(userId: number, event: WsProfileEvent) {
    const message = JSON.stringify(event)
    for (const client of this.clients.values()) {
      if (client.userId === userId) {
        try {
          client.socket.send(message)
        } catch (_error) {
          // ignore
        }
      }
    }
  }
}

export const wsHub = new WsHub()

/** What {@link createProfileSocketRoute} needs from the app. */
export interface ProfileSocketRouteDependencies {
  /** The session guards. `isAuthenticated2FA` runs before the Origin check. */
  auth: Pick<SignIn["auth"], "isAuthenticated2FA">
  /**
   * The web app's origin, such as `https://app.example.com`. Behind the TLS-terminating proxy the
   * API sees `http://…`, so it comes from configuration, never from the request.
   */
  expectedOrigin: string
  /** Opens the socket. Defaults to the shared hub's `upgradeProfile`. */
  upgrade?: (c: Context<APIContext>, userId: number, request: RequestInfo) => Response
}

/**
 * Builds the `GET /profile` WebSocket route. A browser attaches the session cookie to a socket that
 * a page on a sibling subdomain opens, and that page can read every message, so the upgrade is
 * refused with 403 unless `Origin` equals the web app's origin.
 */
export function createProfileSocketRoute(deps: ProfileSocketRouteDependencies): Hono<APIContext> {
  const upgrade = deps.upgrade ?? ((c, userId, request) => wsHub.upgradeProfile(c, userId, request))
  return new Hono<APIContext>()
    .use(deps.auth.isAuthenticated2FA)
    .get(
      "/profile",
      createSameOriginUpgradeGuard<APIContext>({ expectedOrigin: deps.expectedOrigin }),
      (c) => {
        const auth = c.get("auth")
        if (!auth) {
          return c.json({ error: "Not authenticated" }, 401)
        }
        // trustedProxy: true keeps the old behaviour of trusting X-Forwarded-For / X-Real-IP — the
        // template's production compose runs behind Traefik, which overwrites these headers.
        return upgrade(c, auth.user.id, requestInfoFromContext(c, { trustedProxy: true }))
      },
    )
}
