import type { ComponentChildren } from "preact"
import { useLocation } from "wouter-preact"
import { AppFrame, PublicFrame as PublicFrameScreen } from "@ui/frame.tsx"
import { signOut } from "../state/auth.ts"
import type { SessionState, SessionUser } from "../state/session.ts"

/** Wires the signed-in `AppFrame` to this app's router and `signOut`. */
export function AppShell(
  { user, wsStatus, children }: {
    user: SessionUser
    wsStatus: SessionState["wsStatus"]
    children: ComponentChildren
  },
) {
  const [location, navigate] = useLocation()
  return (
    <AppFrame
      user={user}
      connection={wsStatus}
      currentPath={location}
      navigate={navigate}
      onSignOut={() => void signOut()}
    >
      {children}
    </AppFrame>
  )
}

/** Wires the signed-out `PublicFrame` to this app's router and `signOut`. */
export function PublicFrame(
  { canSignOut, children }: { canSignOut: boolean; children: ComponentChildren },
) {
  const [, navigate] = useLocation()
  return (
    <PublicFrameScreen
      canSignOut={canSignOut}
      navigate={navigate}
      onSignOut={() => void signOut()}
    >
      {children}
    </PublicFrameScreen>
  )
}
