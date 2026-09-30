import type { GroupItem, GroupsDependencies } from "../state/groups.ts"
import type { OfflineLayer } from "./index.ts"
import { isUnreachable } from "./notes-offline.ts"

/** More pages than any account has groups: a stop for a cursor loop. */
const MAX_PAGES = 100

/**
 * Keeps the groups list on this device and answers from it when the network is down. Creating a
 * group needs the server and is not queued.
 */
export function offlineGroups(
  online: GroupsDependencies,
  current: () => OfflineLayer | null,
): GroupsDependencies {
  return {
    ...online,
    async fetchPage(cursor, via) {
      const layer = current()
      if (!layer || via === "socket") return await online.fetchPage(cursor, via)
      try {
        const groups: GroupItem[] = []
        let next: string | null = cursor
        for (let page = 0; page < MAX_PAGES; page++) {
          const result = await online.fetchPage(next, via)
          groups.push(...result.groups)
          next = result.nextCursor
          if (next === null) break
        }
        await layer.store.replaceGroups(groups)
        return { groups, nextCursor: null }
      } catch (error) {
        if (!isUnreachable(error)) throw error
        return { groups: await layer.store.readGroups(), nextCursor: null }
      }
    },
    readLocal: async () => await current()?.store.readGroups() ?? [],
  }
}
