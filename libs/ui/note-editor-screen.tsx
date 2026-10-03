import type { ComponentChildren, JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { Dropdown, DropdownItem } from "@spy4x/preact-ui/dropdown"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input, Textarea } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { IconArrowLeft, IconEllipsisVertical } from "@spy4x/preact-icons"
import { NOTE_BODY_MAX_LENGTH, NOTE_TITLE_MAX_LENGTH } from "@domain/notes"
import {
  MENU_TRIGGER_CLASSES,
  type MoveTarget,
  type NoteDraft,
  type NoteFormErrors,
  type NotesGroup,
  NotesPageHeader,
} from "./notes-screen.tsx"
import { PlanRefusalNotice } from "./plan-refusal.tsx"
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
  /** Saves or creates. */
  onSave?: () => void
  /** Rereads the note after a conflict; without it, the "load the latest" link reloads the page. */
  onReloadLatest?: () => void
  deleting: boolean
  /**
   * Deletes the note. Given, the page's menu holds "Delete", which asks first and runs this when
   * the person confirms. Left out, the menu offers no delete.
   */
  onDelete?: () => void
  /**
   * The other groups the person may move this note to (editor or above there). Empty, or left
   * out, the menu offers no move.
   */
  moveTargets?: readonly MoveTarget[]
  /** Moves the note to the chosen group. */
  onMove?: (toGroupId: string) => void
  moving?: boolean
  /** The refusal of the last move, shown under the form. */
  moveError?: string | null
  navigate?: Navigate
}

/**
 * One note on a page of its own: the form to create it or edit it, and for a viewer the note as
 * text. The header has a back button and, on an existing note, a menu to move it to another group
 * or delete it (after a confirmation). Save and Cancel sit under the text, and stay in reach at the
 * bottom of a phone's screen.
 */
export function NoteEditorScreen(props: NoteEditorScreenProps): JSX.Element {
  const { group, notFound, navigate } = props
  if (!group) {
    return (
      <EditorPage>
        <NotesPageHeader leading={<BackButton navigate={navigate} />} title="Note" />
        <EmptyState
          headingLevel={2}
          title={props.loading ? "Loading the group..." : "This group was not found."}
          action={!props.loading && (
            <Button href={SCREEN_PATHS.groups} navigate={navigate} variant="outline">
              Back to groups
            </Button>
          )}
        />
      </EditorPage>
    )
  }
  if (notFound) {
    return (
      <EditorPage>
        <NotesPageHeader leading={<BackButton navigate={navigate} />} title="Note not found" />
        {props.errors.form
          ? <ErrorState message={props.errors.form} />
          : (
            <p class="text-sm text-muted" data-e2e="note-not-found">
              There is no such note in{" "}
              {group.name}. It may have been deleted, or it may be in another of your groups: switch
              to that group, then open it from its notes.
            </p>
          )}
      </EditorPage>
    )
  }
  if (props.loading) {
    return (
      <EditorPage>
        <NotesPageHeader leading={<BackButton navigate={navigate} />} title="Note" />
        <EmptyState headingLevel={2} title="Loading the note..." />
      </EditorPage>
    )
  }
  return group.canWrite ? <Editor {...props} group={group} /> : <ReadOnlyNote {...props} />
}

/** The editor's column: about 40 rem, a readable width for a form and its text. */
function EditorPage({ children }: { children?: ComponentChildren }): JSX.Element {
  return (
    <div class="mx-auto w-full max-w-2xl">
      <Stack gap="lg">{children}</Stack>
    </div>
  )
}

function BackButton({ navigate }: { navigate?: Navigate }): JSX.Element {
  return (
    <Button
      href={NOTE_PATHS.list}
      navigate={navigate}
      variant="icon"
      size="none"
      class="-ml-2 size-11 shrink-0 sm:size-9"
      aria-label="Back to notes"
      data-e2e="note-back"
    >
      <IconArrowLeft class="size-5" />
    </Button>
  )
}

/** A viewer's page: the note as text, with nothing to change. */
function ReadOnlyNote({ note, value, group, navigate }: NoteEditorScreenProps): JSX.Element {
  return (
    <EditorPage>
      <NotesPageHeader
        leading={<BackButton navigate={navigate} />}
        title={note ? value.title : "New note"}
        subtitle={group?.name}
        subtitleE2E="notes-group"
        titleE2E="note-read-title"
      />
      <p class="text-sm text-muted" data-e2e="note-read-only">
        {note
          ? "You can read this note. Only an editor can change it."
          : "Only an editor can add notes to this group."}
      </p>
      {note && value.body && (
        <p class="whitespace-pre-wrap break-words text-base" data-e2e="note-read-body">
          {value.body}
        </p>
      )}
    </EditorPage>
  )
}

type WithGroup = NoteEditorScreenProps & { group: NotesGroup }

function Editor(props: WithGroup): JSX.Element {
  const { group, note, value, onChange, errors, saving, onSave, navigate } = props
  const moveTargets = props.onMove ? props.moveTargets ?? [] : []
  const [asking, setAsking] = useState(false)
  const hasMenu = note !== null && (moveTargets.length > 0 || props.onDelete !== undefined)
  return (
    <EditorPage>
      <NotesPageHeader
        leading={<BackButton navigate={navigate} />}
        title={note ? "Edit note" : "New note"}
        subtitle={group.name}
        subtitleE2E="notes-group"
        actions={hasMenu && (
          <Dropdown
            trigger={<IconEllipsisVertical class="size-5" />}
            triggerLabel="More actions"
            triggerClasses={MENU_TRIGGER_CLASSES}
            triggerDataE2E="note-menu"
          >
            {moveTargets.map((target) => (
              <DropdownItem
                key={target.id}
                onClick={() => props.onMove?.(target.id)}
                disabled={props.moving}
                dataE2E="note-move"
              >
                Move to {target.name}
              </DropdownItem>
            ))}
            {props.onDelete && (
              <DropdownItem
                onClick={() => setAsking(true)}
                disabled={props.deleting}
                danger
                dataE2E="note-delete"
              >
                Delete
              </DropdownItem>
            )}
          </Dropdown>
        )}
      />
      <ScreenForm
        action={note ? NOTE_PATHS.note(note.id) : NOTE_PATHS.create(group.id)}
        pending={saving}
        onSubmit={onSave}
      >
        {note
          ? <input type="hidden" name="version" value={String(note.version)} />
          : <input type="hidden" name="id" value={props.draftId} />}
        <Stack>
          <NoteFields
            groupId={group.id}
            value={value}
            onChange={onChange}
            errors={errors}
            navigate={navigate}
          />
          {note?.conflict && (
            <p class="text-sm" data-e2e="note-conflict">
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
          <ErrorState message={props.moveError ?? null} />
          <div class="sticky bottom-0 flex gap-3 border-t border-subtle bg-canvas py-3 sm:static sm:justify-end sm:border-0 sm:bg-transparent sm:py-0">
            <Button
              href={NOTE_PATHS.list}
              navigate={navigate}
              variant="outline"
              class="flex-1 sm:flex-none"
              data-e2e="note-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              class="flex-1 sm:flex-none"
              data-e2e="note-save"
              busy={saving}
              busyLabel="Saving..."
            >
              {note ? "Save note" : "Add note"}
            </Button>
          </div>
        </Stack>
      </ScreenForm>
      {asking && note && (
        <ConfirmDialog
          title="Delete this note?"
          message={`"${value.title}" will be deleted for everyone in ${group.name}.`}
          confirmLabel="Delete"
          cancelLabel="Keep it"
          tone="danger"
          dataE2E="note-delete-dialog"
          onConfirm={() => {
            setAsking(false)
            props.onDelete?.()
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </EditorPage>
  )
}

/**
 * The title and text of a note form, with the form's error under them. The title is the page's
 * large first line; the text grows with what is typed. When the title gets an error, focus moves
 * to it, so a keyboard or screen reader user lands on what to fix.
 */
function NoteFields(
  { groupId, value, onChange, errors, navigate }: {
    groupId: string
    value: NoteDraft
    onChange?: (value: NoteDraft) => void
    errors: NoteFormErrors
    navigate?: Navigate
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
          placeholder="What is this note about?"
          class="text-lg font-semibold"
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
          rows={8}
          class="min-h-48 field-sizing-content"
          maxLength={NOTE_BODY_MAX_LENGTH}
          value={value.body}
          onInput={(e) => onChange?.({ ...value, body: e.currentTarget.value })}
        />
      </Field>
      {errors.plan
        ? <PlanRefusalNotice groupId={groupId} refusal={errors.plan} navigate={navigate} />
        : <ErrorState message={errors.form} />}
    </Stack>
  )
}
