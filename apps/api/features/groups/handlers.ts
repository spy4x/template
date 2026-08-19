import type { CommandHandler, QueryHandler } from "@platform/cqrs/types.ts"
import type { GroupRepository } from "@domain/groups"
import { GroupCreateCommand, GroupListQuery } from "@domain/groups"
import { assertMfaSatisfied } from "@domain/identity"

/**
 * Authorization runs here rather than in route middleware so every transport is
 * covered by one implementation. A WebSocket that dispatches this command gets
 * the same checks as an HTTP request without mounting anything.
 */
export function createGroupCreateHandler(
  repository: GroupRepository,
): CommandHandler<GroupCreateCommand> {
  return async (command) => {
    const { actor } = command.data
    assertMfaSatisfied(actor)
    return await repository.createShared(
      { id: command.data.id, name: command.data.name, requestId: command.data.requestId },
      actor.userId,
    )
  }
}

export function createGroupListHandler(
  repository: GroupRepository,
): QueryHandler<GroupListQuery> {
  return async (query) => {
    const { actor } = query.data
    assertMfaSatisfied(actor)
    return await repository.listForUser(actor.userId, query.data.page)
  }
}
