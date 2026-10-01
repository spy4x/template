import { useEffect } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { canMutateNotes } from "@domain/groups"
import { NoteEditorScreen } from "@ui/note-editor-screen.tsx"
import { NOTE_PATHS } from "@ui/progressive.tsx"
import { groupsStore } from "../state/groups.ts"
import { notesStore } from "../state/notes.ts"
import { selectionStore } from "../state/selection.ts"
import { OfflineStatus } from "../offline/OfflineStatus.tsx"
import { UnsavedGuard } from "./UnsavedGuard.tsx"

/**
 * Wires the note page to the notes store: `/notes/new` (no `noteId`) creates a note in the
 * person's selected group, `/notes/:noteId` edits one of that group's notes. A note that is not in
 * the selected group is "not found": a link never changes the selection, so a note of another
 * group opens after the person picks that group. Leaving with unsaved text asks first.
 */
export function NoteEditorView({ noteId = null }: { noteId?: string | null }) {
  const [, navigate] = useLocation()
  const store = notesStore
  const groupId = selectionStore.groupId.value
  useEffect(() => {
    if (groupId) void store.open(groupId, noteId)
  }, [groupId, noteId])

  const membership = groupId
    ? groupsStore.groups.value.find((group) => group.id === groupId)
    : undefined
  const creating = noteId === null
  const editing = store.editing.value
  const missing = store.missing.value
  const listError = store.listError.value
  // The open note is read once the list is: until then it is neither found nor missing.
  const readingNote = !creating && editing === null && !missing && listError === null
  const errors = creating ? store.createErrors.value : store.editErrors.value
  return (
    <>
      {groupId && (
        <OfflineStatus
          groupId={groupId}
          onResolved={() => void store.refresh().catch(() => {})}
        />
      )}
      <NoteEditorScreen
        group={membership
          ? { id: membership.id, name: membership.name, canWrite: canMutateNotes(membership.role) }
          : null}
        loading={groupsStore.loading.value || groupId === null || readingNote}
        notFound={missing || (!creating && editing === null && listError !== null)}
        note={editing && { id: editing.id, version: editing.version, conflict: editing.conflict }}
        value={editing ?? store.draft.value}
        onChange={(value) => {
          if (editing) store.editing.value = { ...editing, ...value }
          else store.draft.value = value
        }}
        draftId={store.draftId.value}
        errors={{ title: errors.title, form: errors.form ?? listError }}
        saving={creating ? store.creating.value : store.saving.value}
        onSave={async () => {
          if (creating) {
            const note = await store.create()
            if (note) navigate(NOTE_PATHS.note(note.id))
          } else if (await store.save()) navigate(NOTE_PATHS.list)
        }}
        onReloadLatest={() => void store.reloadLatest()}
        deleting={store.deleting.value !== null}
        onDelete={async () => {
          if (editing && await store.remove(editing)) navigate(NOTE_PATHS.list)
        }}
        navigate={navigate}
      />
      <UnsavedGuard
        unsaved={store.unsaved.value}
        navigate={navigate}
        onDiscard={() => creating && store.discardDraft()}
      />
    </>
  )
}
