import { signal } from "@preact/signals"
import type { User } from "@shared/types"

export type SessionUser = User

export type SessionState = {
  isReady: boolean
  user: SessionUser | null
  isMfaRequired: boolean
  wsStatus: "idle" | "connecting" | "open" | "closed"
}

export const sessionState = signal<SessionState>({
  isReady: false,
  user: null,
  isMfaRequired: false,
  wsStatus: "idle",
})
