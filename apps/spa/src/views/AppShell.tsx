import type { ComponentChildren } from "preact"
import { useLocation } from "wouter-preact"
import { NOTE_PATHS } from "@ui/progressive.tsx"
import { AppFrame, PublicFrame as PublicFrameScreen } from "@ui/frame.tsx"
import { signOut } from "../state/auth.ts"
import { groupsStore } from "../state/groups.ts"
import { selectionStore } from "../state/selection.ts"
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
      groupPicker={{
        groups: groupsStore.groups.value,
        selectedId: selectionStore.groupId.value,
        onSelect: (groupId) => {
          void selectionStore.select(groupId)
          // An open note belongs to the group just left.
          if (location.startsWith(`${NOTE_PATHS.list}/`)) navigate(NOTE_PATHS.list)
        },
      }}
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
