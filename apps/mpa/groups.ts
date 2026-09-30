import type { GroupRow } from "@ui/groups-screen.tsx"
import { type Api, isOk, isRecord } from "./api.ts"

/** The most groups one `GET /api/groups` answers with. */
const PAGE_LIMIT = 100

/** One page of the person's groups and the cursor of the next, or `null` when the read failed. */
export async function listGroups(
  api: Api,
  cursor?: string,
): Promise<{ groups: GroupRow[]; nextCursor: string | null } | null> {
  const query = new URLSearchParams({ limit: String(PAGE_LIMIT) })
  if (cursor) query.set("cursor", cursor)
  const answer = await api.call("GET", `/api/groups?${query}`)
  if (!isOk(answer) || !isRecord(answer.body) || !Array.isArray(answer.body.groups)) return null
  const next = answer.body.nextCursor
  return { groups: answer.body.groups, nextCursor: typeof next === "string" ? next : null }
}

/**
 * The person's membership of one group, or `null` when they are not a member. The API has no read
 * of a single group, so this pages through the list.
 */
export async function findGroup(api: Api, groupId: string): Promise<GroupRow | null> {
  let cursor: string | undefined
  do {
    const page = await listGroups(api, cursor)
    if (!page) return null
    const group = page.groups.find((candidate) => candidate.id === groupId)
    if (group) return group
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return null
}
