import type { ComponentChildren, JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { Card, CardBody, CardHeader } from "@spy4x/preact-ui/card"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input, Textarea } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { NOTE_BODY_MAX_LENGTH, NOTE_TITLE_MAX_LENGTH } from "@domain/notes"
import type { NoteDraft, NoteFormErrors, NotesGroup } from "./notes-screen.tsx"
import { type Navigate, NOTE_PATHS, SCREEN_PATHS, ScreenForm } from "./progressive.tsx"

/** The note a page edits: its id, the version the edit started from, and whether it moved on. */
export interface NoteTarget {
  id: string
  version: number
  /** The note moved on since the edit started; set after a refused save. */
  conflict: boolean
}

export interface NoteEditorScreenProps {
  /** `null` while the group is not known yet (loading), or when the person is not a member. */
  group: NotesGroup | null
  /** The group or the note is still being read; the create page never waits. */
  loading: boolean
  /** The note is not in this group: it is gone, it never existed, or it is in another group. */
  notFound: boolean
  /** The note being edited, or `null` on the create page. */
  note: NoteTarget | null
  /** What the title and text show: what the person typed, or the note as saved. */
  value: NoteDraft
  onChange?: (value: NoteDraft) => void
  /**
   * The id a new note is created with. It is part of the create form, so a form sent twice (a
   * double click, a retried post) creates one note.
   */
  draftId: string
  errors: NoteFormErrors
  saving: boolean
  /** Saves or creates. Without it, the browser posts the form. */
  onSave?: () => void
  /** Rereads the note after a conflict; without it, the "load the latest" link reloads the page. */
  onReloadLatest?: () => void
  deleting: boolean
  /**
   * Deletes the note. Given, "Delete" opens a confirmation dialog and this runs when the person
   * confirms. Without it, "Delete" is a link to a page that asks the same question in a form.
   */
  onDelete?: () => void
  /** Show the "delete this note?" page instead of the editor (the page without JavaScript). */
  confirmingDelete?: boolean
  navigate?: Navigate
}

/**
 * One note on a page of its own: the form to create it or edit it, with save and delete, and for a
 * viewer the note as text. Every action is a real form or link: the form posts the API's field
 * names to the note routes, and deleting is a dialog, or a page with a form when no script runs.
 * With its callbacks, the app takes the actions over; without them, the browser posts.
 */
export function NoteEditorScreen(props: NoteEditorScreenProps): JSX.Element {
  const { group, notFound, navigate } = props
  if (!group) {
    return (
      <Card>
        <CardHeader>
          <h1 class="text-lg font-semibold">Note</h1>
        </CardHeader>
        <CardBody>
          <Stack>
            <EmptyState
              title={props.loading ? "Loading the group..." : "This group was not found."}
            />
            <Link href={SCREEN_PATHS.groups} navigate={navigate} class="pc-link">
              Back to groups
            </Link>
          </Stack>
        </CardBody>
      </Card>
    )
  }
  if (notFound) {
    return (
      <Page>
        <BackLink navigate={navigate} />
        <Card>
          <CardHeader>
            <h1 class="text-lg font-semibold">Note not found</h1>
          </CardHeader>
          <CardBody>
            {props.errors.form
              ? <ErrorState message={props.errors.form} />
              : (
                <p class="text-sm" data-e2e="note-not-found">
                  There is no such note in{" "}
                  {group.name}. It may have been deleted, or it may be in another of your groups:
                  switch to that group, then open it from its notes.
                </p>
              )}
          </CardBody>
        </Card>
      </Page>
    )
  }
  if (props.loading) {
    return (
      <Page>
        <BackLink navigate={navigate} />
        <EmptyState title="Loading the note..." />
      </Page>
    )
  }
  return (
    <Page>
      <BackLink navigate={navigate} />
      {!group.canWrite
        ? <ReadOnlyNote {...props} />
        : props.confirmingDelete && props.note
        ? <ConfirmDeletePage {...props} group={group} note={props.note} />
        : <EditorCard {...props} group={group} />}
    </Page>
  )
}

function Page({ children }: { children?: ComponentChildren }): JSX.Element {
  return (
    <div class="mx-auto w-full max-w-3xl">
      <Stack gap="lg">{children}</Stack>
    </div>
  )
}

function BackLink({ navigate }: { navigate?: Navigate }): JSX.Element {
  return (
    <Link
      href={NOTE_PATHS.list}
      navigate={navigate}
      class="pc-link text-sm"
      data-e2e="note-back"
    >
      Back to notes
    </Link>
  )
}

/** A viewer's page: the note as text, with nothing to change. */
function ReadOnlyNote({ note, value }: NoteEditorScreenProps): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <h1 class="text-lg font-semibold" data-e2e="note-read-title">
          {note ? value.title : "New note"}
        </h1>
      </CardHeader>
      <CardBody>
        <Stack>
          <p class="text-sm text-muted" data-e2e="note-read-only">
            {note
              ? "You can read this note. Only an editor can change it."
              : "Only an editor can add notes to this group."}
          </p>
          {note && value.body && (
            <p class="whitespace-pre-wrap text-sm" data-e2e="note-read-body">{value.body}</p>
          )}
        </Stack>
      </CardBody>
    </Card>
  )
}

type WithGroup = NoteEditorScreenProps & { group: NotesGroup }

function EditorCard(props: WithGroup): JSX.Element {
  const { group, note, value, onChange, errors, saving, onSave, navigate } = props
  return (
    <Card>
      <CardHeader>
        <h1 class="text-lg font-semibold">{note ? "Edit note" : "New note"}</h1>
        <span class="text-sm text-muted">in {group.name}</span>
      </CardHeader>
      <CardBody>
        <ScreenForm
          action={note ? NOTE_PATHS.note(note.id) : NOTE_PATHS.create(group.id)}
          pending={saving}
          onSubmit={onSave}
        >
          {note
            ? <input type="hidden" name="version" value={String(note.version)} />
            : <input type="hidden" name="id" value={props.draftId} />}
          <NoteFields value={value} onChange={onChange} errors={errors} />
          {note?.conflict && (
            <p class="mt-2 text-sm" data-e2e="note-conflict">
              <Link
                href={NOTE_PATHS.note(note.id)}
                navigate={props.onReloadLatest ? () => props.onReloadLatest?.() : navigate}
                class="pc-link"
                // Acts on this page, so a guard that asks before leaving must let it through.
                data-unsaved-ok="true"
              >
                Load the latest version
              </Link>{" "}
              to see what changed. Your text here is kept until you do.
            </p>
          )}
          <div class="mt-4 flex flex-wrap items-center gap-3">
            <Button type="submit" data-e2e="note-save" busy={saving} busyLabel="Saving...">
              {note ? "Save note" : "Add note"}
            </Button>
            <Button href={NOTE_PATHS.list} navigate={navigate} variant="outline" size="md">
              Cancel
            </Button>
            {note && <DeleteControl {...props} note={note} />}
          </div>
        </ScreenForm>
      </CardBody>
    </Card>
  )
}

/**
 * "Delete": a button that opens the confirmation dialog when the app takes deleting over, and a
 * link to the confirmation page when it does not.
 */
function DeleteControl(
  { group, note, value, deleting, onDelete, navigate }: WithGroup & { note: NoteTarget },
): JSX.Element {
  const [asking, setAsking] = useState(false)
  if (!onDelete) {
    return (
      <Button
        href={NOTE_PATHS.delete(note.id)}
        navigate={navigate}
        variant="outline"
        size="md"
        class="sm:ml-auto"
        data-e2e="note-delete"
      >
        Delete
      </Button>
    )
  }
  return (
    <>
      <Button
        type="button"
        variant="outline"
        class="sm:ml-auto"
        data-e2e="note-delete"
        busy={deleting}
        busyLabel="Deleting..."
        onClick={() => setAsking(true)}
      >
        Delete
      </Button>
      {asking && (
        <ConfirmDialog
          title="Delete this note?"
          message={`"${value.title}" will be deleted for everyone in ${group.name}.`}
          confirmLabel="Delete"
          cancelLabel="Keep it"
          tone="danger"
          dataE2E="note-delete-dialog"
          onConfirm={() => {
            setAsking(false)
            onDelete()
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </>
  )
}

/** The page without JavaScript asks "delete this note?" here, in a form that posts the version. */
function ConfirmDeletePage(
  { group, note, value, errors, deleting, onDelete, navigate }: WithGroup & { note: NoteTarget },
): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <h1 class="text-lg font-semibold">Delete this note?</h1>
      </CardHeader>
      <CardBody>
        <ScreenForm action={NOTE_PATHS.delete(note.id)} pending={deleting} onSubmit={onDelete}>
          <input type="hidden" name="version" value={String(note.version)} />
          <Stack>
            <p class="text-sm">
              "{value.title}" will be deleted for everyone in {group.name}.
            </p>
            <ErrorState message={errors.form} />
          </Stack>
          <div class="mt-4 flex flex-wrap gap-3">
            <Button
              type="submit"
              variant="danger"
              data-e2e="note-delete-confirm"
              busy={deleting}
              busyLabel="Deleting..."
            >
              Delete note
            </Button>
            <Button
              href={NOTE_PATHS.note(note.id)}
              navigate={navigate}
              variant="outline"
              size="md"
            >
              Keep it
            </Button>
          </div>
        </ScreenForm>
      </CardBody>
    </Card>
  )
}

/**
 * The title and text of a note form, with the form's error under them. When the title gets an
 * error, focus moves to it, so a keyboard or screen reader user lands on what to fix.
 */
function NoteFields(
  { value, onChange, errors }: {
    value: NoteDraft
    onChange?: (value: NoteDraft) => void
    errors: NoteFormErrors
  },
): JSX.Element {
  const title = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (errors.title) title.current?.focus()
  }, [errors.title])
  return (
    <Stack>
      <Field id="note-title" label="Title" error={errors.title} required>
        <Input
          ref={title}
          data-e2e="note-title"
          name="title"
          autocomplete="off"
          maxLength={NOTE_TITLE_MAX_LENGTH}
          value={value.title}
          onInput={(e) => onChange?.({ ...value, title: e.currentTarget.value })}
          required
        />
      </Field>
      <Field id="note-body" label="Text">
        <Textarea
          data-e2e="note-body"
          name="body"
          rows={14}
          maxLength={NOTE_BODY_MAX_LENGTH}
          value={value.body}
          onInput={(e) => onChange?.({ ...value, body: e.currentTarget.value })}
        />
      </Field>
      <ErrorState message={errors.form} />
    </Stack>
  )
}
