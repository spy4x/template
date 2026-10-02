import type { ReadonlySignal } from "@preact/signals"
import { userChangeGroupId } from "@domain/identity"

/** What the pull reads and flushes: the stores, as far as the pull needs them. */
export interface PullDependencies {
  userId: number
  flushOutbox(): Promise<void>
  profile: { refresh(): Promise<void> }
  selection: { refresh(): Promise<void> }
  groups: { refresh(): Promise<void>; groups: ReadonlySignal<readonly { id: string }[]> }
  notes: { refresh(): Promise<void>; groupId: ReadonlySignal<string | null> }
  /** The members of the group whose settings are open. */
  members: { refresh(): Promise<void>; groupId: ReadonlySignal<string | null> }
}

/**
 * The read that follows a hint, a reconnect or the start-up: a missed frame costs one read and
 * never leaves a list wrong. `gap` names the group whose hint arrived; none means "read all".
 *
 * The notes of the open group are read only after the groups list is read, and only while that
 * group is still in it. A group that was deleted, or that the person left, is gone from the list,
 * so its notes are never requested (the server would answer "not found").
 *
 * The cost: the notes read waits for the groups read, which includes the deleted-groups fetch, and
 * a groups read that fails rejects the pull before the notes are read. A failed groups read
 * therefore skips the notes refresh of that pull; the next pull (the next hint, a reconnect)
 * reads both again.
 *
 * The members of the group whose settings are open follow the same rule, so a member who was just
 * removed never asks for the members of a group they left.
 */
export function createPull(dependencies: PullDependencies) {
  const { userId, profile, selection, groups, notes, members } = dependencies
  return async (gap?: { groupId: string }): Promise<void> => {
    // The hint for this person's own changes (profile, push devices, selected group), sent after
    // a change in another tab.
    if (gap?.groupId === userChangeGroupId(userId)) {
      await Promise.all([profile.refresh(), selection.refresh()])
      return
    }
    // Writes made offline go out before anything is read, so the read shows their result.
    await dependencies.flushOutbox()
    const openGroup = notes.groupId.value
    const membersGroup = members.groupId.value
    await Promise.all([selection.refresh(), groups.refresh()])
    const due = (id: string | null) =>
      id !== null && groups.groups.value.some((g) => g.id === id) && (!gap || gap.groupId === id)
    await Promise.all([
      due(openGroup) ? notes.refresh() : undefined,
      due(membersGroup) ? members.refresh() : undefined,
    ])
  }
}
