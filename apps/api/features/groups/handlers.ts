import type { CommandHandler, QueryHandler } from "@platform/cqrs/types.ts"
import type { GroupRepository } from "@domain/groups"
import { GroupCreateCommand, GroupListQuery } from "@domain/groups"

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
