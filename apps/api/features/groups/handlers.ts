import type { CommandHandler, QueryHandler } from "@spy4x/platform/cqrs"
import type { GroupRepository } from "@domain/groups"
import { GroupCreateCommand, GroupListQuery } from "@domain/groups"

export function createGroupCreateHandler(
  repository: GroupRepository,
): CommandHandler<GroupCreateCommand> {
  return async (command) => {
    return await repository.createShared(
      { id: command.data.id, name: command.data.name, requestId: command.data.requestId },
      command.data.userId,
    )
  }
}

export function createGroupListHandler(
  repository: GroupRepository,
): QueryHandler<GroupListQuery> {
  return async (query) => await repository.listForUser(query.data.userId, query.data.page)
}
