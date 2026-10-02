import type { JSX } from "preact"
import { Button } from "@spy4x/preact-ui/button"
import { Card, CardBody, CardHeader } from "@spy4x/preact-ui/card"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import type { PlanRefusal } from "@domain/billing"
import { type Navigate, NOTE_PATHS, SCREEN_PATHS } from "./progressive.tsx"

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

export interface NotesScreenProps {
  /** `null` while the group is not known yet (loading), or when the person is not a member. */
  group: NotesGroup | null
  notes: readonly NoteRow[]
  loading: boolean
  /** The error of the list itself, such as a failed read. */
  listError: string | null
  /** The next page of the list, for a page without JavaScript; `null` when this is the last. */
  nextPageHref: string | null
  navigate?: Navigate
}

/**
 * The notes of one group, as a list. Writing happens on the note's own page
 * (`NoteEditorScreen`): "New note" and each note's title are links, so the screen has no form.
 * Every action is a link, so it works without JavaScript; with `navigate`, the app follows them
 * without a page load.
 */
export function NotesScreen(props: NotesScreenProps): JSX.Element {
  const { group, notes, loading, navigate } = props
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
            : (
              <ul class="flex flex-col gap-3" data-e2e="note-list">
                {notes.map((note) => <NoteItem key={note.id} note={note} navigate={navigate} />)}
              </ul>
            )}
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

function NoteItem(
  { note, navigate }: { note: NoteRow; navigate?: Navigate },
): JSX.Element {
  return (
    <li
      class="flex flex-col gap-1 rounded-primary border border-subtle px-3 py-3"
      data-e2e={`note-${note.id}`}
    >
      <h2 class="text-sm font-semibold" data-e2e="note-item-title">
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
