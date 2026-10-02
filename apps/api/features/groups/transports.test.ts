import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import { drainMicrotasks, FakeClock, FakeSocket } from "@spy4x/realtime/testing"
import { CommandBus, QueryBus } from "@spy4x/platform/cqrs"
import {
  GroupDeleteCommand,
  GroupDeletedListQuery,
  GroupLeaveCommand,
  GroupMemberRemoveCommand,
  GroupMemberRoleCommand,
  GroupMembersQuery,
  GroupRenameCommand,
  GroupRestoreCommand,
  GroupRole,
} from "@domain/groups"
import { createSessionGate } from "../../cqrs/session-gate.ts"
import { buildAuthData } from "../../_testing/fake-auth.ts"
import { MemoryGroupRepository } from "../../_testing/memory-groups.ts"
import type { APIContext } from "../../_types.ts"
import { createGroupsRoute, type GroupsRouteDependencies } from "../../routes/groups.ts"
import { Realtime } from "../../services/realtime.ts"
import {
  createGroupDeletedListHandler,
  createGroupDeleteHandler,
  createGroupLeaveHandler,
  createGroupMemberRemoveHandler,
  createGroupMemberRoleHandler,
  createGroupMembersHandler,
  createGroupRenameHandler,
  createGroupRestoreHandler,
} from "./handlers.ts"
import { createGroupSocketRequests } from "./socket.ts"

/**
 * Rename, delete, restore and the member commands over both transports, on one pair of buses as the API wires them:
 * the REST route and the socket parse, and the handlers decide who may act. Nothing here stubs a
 * handler, so a transport that skipped the buses, or a handler that skipped the role check, fails.
 */

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
const VIEWER = 2
const EDITOR = 3
const ADMIN = 4
const OWNER = 5
const STRANGER = 9

function stack() {
  const groups = new MemoryGroupRepository(groupId, {
    [VIEWER]: GroupRole.VIEWER,
    [EDITOR]: GroupRole.EDITOR,
    [ADMIN]: GroupRole.ADMIN,
    [OWNER]: GroupRole.OWNER,
  })
  const commands = new CommandBus()
  commands.use(createSessionGate([]))
  commands.register(GroupRenameCommand, createGroupRenameHandler(groups))
  commands.register(GroupDeleteCommand, createGroupDeleteHandler(groups))
  commands.register(GroupRestoreCommand, createGroupRestoreHandler(groups))
  commands.register(GroupMemberRoleCommand, createGroupMemberRoleHandler(groups))
  commands.register(GroupMemberRemoveCommand, createGroupMemberRemoveHandler(groups))
  commands.register(GroupLeaveCommand, createGroupLeaveHandler(groups))
  const queries = new QueryBus()
  queries.use(createSessionGate([]))
  queries.register(GroupDeletedListQuery, createGroupDeletedListHandler(groups))
  queries.register(GroupMembersQuery, createGroupMembersHandler(groups))
  const unused = () => Promise.reject(new Error("not part of this test"))
  const buses = {
    create: unused,
    list: unused,
    get: unused,
    select: unused,
    selected: unused,
    cursor: { encode: unused, decode: unused },
    rename: (command: GroupRenameCommand) => commands.execute(command),
    delete: (command: GroupDeleteCommand) => commands.execute(command),
    restore: (command: GroupRestoreCommand) => commands.execute(command),
    deleted: (query: GroupDeletedListQuery) => queries.execute(query),
    members: (query: GroupMembersQuery) => queries.execute(query),
    setRole: (command: GroupMemberRoleCommand) => commands.execute(command),
    removeMember: (command: GroupMemberRemoveCommand) => commands.execute(command),
    leave: (command: GroupLeaveCommand) => commands.execute(command),
  } satisfies GroupsRouteDependencies
  return { groups, buses }
}

function rest(buses: GroupsRouteDependencies, userId: number) {
  const app = new Hono<APIContext>()
  app.use("*", async (c, next) => {
    c.set("requestId", "req-groups")
    c.set("auth", buildAuthData({ user: { id: userId }, session: { userId } }))
    await next()
  })
  app.route("/groups", createGroupsRoute(buses))
  return (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(`http://local/groups${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: "sessionIdToken=1:token",
        origin: "http://local",
        "sec-fetch-site": "same-origin",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
}

function socket(buses: GroupsRouteDependencies, userId: number) {
  const auth = buildAuthData({ user: { id: userId }, session: { id: userId * 10, userId } })
  const realtime = new Realtime({
    clock: new FakeClock(),
    entitledSession: () => Promise.resolve(auth),
    memberUserIds: () => Promise.resolve([]),
    requests: createGroupSocketRequests(buses),
    log: () => {},
  })
  const ws = new FakeSocket("wss://app.example.com/api/ws")
  ws.openFromPeer()
  realtime.attach(ws, auth)
  const send = async (
    kind: "client.command" | "client.query",
    name: string,
    payload: unknown,
    id = name,
  ) => {
    // Only a command carries an idempotency key; the socket refuses one on a query.
    const key = kind === "client.command" ? { idempotencyKey: `key-${name}` } : {}
    ws.receive(JSON.stringify({ kind, id, name, payload, ...key }))
    await drainMicrotasks()
    return ws.frames().find((frame) => (frame as { requestId?: string }).requestId === id)
  }
  return {
    command: (name: string, payload: unknown, id?: string) =>
      send("client.command", name, payload, id),
    query: (name: string, payload?: unknown) => send("client.query", name, payload),
    shutdown: () => realtime.shutdown(),
  }
}

/** Who may do what: the user, whether they may rename, and whether they may delete or restore. */
const PEOPLE = [
  { name: "a viewer", user: VIEWER, rename: false, owner: false },
  { name: "an editor", user: EDITOR, rename: false, owner: false },
  { name: "an admin", user: ADMIN, rename: true, owner: false },
  { name: "the owner", user: OWNER, rename: true, owner: true },
]

describe("renaming a group over REST", () => {
  for (const person of PEOPLE) {
    it(`${person.rename ? "lets" : "refuses"} ${person.name} rename it`, async () => {
      const { groups, buses } = stack()

      const response = await rest(buses, person.user)("PATCH", `/${groupId}`, { name: "Trip" })

      if (person.rename) {
        expect(response.status).toBe(200)
        expect((await response.json()).group.name).toBe("Trip")
        expect(groups.name).toBe("Trip")
      } else {
        expect(response.status).toBe(403)
        expect((await response.json()).error.code).toBe("ROLE_INSUFFICIENT")
        expect(groups.writes).toBe(0)
      }
    })
  }

  it("tells a non-member the group does not exist and changes nothing", async () => {
    const { groups, buses } = stack()

    const response = await rest(buses, STRANGER)("PATCH", `/${groupId}`, { name: "Trip" })

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe("GROUP_NOT_FOUND")
    expect(groups.writes).toBe(0)
  })

  it("refuses a name that is empty or carries other fields", async () => {
    const { groups, buses } = stack()
    const send = rest(buses, OWNER)

    for (const body of [{ name: "  " }, { name: "Trip", ownerUserId: 1 }, {}]) {
      const response = await send("PATCH", `/${groupId}`, body)
      expect(response.status).toBe(400)
    }
    expect(groups.writes).toBe(0)
  })
})

describe("deleting a group over REST", () => {
  for (const person of PEOPLE) {
    it(`${person.owner ? "lets" : "refuses"} ${person.name} delete it`, async () => {
      const { groups, buses } = stack()

      const response = await rest(buses, person.user)("DELETE", `/${groupId}`)

      if (person.owner) {
        expect(response.status).toBe(200)
        expect((await response.json()).group.id).toBe(groupId)
        expect(groups.deleted).toBe(true)
      } else {
        expect(response.status).toBe(403)
        expect((await response.json()).error.code).toBe("ROLE_INSUFFICIENT")
        expect(groups.deleted).toBe(false)
        expect(groups.writes).toBe(0)
      }
    })
  }

  it("answers 409 LAST_GROUP when it is the person's only group", async () => {
    const { groups, buses } = stack()
    groups.lastGroup = true

    const response = await rest(buses, OWNER)("DELETE", `/${groupId}`)

    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe("LAST_GROUP")
    expect(groups.deleted).toBe(false)
  })

  it("tells a non-member the group does not exist and deletes nothing", async () => {
    const { groups, buses } = stack()

    const response = await rest(buses, STRANGER)("DELETE", `/${groupId}`)

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe("GROUP_NOT_FOUND")
    expect(groups.deleted).toBe(false)
  })
})

describe("restoring a group over REST", () => {
  for (const person of PEOPLE) {
    it(`${person.owner ? "lets" : "refuses"} ${person.name} restore a deleted group`, async () => {
      const { groups, buses } = stack()
      groups.deleted = true

      const response = await rest(buses, person.user)("POST", `/${groupId}/restore`)

      if (person.owner) {
        expect(response.status).toBe(200)
        expect(groups.deleted).toBe(false)
      } else {
        expect(response.status).toBe(403)
        expect((await response.json()).error.code).toBe("ROLE_INSUFFICIENT")
        expect(groups.deleted).toBe(true)
        expect(groups.writes).toBe(0)
      }
    })
  }

  it("tells a non-member the group does not exist and restores nothing", async () => {
    const { groups, buses } = stack()
    groups.deleted = true

    const response = await rest(buses, STRANGER)("POST", `/${groupId}/restore`)

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe("GROUP_NOT_FOUND")
    expect(groups.deleted).toBe(true)
  })

  it("answers a group that was never deleted as missing", async () => {
    const { buses } = stack()

    const response = await rest(buses, OWNER)("POST", `/${groupId}/restore`)

    expect(response.status).toBe(404)
  })

  it("lists the deleted groups for the owner only", async () => {
    const { groups, buses } = stack()
    groups.deleted = true

    const owner = await (await rest(buses, OWNER)("GET", "/deleted")).json()
    const admin = await (await rest(buses, ADMIN)("GET", "/deleted")).json()
    const stranger = await (await rest(buses, STRANGER)("GET", "/deleted")).json()

    expect(owner.groups.map((group: { id: string }) => group.id)).toEqual([groupId])
    expect(admin.groups).toEqual([])
    expect(stranger.groups).toEqual([])
  })
})

describe("the request id of a group change", () => {
  it("reaches the audit trail for rename, delete and restore over REST", async () => {
    const { groups, buses } = stack()
    const call = rest(buses, OWNER)

    await call("PATCH", `/${groupId}`, { name: "Trip" })
    await call("DELETE", `/${groupId}`)
    await call("POST", `/${groupId}/restore`)

    expect(groups.requestIds).toEqual(["req-groups", "req-groups", "req-groups"])
  })

  it("reaches the audit trail for rename, delete and restore over the socket", async () => {
    const { groups, buses } = stack()
    const ws = socket(buses, OWNER)

    await ws.command("group.rename", { groupId, name: "Trip" }, "frame-rename")
    await ws.command("group.delete", { groupId }, "frame-delete")
    await ws.command("group.restore", { groupId }, "frame-restore")

    expect(groups.requestIds).toEqual(["frame-rename", "frame-delete", "frame-restore"])
    ws.shutdown()
  })

  it("keeps a 128-character socket frame id whole", async () => {
    const { groups, buses } = stack()
    const ws = socket(buses, OWNER)
    const id = "x".repeat(128)

    const frame = await ws.command("group.rename", { groupId, name: "Trip" }, id)

    expect(frame).toMatchObject({ kind: "server.result" })
    expect(groups.requestIds).toEqual([id])
    ws.shutdown()
  })
})

describe("changing a group over the socket", () => {
  for (const person of PEOPLE) {
    it(`${person.rename ? "lets" : "refuses"} ${person.name} rename it`, async () => {
      const { groups, buses } = stack()
      const ws = socket(buses, person.user)

      const frame = await ws.command("group.rename", { groupId, name: "Trip" })

      if (person.rename) {
        expect(frame).toMatchObject({
          kind: "server.result",
          payload: { group: { name: "Trip" } },
        })
        expect(groups.name).toBe("Trip")
      } else {
        expect(frame).toMatchObject({
          kind: "server.error",
          code: "forbidden",
          details: { code: "ROLE_INSUFFICIENT" },
        })
        expect(groups.writes).toBe(0)
      }
      ws.shutdown()
    })

    it(`${person.owner ? "lets" : "refuses"} ${person.name} delete and restore it`, async () => {
      const { groups, buses } = stack()
      const ws = socket(buses, person.user)

      const deleted = await ws.command("group.delete", { groupId })
      groups.deleted = true
      const restored = await ws.command("group.restore", { groupId })

      if (person.owner) {
        expect(deleted).toMatchObject({ kind: "server.result" })
        expect(restored).toMatchObject({ kind: "server.result" })
        // The delete went through; the test then marked it deleted again, and restore undid that.
        expect(groups.writes).toBe(2)
      } else {
        for (const frame of [deleted, restored]) {
          expect(frame).toMatchObject({
            kind: "server.error",
            code: "forbidden",
            details: { code: "ROLE_INSUFFICIENT" },
          })
        }
        expect(groups.writes).toBe(0)
      }
      ws.shutdown()
    })
  }

  it("answers a conflict with the code LAST_GROUP when it is the only group", async () => {
    const { groups, buses } = stack()
    groups.lastGroup = true
    const ws = socket(buses, OWNER)

    const frame = await ws.command("group.delete", { groupId })

    expect(frame).toMatchObject({
      kind: "server.error",
      code: "conflict",
      details: { code: "LAST_GROUP" },
    })
    ws.shutdown()
  })

  it("tells a non-member the group does not exist for rename, delete and restore", async () => {
    const { groups, buses } = stack()
    const ws = socket(buses, STRANGER)

    const live = [
      await ws.command("group.rename", { groupId, name: "Trip" }),
      await ws.command("group.delete", { groupId }),
    ]
    groups.deleted = true
    const gone = await ws.command("group.restore", { groupId })

    for (const frame of [...live, gone]) {
      expect(frame).toMatchObject({
        kind: "server.error",
        code: "not_found",
        details: { code: "GROUP_NOT_FOUND" },
      })
    }
    expect(groups.writes).toBe(0)
    ws.shutdown()
  })

  it("lists the deleted groups for the owner only", async () => {
    const { groups, buses } = stack()
    groups.deleted = true
    const owner = socket(buses, OWNER)
    const admin = socket(buses, ADMIN)

    const ownerFrame = await owner.query("group.deleted")
    const adminFrame = await admin.query("group.deleted")

    expect(ownerFrame).toMatchObject({ payload: { groups: [{ id: groupId }] } })
    expect(adminFrame).toMatchObject({ payload: { groups: [] } })
    owner.shutdown()
    admin.shutdown()
  })
})

describe("a write from another site", () => {
  const crossSite = { origin: "https://evil.example.net", "sec-fetch-site": "cross-site" }

  it("is refused for a role change, a removal and a leave, and changes nothing", async () => {
    const { groups, buses } = stack()
    const owner = rest(buses, OWNER)
    const viewer = rest(buses, VIEWER)

    const responses = [
      await owner("PATCH", `/${groupId}/members/${EDITOR}`, { role: GroupRole.VIEWER }, crossSite),
      await owner("DELETE", `/${groupId}/members/${EDITOR}`, undefined, crossSite),
      await viewer("POST", `/${groupId}/leave`, undefined, crossSite),
    ]

    for (const response of responses) {
      expect(response.status).toBe(403)
      expect((await response.json()).error.code).toBe("REQUEST_ORIGIN_INVALID")
    }
    expect(groups.writes).toBe(0)
  })

  it("is refused for rename, delete and restore, and changes nothing", async () => {
    const { groups, buses } = stack()
    const owner = rest(buses, OWNER)

    const renamed = await owner("PATCH", `/${groupId}`, { name: "Hijacked" }, crossSite)
    const deleted = await owner("DELETE", `/${groupId}`, undefined, crossSite)
    groups.deleted = true
    const restored = await owner("POST", `/${groupId}/restore`, undefined, crossSite)

    for (const response of [renamed, deleted, restored]) {
      expect(response.status).toBe(403)
      expect((await response.json()).error.code).toBe("REQUEST_ORIGIN_INVALID")
    }
    expect(groups.writes).toBe(0)
    expect(groups.name).toBe("Team")
  })
})

/**
 * Who may manage whom: everyone tries to make the editor a viewer and to remove the viewer. Only
 * an admin and the owner manage members, and only those below them.
 */
const MANAGERS = [
  { name: "a viewer", user: VIEWER, manage: false, leave: true },
  { name: "an editor", user: EDITOR, manage: false, leave: true },
  { name: "an admin", user: ADMIN, manage: true, leave: true },
  { name: "the owner", user: OWNER, manage: true, leave: false },
]

describe("the members of a group over REST", () => {
  it("lists them for every member, marking the caller, and hides them from a stranger", async () => {
    const { buses } = stack()

    for (const person of MANAGERS) {
      const response = await rest(buses, person.user)("GET", `/${groupId}/members`)
      expect(response.status).toBe(200)
      const { members } = await response.json()
      expect(members.map((member: { userId: number }) => member.userId)).toEqual([
        VIEWER,
        EDITOR,
        ADMIN,
        OWNER,
      ])
      expect(members.filter((member: { isYou: boolean }) => member.isYou)).toMatchObject([
        { userId: person.user },
      ])
    }
    const stranger = await rest(buses, STRANGER)("GET", `/${groupId}/members`)
    expect(stranger.status).toBe(404)
    expect((await stranger.json()).error.code).toBe("GROUP_NOT_FOUND")
  })

  for (const person of MANAGERS) {
    it(`${person.manage ? "lets" : "refuses"} ${person.name} change a role`, async () => {
      const { groups, buses } = stack()

      const response = await rest(buses, person.user)(
        "PATCH",
        `/${groupId}/members/${EDITOR}`,
        { role: GroupRole.VIEWER },
      )

      if (person.manage) {
        expect(response.status).toBe(200)
        expect((await response.json()).member).toMatchObject({
          userId: EDITOR,
          role: GroupRole.VIEWER,
        })
        expect(groups.writes).toBe(1)
      } else {
        expect(response.status).toBe(403)
        expect((await response.json()).error.code).toBe("ROLE_INSUFFICIENT")
        expect(groups.writes).toBe(0)
      }
    })

    it(`${person.manage ? "lets" : "refuses"} ${person.name} remove a viewer`, async () => {
      const { groups, buses } = stack()

      const response = await rest(buses, person.user)("DELETE", `/${groupId}/members/${VIEWER}`)

      if (person.manage) {
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ removed: true })
        expect(groups.writes).toBe(1)
      } else {
        expect(response.status).toBe(403)
        expect((await response.json()).error.code).toBe("ROLE_INSUFFICIENT")
        expect(groups.writes).toBe(0)
      }
    })

    it(`${person.leave ? "lets" : "refuses"} ${person.name} leave`, async () => {
      const { groups, buses } = stack()

      const response = await rest(buses, person.user)("POST", `/${groupId}/leave`)

      if (person.leave) {
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ left: true })
        expect(groups.writes).toBe(1)
      } else {
        expect(response.status).toBe(409)
        expect((await response.json()).error.code).toBe("LAST_OWNER")
        expect(groups.writes).toBe(0)
      }
    })
  }

  it("keeps the owner's role and membership, and refuses to name a new owner", async () => {
    const { groups, buses } = stack()
    const admin = rest(buses, ADMIN)

    const demoted = await admin("PATCH", `/${groupId}/members/${OWNER}`, { role: GroupRole.VIEWER })
    const removed = await admin("DELETE", `/${groupId}/members/${OWNER}`)
    // The owner role is not one a request can name: ownership moves only by a transfer.
    const promoted = await rest(buses, OWNER)("PATCH", `/${groupId}/members/${EDITOR}`, {
      role: GroupRole.OWNER,
    })

    for (const response of [demoted, removed]) {
      expect(response.status).toBe(409)
      expect((await response.json()).error.code).toBe("LAST_OWNER")
    }
    expect(promoted.status).toBe(400)
    expect(groups.writes).toBe(0)
  })

  it("tells a stranger the group does not exist, and a member the person is not one", async () => {
    const { groups, buses } = stack()

    const stranger = await rest(buses, STRANGER)("DELETE", `/${groupId}/members/${VIEWER}`)
    const missing = await rest(buses, OWNER)("DELETE", `/${groupId}/members/${STRANGER}`)
    const leaving = await rest(buses, STRANGER)("POST", `/${groupId}/leave`)

    expect(stranger.status).toBe(404)
    expect((await stranger.json()).error.code).toBe("GROUP_NOT_FOUND")
    expect(missing.status).toBe(404)
    expect((await missing.json()).error.code).toBe("MEMBER_NOT_FOUND")
    expect(leaving.status).toBe(404)
    expect((await leaving.json()).error.code).toBe("GROUP_NOT_FOUND")
    expect(groups.writes).toBe(0)
  })

  it("answers 409 LAST_GROUP when a member leaves their only group", async () => {
    const { groups, buses } = stack()
    groups.lastGroup = true

    const response = await rest(buses, VIEWER)("POST", `/${groupId}/leave`)

    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe("LAST_GROUP")
  })

  it("refuses a malformed user id or role", async () => {
    const { groups, buses } = stack()
    const owner = rest(buses, OWNER)

    const responses = [
      await owner("PATCH", `/${groupId}/members/0`, { role: GroupRole.VIEWER }),
      await owner("PATCH", `/${groupId}/members/1e3`, { role: GroupRole.VIEWER }),
      await owner("DELETE", `/${groupId}/members/-2`),
      await owner("PATCH", `/${groupId}/members/${EDITOR}`, { role: 9 }),
      await owner("PATCH", `/${groupId}/members/${EDITOR}`, { role: "1" }),
      await owner("PATCH", `/${groupId}/members/${EDITOR}`, { role: 1, userId: VIEWER }),
    ]

    for (const response of responses) expect(response.status).toBe(400)
    expect(groups.writes).toBe(0)
  })

  it("passes the request id of every member change to the audit trail", async () => {
    const { groups, buses } = stack()
    const owner = rest(buses, OWNER)

    await owner("PATCH", `/${groupId}/members/${EDITOR}`, { role: GroupRole.VIEWER })
    await owner("DELETE", `/${groupId}/members/${VIEWER}`)
    await rest(buses, ADMIN)("POST", `/${groupId}/leave`)

    expect(groups.requestIds).toEqual(["req-groups", "req-groups", "req-groups"])
  })
})

describe("the members of a group over the socket", () => {
  for (const person of MANAGERS) {
    it(`${person.manage ? "lets" : "refuses"} ${person.name} change a role and remove`, async () => {
      const { groups, buses } = stack()
      const ws = socket(buses, person.user)

      const changed = await ws.command("group.setRole", {
        groupId,
        userId: EDITOR,
        role: GroupRole.VIEWER,
      })
      const removed = await ws.command("group.removeMember", { groupId, userId: VIEWER })

      if (person.manage) {
        expect(changed).toMatchObject({
          kind: "server.result",
          payload: { member: { userId: EDITOR, role: GroupRole.VIEWER } },
        })
        expect(removed).toMatchObject({ kind: "server.result", payload: { removed: true } })
        expect(groups.writes).toBe(2)
      } else {
        for (const frame of [changed, removed]) {
          expect(frame).toMatchObject({
            kind: "server.error",
            code: "forbidden",
            details: { code: "ROLE_INSUFFICIENT" },
          })
        }
        expect(groups.writes).toBe(0)
      }
      ws.shutdown()
    })

    it(`${person.leave ? "lets" : "refuses"} ${person.name} leave`, async () => {
      const { groups, buses } = stack()
      const ws = socket(buses, person.user)

      const frame = await ws.command("group.leave", { groupId })

      if (person.leave) {
        expect(frame).toMatchObject({ kind: "server.result", payload: { left: true } })
      } else {
        expect(frame).toMatchObject({
          kind: "server.error",
          code: "conflict",
          details: { code: "LAST_OWNER" },
        })
        expect(groups.writes).toBe(0)
      }
      ws.shutdown()
    })
  }

  it("lists the members, and answers a missing member and a stranger as not found", async () => {
    const { groups, buses } = stack()
    const owner = socket(buses, OWNER)
    const stranger = socket(buses, STRANGER)

    const listed = await owner.query("group.members", { groupId })
    const missing = await owner.command("group.removeMember", { groupId, userId: STRANGER })
    const hidden = await stranger.query("group.members", { groupId })

    expect(listed).toMatchObject({ kind: "server.result" })
    expect((listed as { payload: { members: unknown[] } }).payload.members).toHaveLength(4)
    expect(missing).toMatchObject({
      kind: "server.error",
      code: "not_found",
      details: { code: "MEMBER_NOT_FOUND" },
    })
    expect(hidden).toMatchObject({
      kind: "server.error",
      code: "not_found",
      details: { code: "GROUP_NOT_FOUND" },
    })
    expect(groups.writes).toBe(0)
    owner.shutdown()
    stranger.shutdown()
  })

  it("refuses a payload with a missing or extra field", async () => {
    const { groups, buses } = stack()
    const ws = socket(buses, OWNER)

    const frames = [
      await ws.command("group.setRole", { groupId, userId: EDITOR }),
      await ws.command("group.setRole", { groupId, userId: EDITOR, role: 1, name: "x" }),
      await ws.command("group.removeMember", { groupId, userId: "3" }),
      await ws.command("group.removeMember", { groupId, userId: EDITOR, role: 1 }),
      await ws.command("group.leave", { groupId, userId: OWNER }),
    ]

    for (const frame of frames) {
      expect(frame).toMatchObject({ kind: "server.error", code: "bad_request" })
    }
    expect(groups.writes).toBe(0)
    ws.shutdown()
  })
})
