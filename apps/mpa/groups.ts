import type { GroupRow } from "@ui/groups-screen.tsx"
import type { GroupPickerData } from "@ui/group-picker.tsx"
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
 * The id of the group the person works in now, as the server holds it (`GET /api/groups/selected`),
 * or `null` when the read failed or the person has no group.
 */
export async function readSelected(api: Api): Promise<string | null> {
  const answer = await api.call("GET", "/api/groups/selected")
  if (!isOk(answer) || !isRecord(answer.body)) return null
  const { groupId } = answer.body
  return typeof groupId === "string" ? groupId : null
}

/**
 * One group of the person's (`GET /api/groups/:groupId`), or `null` when the read failed or the
 * person is not a member. For the selected group when it is not among the picker's groups.
 */
export async function readGroup(api: Api, groupId: string): Promise<GroupRow | null> {
  const answer = await api.call("GET", `/api/groups/${encodeURIComponent(groupId)}`)
  if (!isOk(answer) || !isRecord(answer.body) || !isRecord(answer.body.group)) return null
  const { id, name, kind, role } = answer.body.group
  if (typeof id !== "string" || typeof name !== "string") return null
  if (typeof kind !== "number" || typeof role !== "number") return null
  return { id, name, kind, role }
}

/**
 * What the side menu's picker shows: the person's groups (the first page of the list, which is
 * every group up to {@link PAGE_LIMIT}) and the selected one. `null` when either read failed, so a
 * page still renders, without a picker.
 */
export async function readPicker(api: Api): Promise<GroupPickerData | null> {
  const [page, selectedId] = await Promise.all([listGroups(api), readSelected(api)])
  return page ? { groups: page.groups, selectedId } : null
}

/**
 * Selects a group for the person (`PUT /api/groups/selected`). `false` when the API refused: the
 * group is missing, or the person is not a member of it.
 */
export async function selectGroup(api: Api, groupId: string): Promise<boolean> {
  return isOk(await api.call("PUT", "/api/groups/selected", { groupId }))
}
