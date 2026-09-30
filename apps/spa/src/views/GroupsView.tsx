import { useLocation } from "wouter-preact"
import { GroupsScreen } from "@ui/groups-screen.tsx"
import { groupsStore } from "../state/groups.ts"

/** Wires the groups screen to the groups store: reads and creates go through the store. */
export function GroupsView() {
  const store = groupsStore
  const [, navigate] = useLocation()
  return (
    <GroupsScreen
      groups={store.groups.value}
      name={store.name.value}
      onNameChange={(name) => (store.name.value = name)}
      creating={store.creating.value}
      loading={store.loading.value}
      error={store.error.value}
      onCreate={() => void store.create()}
      onRefresh={() => void store.refreshFromUser()}
      navigate={navigate}
    />
  )
}
