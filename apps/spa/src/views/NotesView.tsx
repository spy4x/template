import { useEffect } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { canMutateNotes } from "@domain/groups"
import { NotesScreen } from "@ui/notes-screen.tsx"
import { NOTE_PATHS } from "@ui/progressive.tsx"
import { groupsStore } from "../state/groups.ts"
import { notesStore } from "../state/notes.ts"
import { selectionStore } from "../state/selection.ts"
import { OfflineStatus } from "../offline/OfflineStatus.tsx"

/**
 * Wires the notes screen to the notes store for `/notes` and, with `noteId`, `/notes/:noteId`. The
 * notes are those of the person's selected group (the selection store); the group's name and the
 * person's role come from the groups store, and reads and writes go through the notes store.
 */
export function NotesView({ noteId = null }: { noteId?: string | null }) {
  const [, navigate] = useLocation()
  const store = notesStore
  const groupId = selectionStore.groupId.value
  useEffect(() => {
    if (groupId) void store.open(groupId, noteId)
  }, [groupId, noteId])

  const membership = groupId
    ? groupsStore.groups.value.find((group) => group.id === groupId)
    : undefined
  const editing = store.editing.value
  return (
    <>
      {groupId && (
        <OfflineStatus
          groupId={groupId}
          onResolved={() => void store.refresh().catch(() => {})}
        />
      )}
      <NotesScreen
        group={membership
          ? { id: membership.id, name: membership.name, canWrite: canMutateNotes(membership.role) }
          : null}
        notes={store.notes.value}
        loading={store.loading.value || groupsStore.loading.value || groupId === null}
        draftId={store.draftId.value}
        draft={store.draft.value}
        onDraftChange={(draft) => (store.draft.value = draft)}
        createErrors={store.createErrors.value}
        creating={store.creating.value}
        onCreate={() => void store.create()}
        editing={editing}
        onEditChange={(draft) => {
          if (editing) store.editing.value = { ...editing, ...draft }
        }}
        editErrors={store.editErrors.value}
        saving={store.saving.value}
        onSave={async () => {
          if (await store.save()) navigate(NOTE_PATHS.list)
        }}
        onReloadLatest={() => void store.reloadLatest()}
        deleting={store.deleting.value}
        onDelete={(row) => {
          const note = store.notes.value.find((item) => item.id === row.id)
          if (note) void store.remove(note)
        }}
        listError={store.listError.value}
        nextPageHref={null}
        navigate={navigate}
      />
    </>
  )
}
