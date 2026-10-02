import { useLocation } from "wouter-preact"
import { GroupsScreen } from "@ui/groups-screen.tsx"
import { NOTE_PATHS } from "@ui/progressive.tsx"
import { groupsStore } from "../state/groups.ts"
import { selectionStore } from "../state/selection.ts"
import { MyInvitationsView } from "./InvitationView.tsx"

/** Wires the groups screen to the groups store: reads and creates go through the store. */
export function GroupsView() {
  const store = groupsStore
  const [, navigate] = useLocation()
  const working = store.working.value
  const failure = store.actionError.value
  return (
    <GroupsScreen
      groups={store.groups.value}
      deleted={store.deleted.value}
      selectedId={selectionStore.groupId.value}
      navigate={navigate}
      name={store.name.value}
      onNameChange={(name) => (store.name.value = name)}
      creating={store.creating.value}
      loading={store.loading.value}
      error={store.error.value}
      onCreate={() => void store.create()}
      onRefresh={() => void store.refreshFromUser()}
      restoreError={failure?.action === "restore" ? failure.message : null}
      restoringId={working?.action === "restore" ? working.groupId : null}
      onRestore={(groupId) => void store.restore(groupId)}
      invitations={<MyInvitationsView />}
      onOpen={(groupId) => {
        void selectionStore.select(groupId)
        navigate(NOTE_PATHS.list)
      }}
    />
  )
}
