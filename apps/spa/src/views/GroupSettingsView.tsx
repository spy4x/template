import { useLocation } from "wouter-preact"
import { GroupSettingsScreen } from "@ui/group-settings-screen.tsx"
import { NOTE_PATHS, SCREEN_PATHS } from "@ui/progressive.tsx"
import { groupsStore } from "../state/groups.ts"
import { selectionStore } from "../state/selection.ts"

/** Wires one group's settings screen to the groups store, which already holds every group. */
export function GroupSettingsView({ groupId }: { groupId: string }) {
  const [, navigate] = useLocation()
  const store = groupsStore
  const group = store.groups.value.find((candidate) => candidate.id === groupId) ?? null
  const draft = store.renameDraft.value
  const working = store.working.value
  // An error of another group's page is not this page's.
  const failure = store.actionError.value?.groupId === groupId ? store.actionError.value : null
  return (
    <GroupSettingsScreen
      group={group}
      selected={selectionStore.groupId.value === groupId}
      // A person always has a group, so an empty list means the first read has not answered yet.
      loading={store.loading.value || store.groups.value.length === 0}
      error={store.loadError.value}
      navigate={navigate}
      onOpen={(id) => {
        void selectionStore.select(id)
        navigate(NOTE_PATHS.list)
      }}
      name={draft?.groupId === groupId ? draft.name : undefined}
      onNameChange={(name) => (store.renameDraft.value = { groupId, name })}
      renaming={working?.groupId === groupId && working.action === "rename"}
      renameError={failure?.action === "rename" ? failure.message : null}
      onRename={() => void store.rename(groupId)}
      isLastGroup={store.groups.value.length <= 1}
      deleting={working?.groupId === groupId && working.action === "delete"}
      deleteError={failure?.action === "delete" ? failure.message : null}
      onDelete={() =>
        void store.remove(groupId).then(async (deleted) => {
          if (!deleted) return
          // The server moved everyone who had this group selected; read where this tab goes now.
          await selectionStore.refresh().catch(() => {})
          navigate(SCREEN_PATHS.groups)
        })}
    />
  )
}
