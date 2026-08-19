import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { AccessError, type Actor, SessionMFAStatus, UserMFAStatus } from "@domain/identity"
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

function actor(userId: number, overrides: Partial<Actor> = {}): Actor {
  return {
    userId,
    userMfa: UserMFAStatus.NOT_CONFIGURED,
    sessionMfa: SessionMFAStatus.NOT_REQUIRED,
    ...overrides,
  }
}

describe("group CQRS handlers", () => {
  it("scopes create to command user", async () => {
    const repository = new FakeGroupRepository()
    const handler = createGroupCreateHandler(repository)
    const result = await handler(
      new GroupCreateCommand({
        actor: actor(42),
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
    const result = await handler(new GroupListQuery({ actor: actor(84), page: { limit: 50 } }))

    expect(repository.listUserId).toBe(84)
    expect(result.groups).toEqual([summary])
  })

  it("refuses a command when the session has not completed MFA", async () => {
    const repository = new FakeGroupRepository()
    const handler = createGroupCreateHandler(repository)
    const command = new GroupCreateCommand({
      actor: actor(42, {
        userMfa: UserMFAStatus.CONFIGURED,
        sessionMfa: SessionMFAStatus.NOT_PASSED_YET,
      }),
      id: summary.id,
      kind: GroupKind.SHARED,
      name: "Team",
    })

    await expect(handler(command)).rejects.toThrow(AccessError)
    // The repository is never reached, so no transport can dispatch past this.
    expect(repository.createActorId).toBe(null)
  })

  it("refuses a query when the session has not completed MFA", async () => {
    const repository = new FakeGroupRepository()
    const handler = createGroupListHandler(repository)
    const query = new GroupListQuery({
      actor: actor(84, {
        userMfa: UserMFAStatus.CONFIGURED,
        sessionMfa: SessionMFAStatus.NOT_PASSED_YET,
      }),
      page: { limit: 50 },
    })

    await expect(handler(query)).rejects.toThrow(AccessError)
    expect(repository.listUserId).toBe(null)
  })
})
