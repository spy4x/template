import type { ComponentChildren, ComponentType, JSX, RefObject } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { IconArrowLeft, IconEllipsisVertical, type IconProps } from "@spy4x/preact-icons"
import { Button, type ButtonVariant } from "@spy4x/preact-ui/button"
import { Dropdown } from "@spy4x/preact-ui/dropdown"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import type { Navigate } from "./progressive.tsx"

// The page header below has the same props as the shared `page-header.tsx` that the frame's lane
// adds (spy4x/template#269), plus `heading`. It stays local to the group screens until the two are
// merged into one; then these screens import that one instead.

/** Touch targets in the header are 44 px on a phone and the library's own size from `sm` up. */
const TOUCH = "min-h-11 min-w-11 justify-center sm:min-h-9 sm:min-w-9"

export interface PageHeaderProps {
  /** The page's `h1` text. It stays on one line and truncates; the full text is its tooltip. */
  title: string
  /** Drawn inside the `h1` in place of `title`, such as a field that renames in place. */
  heading?: ComponentChildren
  /** One quiet line under the title, such as the person's role. */
  subtitle?: ComponentChildren
  /** A link back to the parent page, drawn as an arrow before the title. `label` is its name. */
  back?: { href: string; label: string }
  /** Follows `back` without a page load. */
  navigate?: Navigate
  /** The page's one primary action, usually a {@link PageAction}. */
  action?: ComponentChildren
  /**
   * The page's supplementary actions, as `DropdownItem`s. Given, they sit behind one "More
   * actions" button (three dots) after the primary action.
   */
  menu?: ComponentChildren
  /** `data-e2e` of the overflow button. */
  menuDataE2E?: string
  /** `data-e2e` of the `h1`. */
  titleDataE2E?: string
}

/**
 * The header a group page starts with: an optional back arrow, the title and a subtitle on the
 * left, the primary action and an optional "More actions" menu on the right. On a phone the title
 * keeps to one line and the actions stay beside it.
 */
export function PageHeader(
  { title, heading, subtitle, back, navigate, action, menu, menuDataE2E, titleDataE2E }:
    PageHeaderProps,
): JSX.Element {
  return (
    <header class="flex min-w-0 items-center gap-3" data-e2e="page-header">
      {back && (
        <Button
          href={back.href}
          navigate={navigate}
          variant="icon"
          size="md"
          aria-label={back.label}
          class={`-ml-2 ${TOUCH}`}
          data-e2e="page-back"
        >
          <IconArrowLeft class="size-5" aria-hidden="true" />
        </Button>
      )}
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <h1
          class="truncate text-xl font-semibold sm:text-2xl"
          title={title}
          data-e2e={titleDataE2E}
        >
          {heading ?? title}
        </h1>
        {subtitle && <p class="truncate text-sm text-muted">{subtitle}</p>}
      </div>
      {(action || menu) && (
        <div class="flex shrink-0 items-center gap-2">
          {action}
          {menu && <MoreMenu label="More actions" dataE2E={menuDataE2E}>{menu}</MoreMenu>}
        </div>
      )}
    </header>
  )
}

/** A three-dots button that opens a menu of `DropdownItem`s, named by `label`. */
export function MoreMenu(
  { label, dataE2E, children }: { label: string; dataE2E?: string; children: ComponentChildren },
): JSX.Element {
  return (
    <Dropdown
      triggerLabel={label}
      menuLabel={label}
      triggerDataE2E={dataE2E}
      triggerClasses={`inline-flex items-center rounded-md text-muted hover:bg-hover hover:text-foreground ${TOUCH}`}
      trigger={<IconEllipsisVertical class="size-5" aria-hidden="true" />}
    >
      {children}
    </Dropdown>
  )
}

/** What {@link PageAction} takes; either `href` (a link) or `onClick` (a button). */
export interface PageActionProps {
  /** Visible from `sm` up, and always the accessible name. */
  label: string
  /** Shown on every screen; on a phone it is all a person sees of the action. */
  Icon: ComponentType<IconProps>
  href?: string
  navigate?: Navigate
  onClick?: () => void
  variant?: ButtonVariant
  dataE2E?: string
}

/**
 * A page header's primary action: icon and label from `sm` up, the icon alone on a phone. The label
 * stays in the markup for screen readers, so the button keeps its name at every width.
 */
export function PageAction(
  { label, Icon, href, navigate, onClick, variant = "primary", dataE2E }: PageActionProps,
): JSX.Element {
  const content = (
    <>
      <Icon class="size-5" aria-hidden="true" />
      <span class="sr-only sm:not-sr-only">{label}</span>
    </>
  )
  return href !== undefined
    ? (
      <Button href={href} navigate={navigate} variant={variant} class={TOUCH} data-e2e={dataE2E}>
        {content}
      </Button>
    )
    : (
      <Button type="button" variant={variant} onClick={onClick} class={TOUCH} data-e2e={dataE2E}>
        {content}
      </Button>
    )
}

/**
 * Calls `onDone` when an action that was `pending` finishes without `failed`: a dialog closes once
 * its request worked, and stays open with the error when it did not.
 */
export function useClosesWhenDone(pending: boolean, failed: boolean, onDone: () => void): void {
  const was = useRef(pending)
  useEffect(() => {
    if (was.current && !pending && !failed) onDone()
    was.current = pending
  }, [pending, failed])
}

/**
 * Hides an error left from an earlier attempt when its dialog opens again. Call the returned
 * function when the dialog opens: the error that is there then stays hidden until the next attempt
 * starts (`pending` turns true), so a dialog never opens on an old refusal.
 */
export function useFreshError(
  error: string | null,
  pending: boolean,
): [string | null, () => void] {
  const [stale, setStale] = useState<string | null>(null)
  useEffect(() => {
    if (pending) setStale(null)
  }, [pending])
  return [error !== null && error === stale ? null : error, () => setStale(error)]
}

/**
 * Keeps focus on the page when a row leaves a list after its own removal (`pendingId`) was in
 * flight: it moves to the menu of the row that took its place, else of a later row, else to
 * `fallback()`. Without this, focus falls to the page's body with the row's menu.
 *
 * `list` is the list element whose `li` children are the rows, in the order of `ids`.
 */
export function useFocusAfterRemoval(
  list: RefObject<HTMLElement>,
  ids: readonly (string | number)[] | null,
  pendingId: string | number | null,
  fallback: () => HTMLElement | null | undefined,
): void {
  const awaited = useRef<{ id: string | number; index: number } | null>(null)
  const known = useRef(ids)
  if (pendingId !== null && awaited.current?.id !== pendingId) {
    awaited.current = { id: pendingId, index: known.current?.indexOf(pendingId) ?? -1 }
  }
  const key = ids?.join(",") ?? null
  useEffect(() => {
    known.current = ids
    const gone = awaited.current
    if (!gone || ids === null || ids.includes(gone.id)) return
    awaited.current = null
    const rows = Array.from(list.current?.children ?? []).slice(Math.max(gone.index, 0))
    const menu = rows.map((row) => row.querySelector("button")).find((button) => button !== null)
    ;(menu ?? fallback())?.focus()
  }, [key])
}

/**
 * A refusal with no field to sit under: an alert that takes focus when it appears, so a keyboard
 * or screen reader user lands on it.
 */
export function FocusedError(
  { message, dataE2E }: { message: string | null; dataE2E?: string },
): JSX.Element | null {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (message) box.current?.focus()
  }, [message])
  // Nothing is drawn without a message, so an empty box adds no gap to the layout around it.
  if (!message) return null
  return (
    <div ref={box} tabIndex={-1} data-e2e={dataE2E}>
      <ErrorState message={message} />
    </div>
  )
}
