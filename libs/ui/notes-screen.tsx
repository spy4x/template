import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { Card, CardBody, CardHeader } from "@spy4x/preact-ui/card"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input, Textarea } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { NOTE_BODY_MAX_LENGTH, NOTE_TITLE_MAX_LENGTH } from "@domain/notes"
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
}

/** The group whose notes are shown. */
export interface NotesGroup {
  id: string
  name: string
  /** The person is an editor or above; a viewer sees the notes without any form. */
  canWrite: boolean
}

/** The note being edited: its id and the version the edit started from. */
export interface NoteEdit extends NoteDraft {
  id: string
  version: number
  /** The note moved on since the edit started; set after a refused save. */
  conflict: boolean
}

export interface NotesScreenProps {
  /** `null` while the group is not known yet (loading), or when the person is not a member. */
  group: NotesGroup | null
  notes: readonly NoteRow[]
  loading: boolean
  /**
   * The id the next note is created with. It is part of the create form, so a form sent twice
   * (a double click, a retried post) creates one note.
   */
  draftId: string
  draft: NoteDraft
  onDraftChange?: (draft: NoteDraft) => void
  createErrors: NoteFormErrors
  creating: boolean
  onCreate?: () => void
  /** The note whose edit form is open, or `null` for the create form. */
  editing: NoteEdit | null
  onEditChange?: (draft: NoteDraft) => void
  editErrors: NoteFormErrors
  saving: boolean
  onSave?: () => void
  /** Rereads the note after a conflict; without it, the "load the latest" link reloads the page. */
  onReloadLatest?: () => void
  /** The id of the note being deleted, or `null`. */
  deleting: string | null
  onDelete?: (note: NoteRow) => void
  /** The error of the list itself, such as a failed read or delete. */
  listError: string | null
  /** The next page of the list, for a page without JavaScript; `null` when this is the last. */
  nextPageHref: string | null
  navigate?: Navigate
}

/**
 * The notes of one group: a form to create or edit a note, and the list. Every action is a real
 * form or link: the create and edit forms post the API's field names to the note routes, the
 * delete button posts the version the person saw, and "Edit" is a link to the note's page. With
 * its callback, the app takes the action over; without it, the browser posts.
 */
export function NotesScreen(props: NotesScreenProps): JSX.Element {
  const { group, notes, loading, editing, navigate } = props
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
    <Stack gap="lg">
      <Card>
        <CardHeader>
          <h1 class="text-lg font-semibold">Notes in {group.name}</h1>
          <Link href={SCREEN_PATHS.groups} navigate={navigate} class="pc-link text-sm">
            All groups
          </Link>
        </CardHeader>
        <CardBody>
          {!group.canWrite
            ? (
              <p class="text-sm text-muted" data-e2e="notes-read-only">
                You can read these notes. Only an editor can change them.
              </p>
            )
            : editing
            ? <EditForm {...props} group={group} editing={editing} />
            : <CreateForm {...props} group={group} />}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="All notes" headingLevel={2} />
        <CardBody>
          <Stack>
            <ErrorState message={props.listError} />
            {notes.length === 0
              ? <EmptyState title={loading ? "Loading notes..." : "No notes yet."} />
              : (
                <ul class="flex flex-col gap-3" data-e2e="note-list">
                  {notes.map((note) => (
                    <NoteItem key={note.id} {...props} group={group} note={note} />
                  ))}
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
    </Stack>
  )
}

type WithGroup = NotesScreenProps & { group: NotesGroup }

function CreateForm(
  { group, draftId, draft, onDraftChange, createErrors, creating, onCreate }: WithGroup,
): JSX.Element {
  return (
    <ScreenForm action={NOTE_PATHS.create(group.id)} pending={creating} onSubmit={onCreate}>
      <input type="hidden" name="id" value={draftId} />
      <NoteFields
        idPrefix="note-new"
        heading="New note"
        draft={draft}
        onChange={onDraftChange}
        errors={createErrors}
      />
      <div class="mt-4">
        <Button type="submit" data-e2e="note-create" busy={creating} busyLabel="Adding...">
          Add note
        </Button>
      </div>
    </ScreenForm>
  )
}

function EditForm(
  {
    editing,
    onEditChange,
    editErrors,
    saving,
    onSave,
    onReloadLatest,
    navigate,
  }: WithGroup & { editing: NoteEdit },
): JSX.Element {
  const notePath = NOTE_PATHS.note(editing.id)
  return (
    <ScreenForm action={notePath} pending={saving} onSubmit={onSave}>
      <input type="hidden" name="version" value={String(editing.version)} />
      <NoteFields
        idPrefix="note-edit"
        heading="Edit note"
        draft={editing}
        onChange={onEditChange}
        errors={editErrors}
      />
      {editing.conflict && (
        <p class="mt-2 text-sm" data-e2e="note-conflict">
          <Link
            href={notePath}
            navigate={onReloadLatest ? () => onReloadLatest() : navigate}
            class="pc-link"
          >
            Load the latest version
          </Link>{" "}
          to see what changed. Your text here is kept until you do.
        </p>
      )}
      <div class="mt-4 flex flex-wrap gap-3">
        <Button type="submit" data-e2e="note-save" busy={saving} busyLabel="Saving...">
          Save note
        </Button>
        <Button
          href={NOTE_PATHS.list}
          navigate={navigate}
          variant="outline"
          size="md"
        >
          Cancel
        </Button>
      </div>
    </ScreenForm>
  )
}

/**
 * The title and body of a note form, with the form's error under them. When the title gets an
 * error, focus moves to it, so a keyboard or screen reader user lands on what to fix.
 */
function NoteFields(
  { idPrefix, heading, draft, onChange, errors }: {
    idPrefix: string
    heading: string
    draft: NoteDraft
    onChange?: (draft: NoteDraft) => void
    errors: NoteFormErrors
  },
): JSX.Element {
  const title = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (errors.title) title.current?.focus()
  }, [errors.title])
  return (
    <fieldset>
      <legend class="mb-2 text-sm font-medium">{heading}</legend>
      <Stack>
        <Field id={`${idPrefix}-title`} label="Title" error={errors.title} required>
          <Input
            ref={title}
            data-e2e={`${idPrefix}-title`}
            name="title"
            autocomplete="off"
            maxLength={NOTE_TITLE_MAX_LENGTH}
            value={draft.title}
            onInput={(e) => onChange?.({ ...draft, title: e.currentTarget.value })}
            required
          />
        </Field>
        <Field id={`${idPrefix}-body`} label="Text">
          <Textarea
            data-e2e={`${idPrefix}-body`}
            name="body"
            rows={4}
            maxLength={NOTE_BODY_MAX_LENGTH}
            value={draft.body}
            onInput={(e) => onChange?.({ ...draft, body: e.currentTarget.value })}
          />
        </Field>
        <ErrorState message={errors.form} />
      </Stack>
    </fieldset>
  )
}

function NoteItem(
  { group, note, deleting, onDelete, navigate }: WithGroup & { note: NoteRow },
): JSX.Element {
  return (
    <li
      class="flex flex-col gap-2 rounded-primary border border-subtle px-3 py-3"
      data-e2e={`note-${note.id}`}
    >
      <h3 class="text-sm font-semibold" data-e2e="note-item-title">{note.title}</h3>
      {note.body && <p class="whitespace-pre-wrap text-sm" data-e2e="note-item-body">{note.body}
      </p>}
      {group.canWrite && (
        <div class="flex flex-wrap items-center gap-3">
          <Link
            href={NOTE_PATHS.note(note.id)}
            navigate={navigate}
            class="pc-link text-sm"
          >
            Edit<span class="sr-only">{` ${note.title}`}</span>
          </Link>
          <ScreenForm
            action={NOTE_PATHS.delete(note.id)}
            pending={deleting === note.id}
            onSubmit={onDelete && (() => onDelete(note))}
          >
            <input type="hidden" name="version" value={String(note.version)} />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              data-e2e="note-delete"
              busy={deleting === note.id}
              busyLabel="Deleting..."
              aria-label={`Delete ${note.title}`}
            >
              Delete
            </Button>
          </ScreenForm>
        </div>
      )}
    </li>
  )
}
