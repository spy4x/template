import { useEffect } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { canViewActivity } from "@domain/groups"
import { GroupActivityScreen } from "@ui/group-activity-screen.tsx"
import { activityStore } from "../state/activity.ts"
import { groupsStore } from "../state/groups.ts"

/**
 * Wires a group's activity log to the activity store for `/groups/:groupId/activity`. The log is
 * read only for an admin or the owner; any other member sees the refusal without a request.
 */
export function GroupActivityView({ groupId }: { groupId: string }) {
  const [, navigate] = useLocation()
  const membership = groupsStore.groups.value.find((group) => group.id === groupId)
  const allowed = membership !== undefined && canViewActivity(membership.role)
  useEffect(() => {
    if (allowed) void activityStore.open(groupId)
  }, [groupId, allowed])

  const store = activityStore
  const ours = store.groupId.value === groupId
  return (
    <GroupActivityScreen
      group={membership ? { id: membership.id, name: membership.name } : null}
      events={ours ? store.events.value : []}
      loading={groupsStore.loading.value || (allowed && (!ours || store.loading.value))}
      loadingMore={store.loadingMore.value}
      hasMore={ours && store.nextCursor.value !== null}
      onLoadMore={() => void store.loadMore()}
      error={ours ? store.error.value : null}
      forbidden={membership !== undefined && !allowed}
      navigate={navigate}
    />
  )
}
