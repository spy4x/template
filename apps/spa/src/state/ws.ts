import { validate, wsProfileEventSchema } from "@shared/types"
import { sessionState } from "./session.ts"

class WsClient {
  private socket: WebSocket | null = null
  private reconnectTimer: number | null = null

  connect() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return
    sessionState.value = { ...sessionState.value, wsStatus: "connecting" }
    const protocol = location.protocol === "https:" ? "wss" : "ws"
    this.socket = new WebSocket(`${protocol}://${location.host}/api/ws/profile`)
    this.socket.addEventListener("open", () => {
      sessionState.value = { ...sessionState.value, wsStatus: "open" }
    })
    this.socket.addEventListener("close", () => {
      sessionState.value = { ...sessionState.value, wsStatus: "closed" }
      this.scheduleReconnect()
    })
    this.socket.addEventListener("error", () => {
      sessionState.value = { ...sessionState.value, wsStatus: "closed" }
      this.scheduleReconnect()
    })
    this.socket.addEventListener("message", (event) => {
      this.handleMessage(event.data)
    })
  }

  disconnect() {
    if (this.socket) {
      this.socket.close()
      this.socket = null
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = globalThis.setTimeout(() => {
      this.reconnectTimer = null
      if (sessionState.value.user && !sessionState.value.isMfaRequired) {
        this.connect()
      }
    }, 1500)
  }

  private handleMessage(raw: string) {
    let parsed: unknown = null
    try {
      parsed = JSON.parse(raw)
    } catch (_error) {
      parsed = null
    }
    if (!parsed) return
    const validationResult = validate(wsProfileEventSchema, parsed)
    if (validationResult.error) return
    const msg = validationResult.data
    if (msg.kind === "profile.updated") {
      sessionState.value = {
        ...sessionState.value,
        user: msg.payload.user,
      }
      return
    }
    if (msg.kind === "push.devices.updated") {
      globalThis.dispatchEvent(
        new CustomEvent("push.devices.updated", {
          detail: msg.payload.devices,
        }),
      )
      return
    }
    if (msg.kind === "auth.signed_out") {
      sessionState.value = {
        ...sessionState.value,
        user: null,
        isMfaRequired: false,
      }
    }
  }
}

export const wsClient = new WsClient()
