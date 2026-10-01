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
 * The person's membership of one group, or `null` when they are not a member (the API answers that
 * as a missing group) or the read failed. One API call, whatever the number of groups.
 */
export async function findGroup(api: Api, groupId: string): Promise<GroupRow | null> {
  const answer = await api.call("GET", `/api/groups/${encodeURIComponent(groupId)}`)
  if (!isOk(answer) || !isRecord(answer.body) || !isRecord(answer.body.group)) return null
  return answer.body.group as unknown as GroupRow
}
