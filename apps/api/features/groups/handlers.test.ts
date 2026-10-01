import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { type Actor, UserMFAStatus } from "@domain/identity"
import {
  CreatePersonalGroupInput,
  CreateSharedGroupInput,
  Group,
  GroupAccess,
  GroupCreateCommand,
  GroupError,
  GroupGetQuery,
  GroupKind,
  GroupListQuery,
  GroupRepository,
  GroupRole,
  GroupSummary,
} from "@domain/groups"
import {
  createGroupCreateHandler,
  createGroupGetHandler,
  createGroupListHandler,
} from "./handlers.ts"

const now = new Date("2026-08-18T10:00:00.000Z")
const summary: GroupSummary = {
  id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001",
  kind: GroupKind.SHARED,
  name: "Team",
  role: GroupRole.OWNER,
  authorizationRevision: "1",
  changeSequence: "1",
  updatedAt: now,
}

class FakeGroupRepository implements GroupRepository {
  createActorId: number | null = null
  listUserId: number | null = null

  listForUser(userId: number) {
    this.listUserId = userId
    return Promise.resolve({ groups: [summary], nextPageKey: null })
  }

  getSummaryForMember(groupId: string, userId: number) {
    return Promise.resolve(groupId === summary.id && userId === 84 ? summary : null)
  }

  listMemberUserIds(_groupId: string): Promise<number[]> {
    throw new Error("Not used")
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
    sessionSecondFactor: SecondFactorStatus.NotRequired,
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

  it("reads one group of a member", async () => {
    const handler = createGroupGetHandler(new FakeGroupRepository())
    const result = await handler(new GroupGetQuery({ actor: actor(84), groupId: summary.id }))

    expect(result).toEqual({ group: summary })
  })

  it("answers a non-member exactly as a missing group", async () => {
    const handler = createGroupGetHandler(new FakeGroupRepository())
    const missing = await handler(
      new GroupGetQuery({ actor: actor(84), groupId: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d119999" }),
    ).catch((error) => error)
    const stranger = await handler(new GroupGetQuery({ actor: actor(85), groupId: summary.id }))
      .catch((error) => error)

    expect(stranger).toBeInstanceOf(GroupError)
    expect(stranger.code).toBe("GROUP_NOT_FOUND")
    expect([stranger.code, stranger.message]).toEqual([missing.code, missing.message])
  })
})
