import type { ComponentChildren, JSX } from "preact"
import { Shell, type ShellNavItem } from "@spy4x/preact-system/shell"
import { Button } from "@spy4x/preact-ui/button"
import { Page } from "@spy4x/preact-ui/layout"
import { FORM_ACTIONS, type Navigate, SCREEN_PATHS, ScreenLink, takeOver } from "./progressive.tsx"

/** Every page a signed-in user can open. Add a route here when it gets its own page. */
const NAV_ITEMS: readonly ShellNavItem[] = [
  { name: "Profile", href: SCREEN_PATHS.profile },
  { name: "Groups", href: SCREEN_PATHS.groups },
]

/** Where the live connection to the API stands. */
export type ConnectionStatus = "idle" | "connecting" | "open" | "closed"

const CONNECTION_TEXT: Record<ConnectionStatus, string> = {
  idle: "Offline",
  connecting: "Connecting…",
  open: "Online",
  closed: "Offline",
}

/** The name the user menu shows. */
export interface FrameUser {
  firstName: string
  lastName: string
}

function Brand({ navigate }: { navigate?: Navigate }): JSX.Element {
  return (
    <ScreenLink href={SCREEN_PATHS.profile} navigate={navigate} class="flex items-center gap-3">
      <span class="h-8 w-8 rounded-xl bg-primary-muted" aria-hidden="true"></span>
      <span class="text-lg font-semibold">Template</span>
    </ScreenLink>
  )
}

/** Accessible name for the user menu: the user's full name, or "User" before they set one. */
function displayName(user: FrameUser): string {
  return `${user.firstName} ${user.lastName}`.trim() || "User"
}

/**
 * The signed-in frame: `Shell` from `@spy4x/preact-system` with this app's brand, navigation, user
 * menu and connection status. Signed-out screens use {@link PublicFrame} instead.
 */
export function AppFrame(
  { user, connection, currentPath, navigate, onSignOut, children }: {
    user: FrameUser
    connection: ConnectionStatus
    currentPath?: string
    navigate?: Navigate
    onSignOut: () => void
    children: ComponentChildren
  },
): JSX.Element {
  return (
    <Shell
      brand={<Brand navigate={navigate} />}
      navItems={NAV_ITEMS}
      currentPath={currentPath}
      navigate={navigate}
      user={{ name: displayName(user) }}
      userMenuItems={[{ label: "Sign out", onClick: onSignOut }]}
      status={
        <span class="hidden text-xs text-muted sm:inline" data-e2e="shell-ws-status">
          {CONNECTION_TEXT[connection]}
        </span>
      }
    >
      <div class="mx-auto w-full max-w-5xl px-2 py-6 sm:px-6">{children}</div>
    </Shell>
  )
}

/**
 * The frame for sign-in, sign-up and the second factor: brand, no navigation or user menu. A user
 * who passed the password step but not the second factor still gets a Sign out button.
 */
export function PublicFrame(
  { canSignOut, onSignOut, navigate, children }: {
    canSignOut: boolean
    onSignOut?: () => void
    navigate?: Navigate
    children: ComponentChildren
  },
): JSX.Element {
  return (
    <>
      <header class="border-b border-subtle">
        <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Brand navigate={navigate} />
          {canSignOut && (
            <form method="post" action={FORM_ACTIONS.signOut} onSubmit={takeOver(onSignOut)}>
              <Button type="submit" variant="outline" data-e2e="signout">
                Sign out
              </Button>
            </form>
          )}
        </div>
      </header>
      <Page as="main" class="py-8">{children}</Page>
    </>
  )
}
