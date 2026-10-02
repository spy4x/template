import type { CommandHandler, QueryHandler } from "@spy4x/platform/cqrs"
import type { GroupRepository } from "@domain/groups"
import { GroupSelectedEvent } from "../../cqrs/events.ts"
import {
  assertCanDelete,
  assertCanRename,
  GroupCreateCommand,
  GroupDeleteCommand,
  GroupDeletedListQuery,
  GroupError,
  GroupGetQuery,
  GroupListQuery,
  GroupRenameCommand,
  GroupRestoreCommand,
  GroupSelectCommand,
  GroupSelectedQuery,
} from "@domain/groups"

/**
 * Business logic only. Session strength is enforced by a CQRS middleware that
 * runs on every dispatch, so it is neither repeated here nor skippable by a
 * transport. Group-scoped authorization - membership and role - is a business
 * rule and stays in the repository queries, which are membership-scoped.
 */
export function createGroupCreateHandler(
  repository: GroupRepository,
): CommandHandler<GroupCreateCommand> {
  return async (command) => {
    return await repository.create(
      { id: command.data.id, name: command.data.name, requestId: command.data.requestId },
      command.data.actor.userId,
    )
  }
}

export function createGroupListHandler(
  repository: GroupRepository,
): QueryHandler<GroupListQuery> {
  return async (query) => await repository.listForUser(query.data.actor.userId, query.data.page)
}

/** A group the person is not a member of answers exactly as a missing one: no existence leak. */
export function createGroupGetHandler(
  repository: GroupRepository,
): QueryHandler<GroupGetQuery> {
  return async ({ data }) => {
    const group = await repository.getSummaryForMember(data.groupId, data.actor.userId)
    if (!group) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
    return { group }
  }
}

/** A group the person is not a member of answers exactly as a missing one: no existence leak. */
export function createGroupSelectHandler(
  repository: GroupRepository,
  { emit }: { emit(event: GroupSelectedEvent): void },
): CommandHandler<GroupSelectCommand> {
  return async ({ data }) => {
    const selected = await repository.select(data.actor.userId, data.groupId)
    if (!selected) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
    // After the write: the person's other tabs read the new selection.
    emit(new GroupSelectedEvent({ userId: data.actor.userId, groupId: data.groupId }))
    return selected
  }
}

export function createGroupSelectedHandler(
  repository: GroupRepository,
): QueryHandler<GroupSelectedQuery> {
  return async ({ data }) => await repository.getSelected(data.actor.userId)
}

/**
 * Renames a group. The role is read from the group's membership in Postgres and checked first:
 * an admin or the owner may, a viewer or editor is refused, and a person who is not a member is
 * told the group does not exist.
 */
export function createGroupRenameHandler(
  repository: GroupRepository,
): CommandHandler<GroupRenameCommand> {
  return async ({ data }) => {
    const access = await repository.getForMember(data.groupId, data.actor.userId)
    assertCanRename(access?.role ?? null)
    const group = await repository.rename(
      data.groupId,
      data.name,
      data.actor.userId,
      data.requestId,
    )
    if (!group) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
    return { group }
  }
}

/**
 * Deletes a group, softly: only the owner may, and the repository refuses the owner's last group.
 * Every member's page learns of it from the group's change hint, which the worker announces.
 */
export function createGroupDeleteHandler(
  repository: GroupRepository,
): CommandHandler<GroupDeleteCommand> {
  return async ({ data }) => {
    const access = await repository.getForMember(data.groupId, data.actor.userId)
    assertCanDelete(access?.role ?? null)
    const group = await repository.softDelete(data.groupId, data.actor.userId, data.requestId)
    if (!group) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
    return { group }
  }
}

/** Restores a group deleted in the last 30 days: only its owner may. */
export function createGroupRestoreHandler(
  repository: GroupRepository,
): CommandHandler<GroupRestoreCommand> {
  return async ({ data }) => {
    const access = await repository.getRestorableForMember(data.groupId, data.actor.userId)
    assertCanDelete(access?.role ?? null)
    const group = await repository.restore(data.groupId, data.actor.userId, data.requestId)
    if (!group) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
    return { group }
  }
}

export function createGroupDeletedListHandler(
  repository: GroupRepository,
): QueryHandler<GroupDeletedListQuery> {
  return async ({ data }) => ({ groups: await repository.listRestorable(data.actor.userId) })
}
