import { signal } from "@preact/signals"
import type { User } from "@domain/identity"
export type SessionUser = User
/** What the API answers with (202) while the session still owes its one-time code. */
export type PendingSecondFactor = { secondFactor: "Pending" }

export type SessionState = {
  isReady: boolean
  user: SessionUser | null
  isMfaRequired: boolean
  wsStatus: "idle" | "connecting" | "open" | "closed"
  /**
   * How the page came back to the app while the socket was not open: "quiet" for the first
   * seconds, when a reconnect is expected and nothing should warn, "slow" once it took longer.
   * "none" at every other time. Read through `connectionDisplay`.
   */
  wsResume: "none" | "quiet" | "slow"
}

export const sessionState = signal<SessionState>({
  isReady: false,
  user: null,
  isMfaRequired: false,
  wsStatus: "idle",
  wsResume: "none",
})

/**
 * Whether the public frame offers "Sign out": a session that owes its one-time code has no user
 * yet, but it still holds a cookie the person must be able to end.
 */
export function canSignOut(state: Pick<SessionState, "user" | "isMfaRequired">): boolean {
  return state.user !== null || state.isMfaRequired
}
