import type { CommandHandler, QueryHandler } from "@spy4x/platform/cqrs"
import type { GroupRepository } from "@domain/groups"
import { GroupSelectedEvent } from "../../cqrs/events.ts"
import {
  GroupCreateCommand,
  GroupError,
  GroupGetQuery,
  GroupListQuery,
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
    return await repository.createShared(
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
