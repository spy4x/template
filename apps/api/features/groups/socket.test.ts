import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { GroupCreateCommand, GroupError, GroupKind, GroupRole } from "@domain/groups"
import type { GroupListQuery } from "@domain/groups"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { UserMFAStatus } from "@domain/identity"
import { createGroupSocketRequests } from "./socket.ts"
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, parseListPayload } from "./list.ts"

const id = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
const actor = {
  userId: 7,
  userMfa: UserMFAStatus.NOT_CONFIGURED,
  sessionSecondFactor: SecondFactorStatus.NotRequired,
}

const signal = new AbortController().signal

function harness() {
  const seen: { command: GroupCreateCommand | null; query: GroupListQuery | null } = {
    command: null,
    query: null,
  }
  const requests = createGroupSocketRequests({
    create(command) {
      seen.command = command
      return Promise.resolve({
        created: true,
        group: {
          id,
          kind: GroupKind.SHARED,
          name: command.data.name,
          role: GroupRole.OWNER,
          authorizationRevision: "1",
          changeSequence: "1",
          updatedAt: new Date(0),
        },
      })
    },
    list(query) {
      seen.query = query
      return Promise.resolve({ groups: [], nextPageKey: { updatedAt: new Date(0), id } })
    },
    cursor: {
      encode: (userId) => Promise.resolve(`cursor-for-${userId}`),
      decode: (cursor) => Promise.resolve({ updatedAt: new Date(0), id: cursor }),
    },
  })
  return { requests, seen }
}

describe("group socket requests", () => {
  it("declares create as a command and list as a query", () => {
    const { requests } = harness()

    expect(requests["group.create"].kind).toBe("command")
    expect(requests["group.list"].kind).toBe("query")
  })

  it("dispatches create with the actor, request id and idempotency key of the call", async () => {
    const { requests, seen } = harness()

    await requests["group.create"].handle({
      actor,
      requestId: "req-1",
      signal,
      idempotencyKey: "key-1",
      payload: { id, kind: GroupKind.SHARED, name: " Team " },
    })

    expect(seen.command?.data).toEqual({
      actor,
      id,
      kind: GroupKind.SHARED,
      name: "Team",
      requestId: "req-1",
      idempotencyKey: "key-1",
    })
  })

  it("refuses a create payload that names a user", async () => {
    const { requests, seen } = harness()

    await expect(requests["group.create"].handle({
      actor,
      requestId: "req-1",
      signal,
      idempotencyKey: "key-1",
      payload: { id, kind: GroupKind.SHARED, name: "Team", userId: 999 },
    })).rejects.toBeInstanceOf(GroupError)
    expect(seen.command).toBe(null)
  })

  it("lists the actor's groups and returns the next cursor", async () => {
    const { requests, seen } = harness()

    const page = await requests["group.list"].handle({
      actor,
      requestId: "req-2",
      signal,
      payload: { limit: 10, cursor: "abc" },
    })

    expect(seen.query?.data.actor).toEqual(actor)
    expect(seen.query?.data.page.limit).toBe(10)
    expect(seen.query?.data.page.after?.id).toBe("abc")
    expect(page).toEqual({ groups: [], nextCursor: "cursor-for-7" })
  })
})

describe("group.list payload", () => {
  it("defaults to the first page of the default size", () => {
    expect(parseListPayload(undefined)).toEqual({ limit: DEFAULT_LIST_LIMIT })
    expect(parseListPayload(null)).toEqual({ limit: DEFAULT_LIST_LIMIT })
  })

  it("accepts a limit up to the maximum", () => {
    expect(parseListPayload({ limit: MAX_LIST_LIMIT }).limit).toBe(MAX_LIST_LIMIT)
  })

  for (
    const [name, payload] of [
      ["a limit of zero", { limit: 0 }],
      ["a limit above the maximum", { limit: MAX_LIST_LIMIT + 1 }],
      ["a fractional limit", { limit: 1.5 }],
      ["an empty cursor", { cursor: "" }],
      ["a numeric cursor", { cursor: 5 }],
      ["an unknown field", { userId: 1 }],
      ["an array", []],
      ["a string", "x"],
    ] as const
  ) {
    it(`rejects ${name}`, () => {
      expect(() => parseListPayload(payload)).toThrow(GroupError)
    })
  }
})
