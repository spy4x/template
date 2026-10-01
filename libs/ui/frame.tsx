import type { ComponentChildren, JSX } from "preact"
import { Shell, type ShellNavItem } from "@spy4x/preact-system/shell"
import { Button } from "@spy4x/preact-ui/button"
import { Page } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { GroupPicker, type GroupPickerData } from "./group-picker.tsx"
import {
  FORM_ACTIONS,
  type Navigate,
  NOTE_PATHS,
  SCREEN_PATHS,
  ScreenForm,
} from "./progressive.tsx"

/** Every page a signed-in user can open. Add a route here when it gets its own page. */
const NAV_ITEMS: readonly ShellNavItem[] = [
  { name: "Profile", href: SCREEN_PATHS.profile },
  { name: "Notes", href: NOTE_PATHS.list },
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
    <Link href={SCREEN_PATHS.profile} navigate={navigate} class="flex items-center gap-3">
      <span class="h-8 w-8 rounded-xl bg-primary-muted" aria-hidden="true"></span>
      <span class="text-lg font-semibold">Template</span>
    </Link>
  )
}

/** Accessible name for the user menu: the user's full name, or "User" before they set one. */
function displayName(user: FrameUser): string {
  return `${user.firstName} ${user.lastName}`.trim() || "User"
}

/**
 * The signed-in frame: `Shell` from `@spy4x/preact-system` with this app's brand, navigation, user
 * menu and connection status. Signed-out screens use {@link PublicFrame} instead.
 *
 * With `onSignOut`, "Sign out" is an item of the user menu (a `<details>` that opens without
 * JavaScript): a form that posts to its route, which the app takes over. Without it, a page
 * rendered on the server, "Sign out" is a form in the header. `connection` is shown only when the
 * app has a live connection to report. `groupPicker` puts the group picker at the bottom of the
 * side menu and the mobile drawer; without it the menu has none (nobody to pick for).
 */
export function AppFrame(
  { user, connection, currentPath, navigate, onSignOut, groupPicker, children }: {
    user: FrameUser
    connection?: ConnectionStatus
    currentPath?: string
    navigate?: Navigate
    onSignOut?: () => void
    groupPicker?: GroupPickerData
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
      sidebarBottom={groupPicker &&
        ((place) => <GroupPicker {...groupPicker} navigate={navigate} place={place} />)}
      userMenuItems={onSignOut
        ? [{ label: "Sign out", action: FORM_ACTIONS.signOut, onClick: onSignOut }]
        : []}
      status={
        <>
          {connection && (
            <span class="hidden text-xs text-muted sm:inline" data-e2e="shell-ws-status">
              {CONNECTION_TEXT[connection]}
            </span>
          )}
          {!onSignOut && <SignOutForm />}
        </>
      }
    >
      <div class="mx-auto w-full max-w-5xl px-2 py-6 sm:px-6">{children}</div>
    </Shell>
  )
}

/** "Sign out" as a form that posts to its route; with `onSignOut`, the app takes it over. */
function SignOutForm({ onSignOut }: { onSignOut?: () => void }): JSX.Element {
  return (
    <ScreenForm action={FORM_ACTIONS.signOut} onSubmit={onSignOut}>
      <Button type="submit" variant="outline" data-e2e="signout">
        Sign out
      </Button>
    </ScreenForm>
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
          {canSignOut && <SignOutForm onSignOut={onSignOut} />}
        </div>
      </header>
      <Page as="main" class="py-8">{children}</Page>
    </>
  )
}
