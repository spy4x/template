import { Context } from "hono"
import type { RequestInfo } from "@platform/types"
import type { WsProfileEvent } from "@domain/identity"
import { APIContext } from "../_types.ts"
import { validate } from "@platform/types"
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
