import type { ComponentChildren, JSX } from "preact"
import { canViewActivity } from "@domain/groups"
import {
  IconBell,
  IconClock,
  IconDocumentText,
  IconSprout,
  IconTag,
  IconUser,
  IconUsers,
} from "@spy4x/preact-icons"
import { AccountMenu } from "@spy4x/preact-system/account-menu"
import {
  RailShell,
  type RailShellItem,
  type RailShellSidebarPlace,
} from "@spy4x/preact-system/rail-shell"
import { Avatar } from "@spy4x/preact-ui/avatar"
import { badgeClasses } from "@spy4x/preact-ui/badge"
import { BrandMark } from "@spy4x/preact-ui/brand-mark"
import { Button } from "@spy4x/preact-ui/button"
import { Page } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { GroupPicker, type GroupPickerData } from "./group-picker.tsx"
import {
  GROUP_PATHS,
  type Navigate,
  NOTE_PATHS,
  SCREEN_PATHS,
  ScreenForm,
  TAG_PATHS,
} from "./progressive.tsx"
import { placeHook } from "./shell-place.ts"

/**
 * The daily destinations, in the order the rail and the phone tab bar show them. Five at most, so
 * the phone bar needs no "More". Activity belongs to the selected group and shows only while there
 * is one whose log the person may read.
 */
export function navItems(activityGroupId: string | null): RailShellItem[] {
  return [
    { key: "notes", label: "Notes", href: NOTE_PATHS.list, Icon: IconDocumentText },
    { key: "tags", label: "Tags", href: TAG_PATHS.list, Icon: IconTag },
    ...(activityGroupId === null ? [] : [{
      key: "activity",
      label: "Activity",
      href: GROUP_PATHS.activity(activityGroupId),
      Icon: IconClock,
    }]),
    { key: "groups", label: "Groups", href: SCREEN_PATHS.groups, Icon: IconUsers },
    { key: "profile", label: "Profile", href: SCREEN_PATHS.profile, Icon: IconUser },
  ]
}

/**
 * The navigation entry a path belongs to: a note belongs to Notes, a group's activity log to
 * Activity, any other group page to Groups, and the e-mail page to Profile, where it is opened from.
 */
export function navKey(path: string | undefined): string | undefined {
  if (path === undefined) return undefined
  if (path === NOTE_PATHS.list || path.startsWith(`${NOTE_PATHS.list}/`)) return "notes"
  if (path === TAG_PATHS.list || path.startsWith(`${TAG_PATHS.list}/`)) return "tags"
  if (/^\/groups\/[^/]+\/activity\/?$/.test(path)) return "activity"
  if (path === SCREEN_PATHS.groups || path.startsWith(`${SCREEN_PATHS.groups}/`)) return "groups"
  if (path === SCREEN_PATHS.profile || path === SCREEN_PATHS.email) return "profile"
  return undefined
}

/** Where the live connection to the API stands. */
export type ConnectionStatus = "idle" | "connecting" | "open" | "closed" | "reconnecting"

const CONNECTION_TEXT: Record<ConnectionStatus, string> = {
  idle: "Offline",
  connecting: "Connecting…",
  open: "Online",
  closed: "Offline",
  reconnecting: "Reconnecting…",
}

/**
 * Whether a person needs to see the connection. A live one, or one still opening at start-up, is
 * not news; offline and reconnecting are, because changes wait until it is back.
 */
export function connectionIsNews(status: ConnectionStatus): boolean {
  return status === "idle" || status === "closed" || status === "reconnecting"
}

/** Who is signed in, as the account menu shows it. */
export interface FrameUser {
  firstName: string
  lastName: string
  /** The address the account signs in with; left out or `null` while unknown or for a username. */
  email?: string | null
}

/** A theme the person can choose in the account menu; `"system"` follows the device. */
export type ThemeChoice = "system" | "light" | "dark"

/**
 * The slice of the app's theme store the account menu reads and writes, described by shape so this
 * package imports no store: `createThemeStore()` from `@spy4x/preact-signals/theme` satisfies it.
 */
export interface FrameTheme {
  readonly preference: { readonly value: ThemeChoice }
  set(preference: ThemeChoice): void
}

/**
 * The product's mark and name, on the signed-out pages. It leads to `/`, which the sign-in gate
 * answers. The signed-in frame draws no mark: its sidebar starts with the group switcher.
 */
function Brand({ navigate }: { navigate?: Navigate }): JSX.Element {
  return (
    <Link href={SCREEN_PATHS.profile} navigate={navigate} class="flex shrink-0 rounded-md">
      <BrandMark Icon={IconSprout} name="Seed" />
    </Link>
  )
}

/** The user's full name, or "User" before they set one. */
function displayName(user: FrameUser): string {
  return `${user.firstName} ${user.lastName}`.trim() || "User"
}

/** The most the bell's badge writes; more reads "99+" so the badge keeps its size. */
const BADGE_MAX = 99

/** The bell's accessible name: `Notifications`, or `Notifications, 3 unread`. */
export function bellLabel(unreadCount: number): string {
  return unreadCount > 0 ? `Notifications, ${unreadCount} unread` : `Notifications`
}

/**
 * The inbox at the bottom of the sidebar: a link to the notifications page with the unread count in
 * a badge while there is any. The labelled sidebar and the phone overlay draw it as a row with its
 * word; the 72 px rail draws the bell alone, 44 px square. The count is part of the link's name, so
 * a screen reader hears it; the badge itself is hidden from it.
 */
function NotificationBell(
  { unreadCount, navigate, current, place }: {
    unreadCount: number
    navigate?: Navigate
    /** Whether the notifications page is the one shown. */
    current: boolean
    place: RailShellSidebarPlace
  },
): JSX.Element {
  const rail = place === "rail"
  const count = unreadCount > BADGE_MAX ? `${BADGE_MAX}+` : String(unreadCount)
  return (
    <Link
      href={SCREEN_PATHS.notifications}
      navigate={navigate}
      aria-label={bellLabel(unreadCount)}
      aria-current={current ? "page" : undefined}
      class={[
        "relative flex items-center rounded-md text-sm hover:bg-canvas",
        rail ? "mx-auto size-11 justify-center" : "min-h-11 gap-3 px-3 py-2 font-medium",
        current ? "bg-canvas font-semibold text-foreground" : "text-muted hover:text-foreground",
      ].join(" ")}
      data-e2e={placeHook("shell-bell", place)}
    >
      <IconBell class="size-6 shrink-0" aria-hidden="true" />
      {!rail && <span class="min-w-0 flex-1 truncate">Notifications</span>}
      {unreadCount > 0 && (
        <span
          class={badgeClasses(
            "red",
            "filled",
            rail
              ? "absolute top-1 right-1 min-w-4 justify-center px-1 py-0 text-[10px] leading-4"
              : "min-w-5 justify-center px-1.5 py-0 text-xs",
          )}
          aria-hidden="true"
          data-e2e={placeHook("shell-bell-count", place)}
        >
          {count}
        </span>
      )}
    </Link>
  )
}

/**
 * The connection, at the top of the page's column. Its text is always there for screen readers and the e2e specs;
 * a person sees it only while it is news ({@link connectionIsNews}).
 */
function ConnectionState({ status }: { status: ConnectionStatus }): JSX.Element {
  const visible = connectionIsNews(status)
  return (
    <span
      class={visible
        ? "inline-flex items-center gap-2 self-start rounded-full bg-warning-soft px-3 py-1 text-xs font-medium text-warning"
        : "sr-only"}
      role="status"
      data-e2e="shell-ws-status"
    >
      {CONNECTION_TEXT[status]}
    </span>
  )
}

/**
 * The sidebar's bottom in one place: the inbox, then the account menu with the account's pages,
 * the theme and Sign out. The rail draws both as icons; the menu opens upward from the bottom.
 * Profile and Notifications are buttons that go through `navigate`: the library's menu takes no
 * router port for a link yet (preact-components#780).
 */
function SidebarBottom(
  { user, theme, navigate, onSignOut, unreadCount, currentPath, place }: {
    user: FrameUser
    theme?: FrameTheme
    navigate?: Navigate
    onSignOut: () => void
    unreadCount?: number
    currentPath?: string
    place: RailShellSidebarPlace
  },
): JSX.Element {
  // Without a router the two pages are plain links. The phone's sheet lists both right above the
  // menu, and a taller menu would open past the sheet's top, so there it offers the theme and
  // sign-out only.
  const go = (path: string) => navigate ? { onClick: () => navigate(path) } : { href: path }
  return (
    <div class="flex flex-col gap-1 px-1" data-e2e={placeHook("shell-account", place)}>
      {unreadCount !== undefined && (
        <NotificationBell
          unreadCount={unreadCount}
          navigate={navigate}
          current={currentPath === SCREEN_PATHS.notifications}
          place={place}
        />
      )}
      <div class={place === "rail" ? "flex justify-center" : "flex"}>
        <AccountMenu
          user={{ name: displayName(user), email: user.email ?? undefined }}
          display={place === "rail" ? "avatar" : "full"}
          items={place === "overlay" ? [] : [
            {
              label: "Profile",
              ...go(SCREEN_PATHS.profile),
              dataE2E: placeHook("shell-menu-profile", place),
            },
            {
              label: "Notifications",
              ...go(SCREEN_PATHS.notifications),
              dataE2E: placeHook("shell-menu-notifications", place),
            },
          ]}
          theme={theme?.preference.value}
          onThemeChange={theme && ((choice) => theme.set(choice))}
          signOut={{ label: "Sign out", onClick: onSignOut, dataE2E: placeHook("signout", place) }}
          dataE2E={placeHook("shell-user-menu-button", place)}
          labels={{ trigger: `Account: ${displayName(user)}` }}
        />
      </div>
    </div>
  )
}

/**
 * The signed-in frame, mobile first (`RailShell`, with no top bar): a labelled sidebar from `lg`, a
 * 72 px icon rail from `md`, and a bottom tab bar on a phone. The sidebar is the only chrome: the
 * group switcher on top, the navigation, then the inbox's bell with its unread count and the
 * account menu at the bottom. On a phone the bar's last slot, the person's avatar, opens a sheet
 * with the same three. The connection shows at the top of the page's column while it is not live.
 *
 * Every page sits in one centred column of 48 rem (`Page`); `wide` gives a data table 64 rem, and a
 * form never needs it. `banner` shows at the top of that column, above the page's own header, such
 * as the request to verify the e-mail address. Screens set no width of their own. Signed-out
 * screens use {@link PublicFrame} instead.
 *
 * The navigation entries are real links; with `navigate`, a plain click on one goes through the
 * app's router instead of loading the page, and a Ctrl- or middle-click still opens a new tab.
 */
export function AppFrame(
  {
    user,
    theme,
    connection,
    currentPath,
    navigate,
    onSignOut,
    groupPicker,
    banner,
    unreadCount,
    wide = false,
    children,
  }: {
    user: FrameUser
    /** The theme store; left out, the account menu offers no theme. */
    theme?: FrameTheme
    connection?: ConnectionStatus
    currentPath?: string
    navigate?: Navigate
    onSignOut: () => void
    groupPicker?: GroupPickerData
    banner?: ComponentChildren
    /** How many notifications are unread. Left out, the sidebar has no bell. */
    unreadCount?: number
    /** Gives the page the wider column (64 rem), for a data table that needs it. */
    wide?: boolean
    children: ComponentChildren
  },
): JSX.Element {
  const selected = groupPicker?.groups.find((group) => group.id === groupPicker.selectedId)
  const activityGroupId = selected && canViewActivity(selected.role) ? selected.id : null
  return (
    <RailShell
      items={navItems(activityGroupId)}
      currentKey={navKey(currentPath)}
      navigateLink={navigate && ((_key, href) => navigate(href))}
      sidebarTop={groupPicker &&
        ((place) => (
          <div class="px-1">
            <GroupPicker {...groupPicker} navigate={navigate} place={place} />
          </div>
        ))}
      sidebarBottom={(place) => (
        <SidebarBottom
          user={user}
          theme={theme}
          navigate={navigate}
          onSignOut={onSignOut}
          unreadCount={unreadCount}
          currentPath={currentPath}
          place={place}
        />
      )}
      moreTab={{ icon: <Avatar name={displayName(user)} alt="" size="sm" />, counter: unreadCount }}
      labels={{ more: "Account", moreDialog: "Account" }}
    >
      <Page class={wide ? "max-w-5xl py-6 sm:py-8" : "max-w-3xl py-6 sm:py-8"}>
        {connection && <ConnectionState status={connection} />}
        {banner}
        {children}
      </Page>
    </RailShell>
  )
}

/** "Sign out" as a form whose submit the app takes through `onSignOut`. */
function SignOutForm({ onSignOut }: { onSignOut: () => void }): JSX.Element {
  return (
    <ScreenForm onSubmit={onSignOut}>
      <Button type="submit" variant="ghost" data-e2e="signout">
        Sign out
      </Button>
    </ScreenForm>
  )
}

/**
 * The frame for sign-in, sign-up, the second factor and the other signed-out pages: the brand above
 * a narrow, centred column, aligned with it. A user who passed the password step but not the second
 * factor also gets Sign out.
 */
export function PublicFrame(
  { canSignOut, onSignOut, navigate, children }: {
    canSignOut: boolean
    onSignOut: () => void
    navigate?: Navigate
    children: ComponentChildren
  },
): JSX.Element {
  return (
    <div class="flex min-h-dvh flex-col">
      <header class="mx-auto flex w-full max-w-md items-center justify-between gap-4 px-4 pt-8 pb-6 sm:pt-16">
        <Brand navigate={navigate} />
        {canSignOut && <SignOutForm onSignOut={onSignOut} />}
      </header>
      <main class="mx-auto w-full max-w-md px-4 pb-12">{children}</main>
    </div>
  )
}
