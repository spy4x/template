import type { ComponentChildren, JSX } from "preact"
import { Link, useLocation } from "wouter-preact"
import { Shell, type ShellNavItem } from "@spy4x/preact-system/shell"
import { signOut } from "../state/auth.ts"
import type { SessionState, SessionUser } from "../state/session.ts"

/** Every page a signed-in user can open. Add a route here when it gets its own page. */
const NAV_ITEMS: readonly ShellNavItem[] = [{ name: "Profile", href: "/" }]

function Brand() {
  return (
    <Link href="/" class="flex items-center gap-3">
      <span class="h-8 w-8 rounded-xl bg-indigo-500" aria-hidden="true"></span>
      <span class="text-lg font-semibold">Template</span>
    </Link>
  )
}

/**
 * Sends a click on a same-origin link through wouter instead of letting the browser load the page.
 *
 * `Shell` renders plain `<a href>` elements and imports no router, so the app has to pick its links
 * up. A click with a modifier key, on a link with a target or a download, or on an in-page `#` link
 * (the skip link) is left to the browser.
 */
function useRouterLinks(): (event: JSX.TargetedMouseEvent<HTMLElement>) => void {
  const [, navigate] = useLocation()
  return (event) => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const link = (event.target as Element | null)?.closest("a[href]")
    if (!(link instanceof HTMLAnchorElement)) return
    if (link.target || link.hasAttribute("download")) return
    if (link.getAttribute("href")?.startsWith("#")) return
    const url = new URL(link.href)
    if (url.origin !== location.origin) return
    event.preventDefault()
    navigate(`${url.pathname}${url.search}${url.hash}`)
  }
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
  const [location] = useLocation()
  const onClick = useRouterLinks()

  return (
    // `dark` scopes the library's dark palette to the app, which is dark throughout.
    <div class="dark min-h-screen bg-slate-950 text-slate-100" onClick={onClick}>
      <Shell
        brand={<Brand />}
        navItems={NAV_ITEMS}
        currentPath={location}
        user={{ name: displayName(user) }}
        userMenuItems={[{ label: "Sign out", onClick: () => void signOut() }]}
        status={
          <span class="hidden text-xs text-slate-400 sm:inline" data-e2e="shell-ws-status">
            {WS_STATUS_TEXT[wsStatus]}
          </span>
        }
      >
        <div class="mx-auto w-full max-w-5xl px-2 py-6 sm:px-6">{children}</div>
      </Shell>
    </div>
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
    <div class="min-h-screen bg-slate-950 text-slate-100">
      <header class="border-b border-slate-800">
        <div class="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Brand />
          {canSignOut && (
            <button
              type="button"
              data-e2e="signout"
              class="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-slate-500"
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          )}
        </div>
      </header>
      <main class="mx-auto w-full max-w-5xl px-6 py-10">{children}</main>
    </div>
  )
}
