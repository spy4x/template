import type { ComponentChildren, JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { Button, buttonClasses } from "@spy4x/preact-ui/button"
import { Checkbox } from "@spy4x/preact-ui/checkbox"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { Dropdown, DropdownItem } from "@spy4x/preact-ui/dropdown"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Select } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { IconEllipsisVertical, IconPlus } from "@spy4x/preact-icons"
import { timeAgo } from "@spy4x/platform/universal/time"
import type { PlanRefusal } from "@domain/billing"
import { canMutateNotes, type GroupRole } from "@domain/groups"
import { type Navigate, NOTE_PATHS, SCREEN_PATHS, ScreenForm } from "./progressive.tsx"

/** One note as the screen shows it. */
export interface NoteRow {
  id: string
  title: string
  body: string
  version: number
  /** When the note last changed, as an ISO timestamp; the row shows it as "3 hours ago". */
  updatedAt?: string
}

/** What the person has typed into a note form. */
export interface NoteDraft {
  title: string
  body: string
}

/** The errors of one note form: on the title field, and for the form as a whole. */
export interface NoteFormErrors {
  title: string | null
  form: string | null
  /** The group's plan refused the write: shown as an upgrade prompt in place of `form`. */
  plan?: PlanRefusal | null
}

/** The group whose notes are shown. */
export interface NotesGroup {
  id: string
  name: string
  /** The person is an editor or above; a viewer sees the notes without any form. */
  canWrite: boolean
}

/** A group the person may move notes to: one where they are an editor or above. */
export interface MoveTarget {
  id: string
  name: string
}

/**
 * The groups, other than `currentGroupId`, where a person with these memberships may write notes:
 * the places a note can move to.
 */
export function moveTargetsOf(
  groups: readonly { id: string; name: string; role: GroupRole }[],
  currentGroupId: string,
): MoveTarget[] {
  return groups
    .filter((group) => group.id !== currentGroupId && canMutateNotes(group.role))
    .map((group) => ({ id: group.id, name: group.name }))
}

/** The overflow trigger: 44 px on a phone, where it is a touch target, 36 px from `sm` up. */
export const MENU_TRIGGER_CLASSES = buttonClasses("icon", "none", "size-11 sm:size-9")

/**
 * The page header of the notes pages: the title on the left, truncated to one line, an optional
 * subtitle under it, and the page's actions on the right. `leading` sits before the title (a back
 * button). The actions never wrap under the title: on a phone they are icon buttons.
 */
export function NotesPageHeader(
  { title, subtitle, leading, actions, titleE2E, subtitleE2E }: {
    title: ComponentChildren
    subtitle?: ComponentChildren
    leading?: ComponentChildren
    actions?: ComponentChildren
    titleE2E?: string
    subtitleE2E?: string
  },
): JSX.Element {
  return (
    <header class="flex min-h-11 items-center gap-3">
      {leading}
      <div class="min-w-0 flex-1">
        <h1
          class="truncate text-xl font-semibold leading-tight text-foreground sm:text-2xl"
          data-e2e={titleE2E}
        >
          {title}
        </h1>
        {subtitle && <p class="truncate text-sm text-muted" data-e2e={subtitleE2E}>{subtitle}</p>}
      </div>
      {actions && <div class="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

/**
 * A menu item that opens a page of the app: followed through `navigate` when the app gives one,
 * as a plain link otherwise. `DropdownItem` takes no `navigate`, so its link would load the page.
 */
export function NavigateItem(
  { href, navigate, dataE2E, children }: {
    href: string
    navigate?: Navigate
    dataE2E?: string
    children: ComponentChildren
  },
): JSX.Element {
  return navigate
    ? <DropdownItem onClick={() => navigate(href)} dataE2E={dataE2E}>{children}</DropdownItem>
    : <DropdownItem href={href} dataE2E={dataE2E}>{children}</DropdownItem>
}

export interface NotesScreenProps {
  /** `null` while the group is not known yet (loading), or when the person is not a member. */
  group: NotesGroup | null
  notes: readonly NoteRow[]
  loading: boolean
  /** The error of the list itself, such as a failed read. */
  listError: string | null
  /** The next page of the list; `null` when this is the last. */
  nextPageHref: string | null
  /**
   * The other groups the person may move notes to. Empty (or left out) hides every move, so a
   * person with nowhere to move to sees a plain list.
   */
  moveTargets?: readonly MoveTarget[]
  /** Moves notes to another group: one from its row's menu, or the ticked ones. */
  onMove?: (input: { toGroupId: string; noteIds: string[] }) => void
  moving?: boolean
  /** The refusal of the last move. */
  moveError?: string | null
  /** Deletes a note from its row's menu, after the person confirms. Left out, rows offer no delete. */
  onDelete?: (note: { id: string; version: number }) => void
  navigate?: Navigate
}

/**
 * The notes of one group, as a list of rows. Writing happens on the note's own page
 * (`NoteEditorScreen`): "New note" and each note's title open it. Each row has a menu to move the
 * note to another group or delete it, the delete behind a confirmation. "Select notes" in the
 * header's menu ticks several notes at once and moves them together, all or none.
 */
export function NotesScreen(props: NotesScreenProps): JSX.Element {
  const { group, notes, loading, navigate } = props
  const moveTargets = group?.canWrite && props.onMove ? props.moveTargets ?? [] : []
  const onDelete = group?.canWrite ? props.onDelete : undefined
  const [selecting, setSelecting] = useState(false)
  const [ticked, setTicked] = useState<readonly string[]>([])
  const [deleting, setDeleting] = useState<NoteRow | null>(null)

  // A finished move with no refusal ends the selection: the ticked notes have left the list.
  const wasMoving = useRef(props.moving)
  useEffect(() => {
    if (wasMoving.current && !props.moving && !props.moveError) {
      setSelecting(false)
      setTicked([])
    }
    wasMoving.current = props.moving
  }, [props.moving, props.moveError])

  if (!group) {
    return (
      <ListPage>
        <NotesPageHeader title="Notes" />
        <EmptyState
          headingLevel={2}
          title={loading ? "Loading the group..." : "This group was not found."}
          action={!loading && (
            <Button href={SCREEN_PATHS.groups} navigate={navigate} variant="outline">
              Back to groups
            </Button>
          )}
        />
      </ListPage>
    )
  }

  const canSelect = moveTargets.length > 0 && notes.length > 0
  const shown = ticked.filter((id) => notes.some((note) => note.id === id))
  const stopSelecting = () => {
    setSelecting(false)
    setTicked([])
  }

  const list = (
    <ul
      class="divide-y divide-subtle overflow-hidden rounded-lg border border-subtle bg-surface"
      data-e2e="note-list"
    >
      {notes.map((note) => (
        <NoteItem
          key={note.id}
          note={note}
          navigate={navigate}
          selecting={selecting}
          ticked={shown.includes(note.id)}
          onTick={(on) =>
            setTicked((ids) => on ? [...ids, note.id] : ids.filter((id) => id !== note.id))}
          menu={!selecting && (moveTargets.length > 0 || onDelete) && (
            <NoteRowMenu
              note={note}
              moveTargets={moveTargets}
              onMove={props.onMove &&
                ((toGroupId) => props.onMove?.({ toGroupId, noteIds: [note.id] }))}
              onDelete={onDelete && (() => setDeleting(note))}
              disabled={props.moving}
            />
          )}
        />
      ))}
    </ul>
  )

  return (
    <ListPage>
      <NotesPageHeader
        title="Notes"
        subtitle={group.name}
        subtitleE2E="notes-group"
        actions={
          <>
            {group.canWrite && (
              <Button
                href={NOTE_PATHS.new}
                navigate={navigate}
                size="none"
                class="size-11 px-0 sm:h-9 sm:w-auto sm:px-3 sm:text-sm"
                data-e2e="note-new"
              >
                <IconPlus class="size-5 sm:size-4" />
                <span class="sr-only sm:not-sr-only">New note</span>
              </Button>
            )}
            <Dropdown
              trigger={<IconEllipsisVertical class="size-5" />}
              triggerLabel="More actions"
              triggerClasses={MENU_TRIGGER_CLASSES}
              triggerDataE2E="notes-menu"
            >
              {canSelect && !selecting && (
                <DropdownItem onClick={() => setSelecting(true)} dataE2E="notes-select">
                  Select notes to move
                </DropdownItem>
              )}
              <NavigateItem href={SCREEN_PATHS.groups} navigate={navigate} dataE2E="notes-groups">
                All groups
              </NavigateItem>
            </Dropdown>
          </>
        }
      />
      {!group.canWrite && (
        <p class="text-sm text-muted" data-e2e="notes-read-only">
          You can read these notes. Only an editor can change them.
        </p>
      )}
      <ErrorState message={props.listError} />
      {!selecting && <ErrorState message={props.moveError ?? null} />}
      {notes.length === 0
        ? (
          <EmptyState
            headingLevel={2}
            title={loading ? "Loading notes..." : "No notes yet."}
            description={loading || !group.canWrite
              ? undefined
              : `Notes you write here are shared with everyone in ${group.name}.`}
            action={!loading && group.canWrite && (
              <Button href={NOTE_PATHS.new} navigate={navigate} data-e2e="note-new-empty">
                New note
              </Button>
            )}
          />
        )
        : selecting
        ? (
          <ScreenForm
            action={NOTE_PATHS.moveMany(group.id)}
            pending={props.moving}
            onSubmit={(data) =>
              props.onMove?.({
                toGroupId: String(data.get("toGroupId") ?? ""),
                noteIds: data.getAll("noteIds").map(String),
              })}
          >
            <Stack>
              {list}
              <SelectionBar
                count={shown.length}
                moveTargets={moveTargets}
                moving={props.moving}
                moveError={props.moveError ?? null}
                onCancel={stopSelecting}
              />
            </Stack>
          </ScreenForm>
        )
        : list}
      {props.nextPageHref && (
        <div>
          <Button href={props.nextPageHref} navigate={navigate} variant="ghost">
            Older notes
          </Button>
        </div>
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this note?"
          message={`"${deleting.title}" will be deleted for everyone in ${group.name}.`}
          confirmLabel="Delete"
          cancelLabel="Keep it"
          tone="danger"
          dataE2E="note-delete-dialog"
          onConfirm={() => {
            setDeleting(null)
            onDelete?.({ id: deleting.id, version: deleting.version })
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </ListPage>
  )
}

/** The list page's column: the full content width, about 64 rem. */
function ListPage({ children }: { children?: ComponentChildren }): JSX.Element {
  return (
    <div class="mx-auto w-full max-w-5xl">
      <Stack gap="lg">{children}</Stack>
    </div>
  )
}

/**
 * The bar under the list while notes are being ticked: how many are ticked, and once any are, the
 * group to move them to and the button that does. Sticky, so it stays in reach on a long list.
 */
function SelectionBar(
  { count, moveTargets, moving, moveError, onCancel }: {
    count: number
    moveTargets: readonly MoveTarget[]
    moving?: boolean
    moveError: string | null
    onCancel: () => void
  },
): JSX.Element {
  return (
    <div
      class="sticky bottom-0 flex flex-col gap-3 rounded-lg border border-subtle bg-surface p-3 shadow-sm"
      data-e2e="notes-move"
    >
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p class="min-w-0 flex-1 text-sm font-medium" aria-live="polite">
          {count === 0 ? "Tick the notes to move" : `${count} selected`}
        </p>
        <Button
          type="button"
          variant="ghost"
          class="sm:order-last"
          onClick={onCancel}
          data-e2e="notes-select-cancel"
        >
          Cancel
        </Button>
        {count > 0 && (
          <div class="flex w-full items-center gap-3 sm:w-auto">
            <label class="sr-only" for="notes-move-to">Move to group</label>
            <Select
              id="notes-move-to"
              name="toGroupId"
              data-e2e="notes-move-to"
              class="min-w-0 flex-1 sm:w-auto sm:flex-none"
              options={moveTargets.map((target) => ({ value: target.id, label: target.name }))}
            />
            <Button
              type="submit"
              data-e2e="notes-move-submit"
              busy={moving}
              busyLabel="Moving..."
            >
              Move
            </Button>
          </div>
        )}
      </div>
      <ErrorState message={moveError} />
    </div>
  )
}

/** One note's row: its title, the first of its text, when it changed, and its menu. */
function NoteItem(
  { note, navigate, selecting, ticked, onTick, menu }: {
    note: NoteRow
    navigate?: Navigate
    selecting: boolean
    ticked: boolean
    onTick: (on: boolean) => void
    menu: ComponentChildren
  },
): JSX.Element {
  return (
    <li
      class="relative flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-hover"
      data-e2e={`note-${note.id}`}
    >
      {selecting && (
        <Checkbox
          name="noteIds"
          value={note.id}
          checked={ticked}
          onChange={(event) => onTick(event.currentTarget.checked)}
          aria-label={`Tick ${note.title}`}
          class="relative z-1"
          data-e2e="note-select"
        />
      )}
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-3">
          <h2 class="min-w-0 flex-1 truncate text-sm font-medium" data-e2e="note-item-title">
            <Link
              href={NOTE_PATHS.note(note.id)}
              navigate={navigate}
              class="text-foreground after:absolute after:inset-0 focus-visible:outline-hidden focus-visible:after:ring-2 focus-visible:after:ring-focus focus-visible:after:ring-inset"
            >
              {note.title}
            </Link>
          </h2>
          {note.updatedAt && (
            <time class="shrink-0 text-xs text-muted" dateTime={note.updatedAt}>
              {timeAgo(note.updatedAt)}
            </time>
          )}
        </div>
        {note.body && (
          <p class="truncate text-sm text-muted" data-e2e="note-item-body">{note.body}</p>
        )}
      </div>
      {menu && <div class="relative -my-2 -mr-2 shrink-0">{menu}</div>}
    </li>
  )
}

/** A row's menu: move the note to each group it can go to, and delete it. */
function NoteRowMenu(
  { note, moveTargets, onMove, onDelete, disabled }: {
    note: NoteRow
    moveTargets: readonly MoveTarget[]
    onMove?: (toGroupId: string) => void
    onDelete?: () => void
    disabled?: boolean
  },
): JSX.Element {
  return (
    <Dropdown
      trigger={<IconEllipsisVertical class="size-5" />}
      triggerLabel={`Actions for ${note.title}`}
      triggerClasses={MENU_TRIGGER_CLASSES}
      triggerDataE2E="note-menu"
    >
      {onMove && moveTargets.map((target) => (
        <DropdownItem
          key={target.id}
          onClick={() => onMove(target.id)}
          disabled={disabled}
          dataE2E="note-move"
        >
          Move to {target.name}
        </DropdownItem>
      ))}
      {onDelete && (
        <DropdownItem onClick={onDelete} danger dataE2E="note-delete">Delete</DropdownItem>
      )}
    </Dropdown>
  )
}
