import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import { drainMicrotasks, FakeClock, FakeSocket } from "@spy4x/realtime/testing"
import { CommandBus, QueryBus } from "@spy4x/platform/cqrs"
import {
  GroupDeleteCommand,
  GroupDeletedListQuery,
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
  createGroupRenameHandler,
  createGroupRestoreHandler,
} from "./handlers.ts"
import { createGroupSocketRequests } from "./socket.ts"

/**
 * Rename, delete and restore over both transports, on one pair of buses as the API wires them:
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
  const queries = new QueryBus()
  queries.use(createSessionGate([]))
  queries.register(GroupDeletedListQuery, createGroupDeletedListHandler(groups))
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
  return (method: string, path: string, body?: unknown) =>
    app.request(`http://local/groups${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: "sessionIdToken=1:token",
        origin: "http://local",
        "sec-fetch-site": "same-origin",
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
  const send = async (kind: "client.command" | "client.query", name: string, payload: unknown) => {
    // Only a command carries an idempotency key; the socket refuses one on a query.
    const key = kind === "client.command" ? { idempotencyKey: `key-${name}` } : {}
    ws.receive(JSON.stringify({ kind, id: name, name, payload, ...key }))
    await drainMicrotasks()
    return ws.frames().find((frame) => (frame as { requestId?: string }).requestId === name)
  }
  return {
    command: (name: string, payload: unknown) => send("client.command", name, payload),
    query: (name: string) => send("client.query", name, undefined),
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
