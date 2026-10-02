import { signal } from "@preact/signals"
import { RealtimeRequestError } from "@spy4x/realtime"
import { type PlanRefusal, readPlanRefusal } from "@domain/billing"
import type { GroupRole } from "@domain/groups"
import { apiFetch } from "./api.ts"
import { realtimeCommand } from "./realtime.ts"

/** A member as the API sends them: `joinedAt` is an ISO string. */
export interface MemberItem {
  userId: number
  name: string
  /** Sent only to the owner and admins. */
  email?: string | null
  role: GroupRole
  joinedAt: string
  isYou: boolean
}

/** What the members store needs from the outside. Injected so tests need no network. */
export interface MembersDependencies {
  list(input: { groupId: string }): Promise<{ members: MemberItem[] }>
  setRole(input: { groupId: string; userId: number; role: GroupRole }): Promise<{
    member: MemberItem
  }>
  removeMember(input: { groupId: string; userId: number }): Promise<{ removed: true }>
  leave(input: { groupId: string }): Promise<{ left: true }>
}

function describe(error: unknown, fallback: string): string {
  return error instanceof RealtimeRequestError ? error.message : fallback
}

/**
 * The members of the group whose settings are open, and the changes to them in flight.
 *
 * It holds one group at a time. A read answered after the page moved to another group, or after
 * a newer read started, is dropped, so the list always belongs to the group shown.
 */
export function createMembersStore(dependencies: MembersDependencies) {
  const groupId = signal<string | null>(null)
  /** The members, or `null` until the first read of this group answers. */
  const members = signal<readonly MemberItem[] | null>(null)
  const loadError = signal<string | null>(null)
  /** The member whose role change or removal is in flight. */
  const pendingUserId = signal<number | null>(null)
  /** Why the last role change or removal was refused, and for which member. */
  const memberError = signal<
    { userId: number; message: string; plan: PlanRefusal | null } | null
  >(null)
  const leaving = signal(false)
  const leaveError = signal<string | null>(null)
  let reads = 0

  /** Reads the members of the open group again. Does nothing while no group is open. */
  async function refresh(): Promise<void> {
    const id = groupId.value
    if (id === null) return
    const read = ++reads
    try {
      const result = await dependencies.list({ groupId: id })
      if (read !== reads || groupId.value !== id) return
      members.value = result.members
      loadError.value = null
    } catch (cause) {
      if (read !== reads || groupId.value !== id) return
      loadError.value = describe(cause, "Could not load the members")
    }
  }

  /** Shows the members of `id`, read from the server. Opening the same group again reads again. */
  function open(id: string): Promise<void> {
    if (groupId.value !== id) {
      groupId.value = id
      members.value = null
      loadError.value = null
      memberError.value = null
      leaveError.value = null
    }
    return refresh()
  }

  /** Runs one change of a member; a second change while one runs is refused. */
  async function change(
    userId: number,
    run: (groupId: string) => Promise<void>,
    fallback: string,
  ): Promise<boolean> {
    const id = groupId.value
    if (id === null || pendingUserId.value !== null) return false
    pendingUserId.value = userId
    memberError.value = null
    try {
      await run(id)
      return true
    } catch (cause) {
      const plan = cause instanceof RealtimeRequestError ? readPlanRefusal(cause.details) : null
      memberError.value = { userId, message: describe(cause, fallback), plan }
      return false
    } finally {
      pendingUserId.value = null
    }
  }

  /** Gives a member a new role. Resolves to whether it worked. */
  function changeRole(userId: number, role: GroupRole): Promise<boolean> {
    return change(userId, async (id) => {
      const { member } = await dependencies.setRole({ groupId: id, userId, role })
      members.value = members.value?.map((m) => m.userId === userId ? member : m) ?? null
    }, "Could not change the role")
  }

  /** Removes a member from the group. Resolves to whether it worked. */
  function remove(userId: number): Promise<boolean> {
    return change(userId, async (id) => {
      await dependencies.removeMember({ groupId: id, userId })
      members.value = members.value?.filter((m) => m.userId !== userId) ?? null
    }, "Could not remove the member")
  }

  /** Leaves the open group. Resolves to whether it worked, so the page can move on. */
  async function leave(): Promise<boolean> {
    const id = groupId.value
    if (id === null || leaving.value) return false
    leaving.value = true
    leaveError.value = null
    try {
      await dependencies.leave({ groupId: id })
      return true
    } catch (cause) {
      leaveError.value = describe(cause, "Could not leave the group")
      return false
    } finally {
      leaving.value = false
    }
  }

  function reset(): void {
    reads++
    groupId.value = null
    members.value = null
    loadError.value = null
    pendingUserId.value = null
    memberError.value = null
    leaving.value = false
    leaveError.value = null
  }

  return {
    groupId,
    members,
    loadError,
    pendingUserId,
    memberError,
    leaving,
    leaveError,
    open,
    refresh,
    changeRole,
    remove,
    leave,
    reset,
  }
}

/**
 * Reads over REST, like every pull, so the list loads before the socket opens; changes go over the
 * socket as commands with a retry key.
 */
export const membersStore = createMembersStore({
  async list({ groupId }) {
    const result = await apiFetch<{ members: MemberItem[] }>(
      `/api/groups/${encodeURIComponent(groupId)}/members`,
    )
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  },
  setRole: (input) => realtimeCommand("group.setRole", input),
  removeMember: (input) => realtimeCommand("group.removeMember", input),
  leave: (input) => realtimeCommand("group.leave", input),
})
