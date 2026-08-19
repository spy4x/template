import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import {
  CreatePersonalGroupInput,
  CreateSharedGroupInput,
  Group,
  GroupAccess,
  GroupCreateCommand,
  GroupKind,
  GroupListQuery,
  GroupRepository,
  GroupRole,
  GroupSummary,
} from "@domain/groups"
import { createGroupCreateHandler, createGroupListHandler } from "./handlers.ts"

const now = new Date("2026-08-18T10:00:00.000Z")
const summary: GroupSummary = {
  id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001",
  kind: GroupKind.SHARED,
  name: "Team",
  role: GroupRole.OWNER,
  authorizationRevision: "1",
  updatedAt: now,
}

class FakeGroupRepository implements GroupRepository {
  createActorId: number | null = null
  listUserId: number | null = null

  listForUser(userId: number) {
    this.listUserId = userId
    return Promise.resolve({ groups: [summary], nextPageKey: null })
  }

  getForMember(_groupId: string, _userId: number): Promise<GroupAccess | null> {
    return Promise.resolve(null)
  }

  createShared(input: CreateSharedGroupInput, actorId: number) {
    this.createActorId = actorId
    return Promise.resolve({ group: { ...summary, id: input.id, name: input.name }, created: true })
  }

  createPersonal(_input: CreatePersonalGroupInput, _userId: number): Promise<Group> {
    throw new Error("Not used")
  }

  ensurePersonal(_input: CreatePersonalGroupInput, _userId: number): Promise<Group> {
    throw new Error("Not used")
  }
}

describe("group CQRS handlers", () => {
  it("scopes create to command user", async () => {
    const repository = new FakeGroupRepository()
    const handler = createGroupCreateHandler(repository)
    const result = await handler(
      new GroupCreateCommand({
        userId: 42,
        id: summary.id,
        kind: GroupKind.SHARED,
        name: "Team",
      }),
    )

    expect(repository.createActorId).toBe(42)
    expect(result.group.role).toBe(GroupRole.OWNER)
  })

  it("scopes list to query user", async () => {
    const repository = new FakeGroupRepository()
    const handler = createGroupListHandler(repository)
    const result = await handler(new GroupListQuery({ userId: 84, page: { limit: 50 } }))

    expect(repository.listUserId).toBe(84)
    expect(result.groups).toEqual([summary])
  })
})
