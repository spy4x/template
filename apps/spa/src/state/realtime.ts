import {
  ClientTransport,
  ConnectionLostError,
  createSystemClock,
  createWebSocketFactory,
  type GapReport,
  type KeyValueStore,
  PersistentCursorStore,
  TransportStatus,
} from "@spy4x/realtime"
import { apiFetch } from "./api.ts"
import { type CallPort, type RetryOptions, sendCommand, sendQuery } from "./realtime-call.ts"
import { sessionState } from "./session.ts"

type ConnectionStatus = "idle" | "connecting" | "open" | "closed"

const STATUS_TEXT: Record<TransportStatus, ConnectionStatus> = {
  [TransportStatus.Idle]: "idle",
  [TransportStatus.Connecting]: "connecting",
  [TransportStatus.Open]: "open",
  [TransportStatus.Reconnecting]: "closed",
  [TransportStatus.Stopped]: "closed",
}

/** `localStorage`, or a store that forgets when the browser blocks it. */
function browserStorage(): KeyValueStore {
  const memory = new Map<string, string>()
  return {
    getItem(key) {
      try {
        return localStorage.getItem(key)
      } catch (_error) {
        return memory.get(key) ?? null
      }
    },
    setItem(key, value) {
      memory.set(key, value)
      try {
        localStorage.setItem(key, value)
      } catch (_error) {
        // Blocked storage: the cursor lives until the page closes, and the next load pulls again.
      }
    },
    removeItem(key) {
      memory.delete(key)
      try {
        localStorage.removeItem(key)
      } catch (_error) {
        // Nothing stored, nothing to remove.
      }
    },
  }
}

/**
 * Checked before every reconnect. A session that ended (signed out elsewhere, expired, or owing
 * its second factor) stops the reconnect and signs the page out; a network error or a server error
 * says nothing about the session, so the transport keeps trying.
 */
async function gate(): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const me = await apiFetch("/api/auth/me")
    if (me.ok && me.status !== 202) return { allowed: true }
    if (!me.ok && me.status !== 401 && me.status !== 403) return { allowed: true }
  } catch (_error) {
    return { allowed: true }
  }
  sessionState.value = { ...sessionState.value, user: null, isMfaRequired: false }
  return { allowed: false, reason: "The session ended" }
}

interface Connection {
  userId: number
  transport: ClientTransport
  cursors: PersistentCursorStore
  stopStatus: () => void
}

let current: Connection | null = null

function socketUrl(): string {
  const protocol = location.protocol === "https:" ? "wss" : "ws"
  return `${protocol}://${location.host}/api/ws`
}

function cursorsFor(userId: number): PersistentCursorStore {
  // One namespace per user, so a second person on this browser never inherits a cursor.
  return new PersistentCursorStore({
    storage: browserStorage(),
    namespace: `realtime:user:${userId}`,
    clock: createSystemClock(),
  })
}

/**
 * Opens the socket for a signed-in user and keeps it open. `pull` is the REST read that brings the
 * page up to date: the transport calls it after every reconnect and for every hint that is news.
 * Calling it again for the same user does nothing.
 */
export function connectRealtime(userId: number, pull: (gap: GapReport) => void | Promise<void>) {
  if (current?.userId === userId) return
  disconnectRealtime()
  const cursors = cursorsFor(userId)
  const transport = new ClientTransport({
    url: socketUrl(),
    socketFactory: createWebSocketFactory(),
    clock: createSystemClock(),
    cursors,
    pull,
    gate,
  })
  const stopStatus = transport.onStatus((snapshot) => {
    sessionState.value = { ...sessionState.value, wsStatus: STATUS_TEXT[snapshot.status] }
  })
  current = { userId, transport, cursors, stopStatus }
  sessionState.value = { ...sessionState.value, wsStatus: "connecting" }
  transport.connect()
}

/** Closes the socket. `forget` also drops the cursors, as signing out must. */
export function disconnectRealtime({ forget = false } = {}): void {
  if (!current) return
  const { transport, cursors, stopStatus } = current
  current = null
  stopStatus()
  transport.stop()
  if (forget) cursors.clear()
  sessionState.value = { ...sessionState.value, wsStatus: "idle" }
}

/** Records that the page now holds a group up to `sequence`, so a later hint for it is a repeat. */
export function advanceGroupCursor(groupId: string, sequence: number): void {
  current?.cursors.advanceTo(groupId, sequence)
}

/** Whether the socket is open now, so a call made this moment can reach the server. */
export function isRealtimeOpen(): boolean {
  return sessionState.value.wsStatus === "open"
}

/** Calls over the open socket. Without one, every call fails as a dropped connection. */
export const realtimePort: CallPort = {
  command(name, payload, options) {
    if (!current) return Promise.reject(new ConnectionLostError("the socket is not open"))
    return current.transport.command(name, payload, options)
  },
  query(name, payload) {
    if (!current) return Promise.reject(new ConnectionLostError("the socket is not open"))
    return current.transport.query(name, payload)
  },
}

/** A command over the socket with an idempotency key, sent again with the same key if it drops. */
export function realtimeCommand<T>(
  name: string,
  payload: unknown,
  options?: RetryOptions,
): Promise<T> {
  return sendCommand<T>(realtimePort, name, payload, options)
}

/** A query over the socket, sent again if the socket drops. */
export function realtimeQuery<T>(name: string, payload?: unknown, options?: RetryOptions) {
  return sendQuery<T>(realtimePort, name, payload, options)
}
