import type { JSX } from "preact"
import { Button } from "@spy4x/preact-ui/button"
import { Card, CardBody, CardHeader } from "@spy4x/preact-ui/card"
import { Checkbox } from "@spy4x/preact-ui/checkbox"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Select } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import type { PlanRefusal } from "@domain/billing"
import { canMutateNotes, type GroupRole } from "@domain/groups"
import { type Navigate, NOTE_PATHS, SCREEN_PATHS, ScreenForm } from "./progressive.tsx"

/** One note as the screen shows it. */
export interface NoteRow {
  id: string
  title: string
  body: string
  version: number
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

export interface NotesScreenProps {
  /** `null` while the group is not known yet (loading), or when the person is not a member. */
  group: NotesGroup | null
  notes: readonly NoteRow[]
  loading: boolean
  /** The error of the list itself, such as a failed read. */
  listError: string | null
  /** The next page of the list, for a page without JavaScript; `null` when this is the last. */
  nextPageHref: string | null
  /**
   * The other groups the person may move notes to. Empty (or left out) hides the selection and the
   * move form, so a person with nowhere to move to sees a plain list.
   */
  moveTargets?: readonly MoveTarget[]
  /** The ticked notes and the group to move them to. Without it, the browser posts the form. */
  onMove?: (input: { toGroupId: string; noteIds: string[] }) => void
  moving?: boolean
  /** The refusal of the last move, shown by the move button. */
  moveError?: string | null
  navigate?: Navigate
}

/**
 * The notes of one group, as a list. Writing happens on the note's own page
 * (`NoteEditorScreen`): "New note" and each note's title are links, so the screen has no form.
 * Links open the pages; with `navigate`, the app follows them without a page load. An editor with
 * another group to write to also gets a tick box on every note and one form to move the ticked
 * notes there, all or none: a real form posting `toGroupId` and one `noteIds` per ticked note.
 */
export function NotesScreen(props: NotesScreenProps): JSX.Element {
  const { group, notes, loading, navigate } = props
  const moveTargets = props.moveTargets ?? []
  if (!group) {
    return (
      <Card>
        <CardHeader>
          <h1 class="text-lg font-semibold">Notes</h1>
        </CardHeader>
        <CardBody>
          <Stack>
            <EmptyState title={loading ? "Loading the group..." : "This group was not found."} />
            <Link href={SCREEN_PATHS.groups} navigate={navigate} class="pc-link">
              Back to groups
            </Link>
          </Stack>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <h1 class="text-lg font-semibold">Notes in {group.name}</h1>
        <div class="flex flex-wrap items-center gap-3">
          <Link href={SCREEN_PATHS.groups} navigate={navigate} class="pc-link text-sm">
            All groups
          </Link>
          {group.canWrite && (
            <Button href={NOTE_PATHS.new} navigate={navigate} size="sm" data-e2e="note-new">
              New note
            </Button>
          )}
        </div>
      </CardHeader>
      <CardBody>
        <Stack>
          {!group.canWrite && (
            <p class="text-sm text-muted" data-e2e="notes-read-only">
              You can read these notes. Only an editor can change them.
            </p>
          )}
          <ErrorState message={props.listError} />
          {notes.length === 0
            ? <EmptyState title={loading ? "Loading notes..." : "No notes yet."} />
            : moveTargets.length > 0 && group.canWrite
            ? (
              <ScreenForm
                action={NOTE_PATHS.moveMany(group.id)}
                pending={props.moving}
                onSubmit={props.onMove && ((data) =>
                  props.onMove?.({
                    toGroupId: String(data.get("toGroupId") ?? ""),
                    noteIds: data.getAll("noteIds").map(String),
                  }))}
              >
                <Stack>
                  <NoteList notes={notes} navigate={navigate} selectable />
                  <div class="flex flex-wrap items-end gap-3" data-e2e="notes-move">
                    <Field id="notes-move-to" label="Move ticked notes to">
                      <Select
                        name="toGroupId"
                        data-e2e="notes-move-to"
                        options={moveTargets.map((target) => ({
                          value: target.id,
                          label: target.name,
                        }))}
                      />
                    </Field>
                    <Button
                      type="submit"
                      variant="outline"
                      data-e2e="notes-move-submit"
                      busy={props.moving}
                      busyLabel="Moving..."
                    >
                      Move ticked notes
                    </Button>
                  </div>
                  <ErrorState message={props.moveError ?? null} />
                </Stack>
              </ScreenForm>
            )
            : <NoteList notes={notes} navigate={navigate} />}
          {props.nextPageHref && (
            <Link href={props.nextPageHref} navigate={navigate} class="pc-link text-sm">
              Older notes
            </Link>
          )}
        </Stack>
      </CardBody>
    </Card>
  )
}

function NoteList(
  { notes, navigate, selectable = false }: {
    notes: readonly NoteRow[]
    navigate?: Navigate
    selectable?: boolean
  },
): JSX.Element {
  return (
    <ul class="flex flex-col gap-3" data-e2e="note-list">
      {notes.map((note) => (
        <NoteItem key={note.id} note={note} navigate={navigate} selectable={selectable} />
      ))}
    </ul>
  )
}

function NoteItem(
  { note, navigate, selectable }: { note: NoteRow; navigate?: Navigate; selectable: boolean },
): JSX.Element {
  return (
    <li
      class="flex flex-col gap-1 rounded-primary border border-subtle px-3 py-3"
      data-e2e={`note-${note.id}`}
    >
      <h2 class="flex items-center gap-3 text-sm font-semibold" data-e2e="note-item-title">
        {selectable && (
          <Checkbox
            name="noteIds"
            value={note.id}
            aria-label={`Tick ${note.title}`}
            data-e2e="note-select"
          />
        )}
        <Link href={NOTE_PATHS.note(note.id)} navigate={navigate} class="pc-link">
          {note.title}
        </Link>
      </h2>
      {note.body && (
        <p class="line-clamp-3 whitespace-pre-wrap text-sm" data-e2e="note-item-body">
          {note.body}
        </p>
      )}
    </li>
  )
}
