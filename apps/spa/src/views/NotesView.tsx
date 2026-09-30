import { useEffect } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { canMutateNotes } from "@domain/groups"
import { NotesScreen } from "@ui/notes-screen.tsx"
import { NOTE_PATHS } from "@ui/progressive.tsx"
import { groupsStore } from "../state/groups.ts"
import { notesStore } from "../state/notes.ts"
import { OfflineStatus } from "../offline/OfflineStatus.tsx"

/**
 * Wires the notes screen to the notes store for `/groups/:groupId/notes` and, with `noteId`,
 * `/groups/:groupId/notes/:noteId`. The group's name and the person's role come from the groups
 * store; reads and writes go through the notes store.
 */
export function NotesView({ groupId, noteId = null }: { groupId: string; noteId?: string | null }) {
  const [, navigate] = useLocation()
  const store = notesStore
  useEffect(() => {
    void store.open(groupId, noteId)
  }, [groupId, noteId])

  const membership = groupsStore.groups.value.find((group) => group.id === groupId)
  const editing = store.editing.value
  return (
    <>
      <OfflineStatus groupId={groupId} onResolved={() => void store.refresh().catch(() => {})} />
      <NotesScreen
        group={membership
          ? { id: groupId, name: membership.name, canWrite: canMutateNotes(membership.role) }
          : null}
        notes={store.notes.value}
        loading={store.loading.value || groupsStore.loading.value}
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
          if (await store.save()) navigate(NOTE_PATHS.list(groupId))
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
