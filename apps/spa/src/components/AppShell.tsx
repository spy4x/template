import type { ComponentChildren } from "preact"
import { Link, useLocation } from "wouter-preact"
import { Shell, type ShellNavItem } from "@spy4x/preact-system/shell"
import { Button } from "@spy4x/preact-ui/button"
import { Page } from "@spy4x/preact-ui/layout"
import { signOut } from "../state/auth.ts"
import type { SessionState, SessionUser } from "../state/session.ts"

/** Every page a signed-in user can open. Add a route here when it gets its own page. */
const NAV_ITEMS: readonly ShellNavItem[] = [{ name: "Profile", href: "/" }]

function Brand() {
  return (
    <Link href="/" class="flex items-center gap-3">
      <span class="h-8 w-8 rounded-xl bg-primary-muted" aria-hidden="true"></span>
      <span class="text-lg font-semibold">Template</span>
    </Link>
  )
}

/** Accessible name for the user menu: the user's full name, or "User" before they set one. */
function displayName(user: SessionUser): string {
  return `${user.firstName} ${user.lastName}`.trim() || "User"
}

const WS_STATUS_TEXT: Record<SessionState["wsStatus"], string> = {
  idle: "Offline",
  connecting: "Connecting…",
  open: "Online",
  closed: "Offline",
}

/**
 * The signed-in frame: `Shell` from `@spy4x/preact-system` with this app's brand, navigation, user
 * menu and WebSocket status. Signed-out screens use {@link PublicFrame} instead.
 */
export function AppShell(
  { user, wsStatus, children }: {
    user: SessionUser
    wsStatus: SessionState["wsStatus"]
    children: ComponentChildren
  },
) {
  const [location, navigate] = useLocation()

  return (
    <Shell
      brand={<Brand />}
      navItems={NAV_ITEMS}
      currentPath={location}
      navigate={navigate}
      user={{ name: displayName(user) }}
      userMenuItems={[{ label: "Sign out", onClick: () => void signOut() }]}
      status={
        <span class="hidden text-xs text-muted sm:inline" data-e2e="shell-ws-status">
          {WS_STATUS_TEXT[wsStatus]}
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
  { canSignOut, children }: { canSignOut: boolean; children: ComponentChildren },
) {
  return (
    <>
      <header class="border-b border-subtle">
        <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Brand />
          {canSignOut && (
            <Button
              variant="outline"
              data-e2e="signout"
              onClick={() => void signOut()}
            >
              Sign out
            </Button>
          )}
        </div>
      </header>
      <Page as="main" class="py-8">{children}</Page>
    </>
  )
}
