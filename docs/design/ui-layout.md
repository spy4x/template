# Laying out a screen

How the SPA's screens arrange preact-components' primitives. The primitives themselves come from
spy4x/preact-components; this page is about placement, spacing and what stays out of sight. The
`libs/ui` contract in `AGENTS.md` still applies to every screen.

The rules came from the owner's review of the first screens: every form was open, every rare
action sat on the page at all times, cards nested inside cards and the spacing was uneven. The
screens were redesigned against these rules in October 2026.

## Principles

1. **One primary action per screen, visible.** Everything else is secondary (a quieter button) or
   supplementary (in an overflow menu, a dialog or a disclosure). Ask of each control: how often
   does a person need it? Daily → on the page. Monthly → one click away. Once or never → in a
   menu, or under a "Danger zone" disclosure at the bottom.
2. **Forms open when asked.** A "create" or "edit" form is closed until the person presses the
   button for it: a `Modal` for a short form (new group, invite someone, change password), or
   `InlineEdit` for one value (rename a group). A name is two fields, so the profile edits it in a
   `Modal`. The note editor is the exception: it is a page of its own, and that is fine.
3. **Hide what cannot happen.** Do not render a section that only explains why its action is
   unavailable ("You own this group, so you cannot leave it", "Nobody else is in this group yet").
   Leave the action out. When a person would otherwise not know the action exists, keep it as a
   disabled item in the overflow menu with a one-line reason beside it, such as "Delete group" with
   "It is your only group". Never put a disabled button on the page itself.
4. **Confirm destructive actions** with `ConfirmDialog` (delete, leave, remove a member, revoke). An
   action that needs the password again (transfer ownership, delete the account) uses a `Modal` with
   a password form and a danger-styled submit button instead. Never put a red button on the page
   next to everyday actions.
5. **Less chrome.** No card inside a card, no card around a single line, no dashed box inside a
   card. A list on its own is a list; a signed-in page's heading is its `PageHeader`, never a
   `CardHeader`. Use `Card` for a genuine group of related content, `Section` for a titled part of a
   page, `EmptyState` for an empty list (with its one action), `Stack`, `Cluster` and `Grid` for
   spacing. Space siblings with their `gap` rather than margins. Any spacing class must be a step on
   the theme's scale, which `tests/spacing.test.ts` enforces.
6. **A readable width.** Forms and reading content sit in a column: `ACCOUNT_COLUMN`
   (`libs/ui/frame.tsx`, 42 rem) for account pages, 48 rem (`max-w-3xl`) for group settings and
   billing. Lists and tables may use the full content width (64 rem). Inputs never stretch 900 px
   wide.
7. **One page header on every signed-in page** (`PageHeader` from `@spy4x/preact-ui/page-header`): the page
   title (h1) on the left; the primary action and, if needed, one overflow `Dropdown` ("More
   actions", a three-dots icon button with that accessible name) on the right. On a phone the title
   stays on one line, truncating if it must, and the actions stay beside it as icon buttons with
   accessible names — never stacked awkwardly under a two-line title. The signed-out screens
   (sign-in, sign-up, password reset, the newsletter) are a centred card with the `h1` inside its
   header instead.
8. **Mobile first.** Design the 375 px layout first; touch targets at least 44 px; nothing scrolls
   sideways. The desktop layout is the same content with more room, not a different screen.
9. **Status only when it matters.** "Online" in the header and "WS: open" on the profile are debug
   output. Show the connection only when it is not live (offline, reconnecting). Keep the
   `data-e2e="shell-ws-status"` element and its text for the e2e tests, visually hidden when online
   (a screen-reader-only span is fine: `toHaveText` reads text content).
10. **Badges carry meaning.** A green "Selected" pill on the current group is noise; show the
    current group by the picker and by a quiet check mark, not a loud badge.

## Primitives to use

`Modal`, `ConfirmDialog`, `Dropdown` + `DropdownItem`, `InlineEdit`, `EmptyState`, `Notice`,
`Page`, `Section`, `Stack`, `Cluster`, `Grid`, `Card*`, `Badge`, `Avatar`, `AvatarGroup`, `Tabs`,
`Tooltip`, `CopyButton`, `Toastr`, `RailShell`, `Shell`. Read each one's signature on
`https://jsr.io/@spy4x/preact-ui/doc` (or `preact-system`) before using it. If a primitive falls
short, the fix belongs in `spy4x/preact-components`, not in a local copy: file an issue there and
work around it minimally until it ships.

Take screenshots of a changed screen at 1280 px and 375 px wide before you call it done, and look
at the phone one first.
