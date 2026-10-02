import {
  GroupCreateCommand,
  GroupDeleteCommand,
  GroupDeletedListQuery,
  GroupError,
  GroupGetQuery,
  GroupRenameCommand,
  GroupRestoreCommand,
  GroupSelectCommand,
  GroupSelectedQuery,
  parseCreateGroupRequest,
  parseGroupId,
  parseGroupIdRequest,
  parseRenameGroupRequest,
} from "@domain/groups"
import type {
  DeletedGroupSummary,
  GroupCreateResult,
  GroupGetResult,
  GroupSummary,
  SelectedGroup,
} from "@domain/groups"
import type { SocketRequests } from "../../services/realtime.ts"
import { type GroupListDependencies, listGroupsPage, parseListPayload } from "./list.ts"

/** What the group socket requests need from the app. */
export interface GroupSocketDependencies extends GroupListDependencies {
  create(command: GroupCreateCommand): Promise<GroupCreateResult>
  get(query: GroupGetQuery): Promise<GroupGetResult>
  select(command: GroupSelectCommand): Promise<SelectedGroup>
  selected(query: GroupSelectedQuery): Promise<SelectedGroup>
  rename(command: GroupRenameCommand): Promise<{ group: GroupSummary }>
  delete(command: GroupDeleteCommand): Promise<{ group: DeletedGroupSummary }>
  restore(command: GroupRestoreCommand): Promise<{ group: GroupSummary }>
  deleted(query: GroupDeletedListQuery): Promise<{ groups: DeletedGroupSummary[] }>
}

/**
 * The group commands and queries the socket serves. Each parses its payload with the same code the
 * REST route uses and dispatches on the same bus; none holds a business rule or an authorization
 * check of its own.
 */
export function createGroupSocketRequests(dependencies: GroupSocketDependencies): SocketRequests {
  return {
    "group.create": {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const input = parseCreateGroupRequest(payload)
        return await dependencies.create(
          new GroupCreateCommand({
            actor,
            id: input.id,
            name: input.name,
            requestId,
            idempotencyKey,
          }),
        )
      },
    },
    "group.get": {
      kind: "query",
      handle: async ({ actor, payload }) => {
        const keys = payload && typeof payload === "object" ? Object.keys(payload) : []
        if (keys.length !== 1 || keys[0] !== "groupId") {
          throw new GroupError("INVALID_REQUEST", "Expected exactly groupId")
        }
        const groupId = parseGroupId((payload as { groupId: unknown }).groupId)
        return await dependencies.get(new GroupGetQuery({ actor, groupId }))
      },
    },
    "group.select": {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const { groupId } = parseGroupIdRequest(payload)
        return await dependencies.select(
          new GroupSelectCommand({ actor, groupId, requestId, idempotencyKey }),
        )
      },
    },
    "group.rename": {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const { groupId, name } = parseRenameGroupRequest(payload)
        return await dependencies.rename(
          new GroupRenameCommand({ actor, groupId, name, requestId, idempotencyKey }),
        )
      },
    },
    "group.delete": {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const { groupId } = parseGroupIdRequest(payload)
        return await dependencies.delete(
          new GroupDeleteCommand({ actor, groupId, requestId, idempotencyKey }),
        )
      },
    },
    "group.restore": {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const { groupId } = parseGroupIdRequest(payload)
        return await dependencies.restore(
          new GroupRestoreCommand({ actor, groupId, requestId, idempotencyKey }),
        )
      },
    },
    "group.deleted": {
      kind: "query",
      handle: async ({ actor }) => await dependencies.deleted(new GroupDeletedListQuery({ actor })),
    },
    "group.selected": {
      kind: "query",
      handle: async ({ actor }) => await dependencies.selected(new GroupSelectedQuery({ actor })),
    },
    "group.list": {
      kind: "query",
      handle: async ({ actor, payload }) =>
        await listGroupsPage(dependencies, actor, parseListPayload(payload)),
    },
  }
}
