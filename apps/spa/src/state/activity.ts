import { signal } from "@preact/signals"
import type { ActivityRow } from "@ui/group-activity-screen.tsx"
import { apiFetch } from "./api.ts"

/** One page of the log as the API answers: `nextCursor` is `null` on the last page. */
export interface ActivityPageResult {
  events: ActivityRow[]
  nextCursor: string | null
}

/** What the activity store needs from the outside. Injected so tests need no network. */
export interface ActivityDependencies {
  /** Reads a page of the group's log; throws an `Error` with the API's message when refused. */
  list(input: { groupId: string; cursor: string | null }): Promise<ActivityPageResult>
}

/**
 * The activity log of the group whose page is open, newest first, one page at a time. It holds one
 * group: a page answered after the person moved to another group, or after the same group was
 * opened again, is dropped, so the list always belongs to the group shown.
 */
export function createActivityStore(dependencies: ActivityDependencies) {
  const groupId = signal<string | null>(null)
  const events = signal<readonly ActivityRow[]>([])
  const nextCursor = signal<string | null>(null)
  const loading = signal(false)
  const loadingMore = signal(false)
  const error = signal<string | null>(null)
  let reads = 0

  /** Reads the first page of `id`'s log, replacing whatever the store shows. */
  async function open(id: string): Promise<void> {
    const read = ++reads
    if (groupId.value !== id) {
      events.value = []
      nextCursor.value = null
    }
    groupId.value = id
    loading.value = true
    loadingMore.value = false
    error.value = null
    try {
      const page = await dependencies.list({ groupId: id, cursor: null })
      if (read !== reads) return
      events.value = page.events
      nextCursor.value = page.nextCursor
    } catch (cause) {
      if (read !== reads) return
      error.value = cause instanceof Error ? cause.message : "Could not load the activity"
    } finally {
      if (read === reads) loading.value = false
    }
  }

  /** Reads the page after the last one shown and adds it at the end. */
  async function loadMore(): Promise<void> {
    const id = groupId.value
    const cursor = nextCursor.value
    // While the first page is still on its way there is nothing to continue from, and a second
    // read would make `open` drop its answer.
    if (id === null || cursor === null || loading.value || loadingMore.value) return
    const read = ++reads
    loadingMore.value = true
    error.value = null
    try {
      const page = await dependencies.list({ groupId: id, cursor })
      if (read !== reads) return
      const known = new Set(events.value.map((event) => event.id))
      events.value = [...events.value, ...page.events.filter((event) => !known.has(event.id))]
      nextCursor.value = page.nextCursor
    } catch (cause) {
      if (read !== reads) return
      error.value = cause instanceof Error ? cause.message : "Could not load more activity"
    } finally {
      if (read === reads) loadingMore.value = false
    }
  }

  return { groupId, events, nextCursor, loading, loadingMore, error, open, loadMore }
}

/** The activity of the open group, read over REST: `GET /api/groups/:groupId/activity`. */
export const activityStore = createActivityStore({
  async list({ groupId, cursor }) {
    const query = cursor ? `?${new URLSearchParams({ cursor })}` : ""
    const result = await apiFetch<ActivityPageResult>(
      `/api/groups/${encodeURIComponent(groupId)}/activity${query}`,
    )
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  },
})
