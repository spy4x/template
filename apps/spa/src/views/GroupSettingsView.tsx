import { useLocation } from "wouter-preact"
import { GroupSettingsScreen } from "@ui/group-settings-screen.tsx"
import { NOTE_PATHS } from "@ui/progressive.tsx"
import { groupsStore } from "../state/groups.ts"
import { selectionStore } from "../state/selection.ts"

/** Wires one group's settings screen to the groups store, which already holds every group. */
export function GroupSettingsView({ groupId }: { groupId: string }) {
  const [, navigate] = useLocation()
  const group = groupsStore.groups.value.find((candidate) => candidate.id === groupId) ?? null
  return (
    <GroupSettingsScreen
      group={group}
      selected={selectionStore.groupId.value === groupId}
      // A person always has a group, so an empty list means the first read has not answered yet.
      loading={groupsStore.loading.value || groupsStore.groups.value.length === 0}
      error={groupsStore.loadError.value}
      navigate={navigate}
      onOpen={(id) => {
        void selectionStore.select(id)
        navigate(NOTE_PATHS.list)
      }}
    />
  )
}
