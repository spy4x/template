import { signal } from "@preact/signals"
import type { User, UserProfile } from "@shared/types"

export type SessionUser = User
export type SessionProfile = UserProfile | null

export type SessionState = {
  isReady: boolean
  user: SessionUser | null
  profile: SessionProfile
  isMfaRequired: boolean
  wsStatus: "idle" | "connecting" | "open" | "closed"
}

export const sessionState = signal<SessionState>({
  isReady: false,
  user: null,
  profile: null,
  isMfaRequired: false,
  wsStatus: "idle",
})
