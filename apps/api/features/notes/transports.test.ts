import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import { drainMicrotasks, FakeClock, FakeSocket } from "@spy4x/realtime/testing"
import { CommandBus, QueryBus } from "@spy4x/platform/cqrs"
import { FREE_PLAN_ID, PRO_PLAN_ID } from "@domain/billing"
import { GroupRole } from "@domain/groups"
import {
  NoteCreateCommand,
  NoteDeleteCommand,
  NoteGetQuery,
  NoteListQuery,
  NoteLocateQuery,
  NoteMoveCommand,
  NoteUpdateCommand,
} from "@domain/notes"
import { createSessionGate } from "../../cqrs/session-gate.ts"
import { createEntitlementGate } from "../../cqrs/entitlement-gate.ts"
import { ENTITLEMENT_NEEDS } from "../../cqrs/entitlement-needs.ts"
import { buildAuthData } from "../../_testing/fake-auth.ts"
import { MemoryNoteRepository, roles } from "../../_testing/memory-notes.ts"
import type { APIContext } from "../../_types.ts"
import { createNotesRoute } from "../../routes/notes.ts"
import { Realtime } from "../../services/realtime.ts"
import {
  createNoteCreateHandler,
  createNoteDeleteHandler,
  createNoteGetHandler,
  createNoteListHandler,
  createNoteLocateHandler,
  createNoteMoveHandler,
  createNoteUpdateHandler,
} from "./handlers.ts"
import { createNoteSocketRequests } from "./socket.ts"

/**
 * Both transports over one pair of buses, as the API wires them: the REST route and the socket
 * parse, and the gates and handlers on the buses decide who may do what. Nothing here stubs the
 * handlers, so a transport that skipped the buses, or a handler that skipped the check, fails these
 * tests. The group is on `plan` (the free plan unless a test says otherwise), with billing on.
 */

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
const noteId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
/** Where OWNER may write, may only read, and is no member at all. */
const editableGroupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111003"
const readOnlyGroupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111004"
const strangerGroupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111005"
const OWNER = 1
const VIEWER = 2

function stack(plan = FREE_PLAN_ID, plans: Record<string, string> = {}) {
  const groups = roles({
    [`${groupId}:${OWNER}`]: GroupRole.OWNER,
    [`${groupId}:${VIEWER}`]: GroupRole.VIEWER,
    [`${editableGroupId}:${OWNER}`]: GroupRole.EDITOR,
    [`${editableGroupId}:${VIEWER}`]: GroupRole.EDITOR,
    [`${readOnlyGroupId}:${OWNER}`]: GroupRole.VIEWER,
  })
  const notes = new MemoryNoteRepository(groups)
  const dependencies = { notes, groups }
  const commands = new CommandBus()
  commands.use(createSessionGate([]))
  commands.use(createEntitlementGate({
    billingEnabled: true,
    planOf: (group) => Promise.resolve(plans[group] ?? plan),
    roleOf: (group, user) => dependencies.groups.roleOf(group, user),
    usage: {
      maxNotes: (group) =>
        Promise.resolve([...notes.notes.values()].filter((note) => note.groupId === group).length),
      maxMembers: () => Promise.reject(new Error("not part of this test")),
    },
  }, ENTITLEMENT_NEEDS))
  commands.register(NoteCreateCommand, createNoteCreateHandler(dependencies))
  commands.register(NoteUpdateCommand, createNoteUpdateHandler(dependencies))
  commands.register(NoteDeleteCommand, createNoteDeleteHandler(dependencies))
  commands.register(NoteMoveCommand, createNoteMoveHandler(dependencies))
  const queries = new QueryBus()
  queries.use(createSessionGate([]))
  queries.register(NoteListQuery, createNoteListHandler(dependencies))
  queries.register(NoteGetQuery, createNoteGetHandler(dependencies))
  queries.register(NoteLocateQuery, createNoteLocateHandler(dependencies))
  const buses = {
    create: (command: NoteCreateCommand) => commands.execute(command),
    update: (command: NoteUpdateCommand) => commands.execute(command),
    delete: (command: NoteDeleteCommand) => commands.execute(command),
    move: (command: NoteMoveCommand) => commands.execute(command),
    list: (query: NoteListQuery) => queries.execute(query),
    get: (query: NoteGetQuery) => queries.execute(query),
    locate: (query: NoteLocateQuery) => queries.execute(query),
    cursor: {
      encode: () => Promise.resolve("next"),
      decode: () => Promise.resolve({ updatedAt: new Date(0), id: noteId }),
    },
  }
  return { notes, buses }
}

async function seedNote(notes: MemoryNoteRepository) {
  await notes.create({ groupId, id: noteId, title: "Plan", body: "" }, OWNER, null)
  await notes.update(
    { groupId, id: noteId, title: "Plan v2", body: "", expectedVersion: 1 },
    OWNER,
  )
  notes.writes = 0
}

/** Fills the group up to the free plan's cap of 10 notes. */
async function fillFreePlan(notes: MemoryNoteRepository) {
  for (let i = 0; i < 10; i++) {
    await notes.create({ groupId, id: crypto.randomUUID(), title: `Note ${i}`, body: "" }, 1, null)
  }
  notes.writes = 0
}

function rest(buses: ReturnType<typeof stack>["buses"], userId: number) {
  const app = new Hono<APIContext>()
  app.use("*", async (c, next) => {
    c.set("requestId", "req-notes")
    c.set("auth", buildAuthData({ user: { id: userId }, session: { userId } }))
    await next()
  })
  app.route("/groups/:groupId/notes", createNotesRoute(buses))
  return (method: string, path: string, body: unknown) =>
    app.request(`http://local/groups/${groupId}/notes${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: "sessionIdToken=1:token",
        origin: "http://local",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify(body),
    })
}

function socket(buses: ReturnType<typeof stack>["buses"], userId: number) {
  const auth = buildAuthData({ user: { id: userId }, session: { id: userId * 10, userId } })
  const realtime = new Realtime({
    clock: new FakeClock(),
    entitledSession: () => Promise.resolve(auth),
    memberUserIds: () => Promise.resolve([]),
    requests: createNoteSocketRequests(buses),
    log: () => {},
  })
  const ws = new FakeSocket("wss://app.example.com/api/ws")
  ws.openFromPeer()
  realtime.attach(ws, auth)
  const command = async (name: string, payload: unknown) => {
    ws.receive(JSON.stringify({
      kind: "client.command",
      id: name,
      name,
      payload,
      idempotencyKey: `key-${name}`,
    }))
    await drainMicrotasks()
    return ws.frames().find((frame) => (frame as { requestId?: string }).requestId === name)
  }
  const query = async (name: string, payload: unknown) => {
    ws.receive(JSON.stringify({ kind: "client.query", id: name, name, payload }))
    await drainMicrotasks()
    return ws.frames().find((frame) => (frame as { requestId?: string }).requestId === name)
  }
  return { command, query, shutdown: () => realtime.shutdown() }
}

describe("notes over both transports", () => {
  it("refuses every write of a viewer over REST and changes nothing", async () => {
    const { notes, buses } = stack()
    await seedNote(notes)
    const send = rest(buses, VIEWER)

    const responses = [
      await send("POST", "", { id: crypto.randomUUID(), title: "Mine", body: "" }),
      await send("PATCH", `/${noteId}`, { title: "Changed", body: "", version: 2 }),
      await send("DELETE", `/${noteId}`, { version: 2 }),
    ]

    for (const response of responses) {
      expect(response.status).toBe(403)
      expect((await response.json()).error.code).toBe("ROLE_INSUFFICIENT")
    }
    expect(notes.writes).toBe(0)
  })

  it("lets a viewer read over REST", async () => {
    const { notes, buses } = stack()
    await seedNote(notes)

    const response = await rest(buses, VIEWER)("GET", `/${noteId}`, undefined)

    expect(response.status).toBe(200)
    expect((await response.json()).note.title).toBe("Plan v2")
  })

  it("refuses every write of a viewer over the socket and changes nothing", async () => {
    const { notes, buses } = stack()
    await seedNote(notes)
    const ws = socket(buses, VIEWER)

    const frames = [
      await ws.command("note.create", {
        groupId,
        id: crypto.randomUUID(),
        title: "Mine",
        body: "",
      }),
      await ws.command("note.update", { groupId, id: noteId, title: "x", body: "", version: 2 }),
      await ws.command("note.delete", { groupId, id: noteId, version: 2 }),
    ]

    for (const frame of frames) {
      expect(frame).toMatchObject({
        kind: "server.error",
        code: "forbidden",
        details: { code: "ROLE_INSUFFICIENT" },
      })
    }
    expect(notes.writes).toBe(0)
    ws.shutdown()
  })

  it("answers a stale update with 409 and the current version over REST", async () => {
    const { notes, buses } = stack()
    await seedNote(notes)

    const response = await rest(buses, OWNER)("PATCH", `/${noteId}`, {
      title: "From version 1",
      body: "",
      version: 1,
    })

    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatchObject({
      code: "VERSION_CONFLICT",
      currentVersion: 2,
    })
    expect(notes.notes.get(noteId)?.title).toBe("Plan v2")
  })

  it("answers a stale delete with a conflict and the current version over the socket", async () => {
    const { notes, buses } = stack()
    await seedNote(notes)
    const ws = socket(buses, OWNER)

    const frame = await ws.command("note.delete", { groupId, id: noteId, version: 1 })

    expect(frame).toMatchObject({
      kind: "server.error",
      code: "conflict",
      details: { code: "VERSION_CONFLICT", currentVersion: 2 },
    })
    expect(notes.notes.has(noteId)).toBe(true)
    ws.shutdown()
  })

  it("lets an owner create, update and delete over the socket", async () => {
    const { notes, buses } = stack()
    const ws = socket(buses, OWNER)

    const created = await ws.command("note.create", { groupId, id: noteId, title: "A", body: "" })
    const updated = await ws.command("note.update", {
      groupId,
      id: noteId,
      title: "B",
      body: "b",
      version: 1,
    })
    const deleted = await ws.command("note.delete", { groupId, id: noteId, version: 2 })

    expect(created).toMatchObject({ kind: "server.result", payload: { created: true } })
    expect(updated).toMatchObject({ kind: "server.result", payload: { note: { version: 2 } } })
    expect(deleted).toMatchObject({ kind: "server.result", payload: { note: { version: 3 } } })
    expect(notes.writes).toBe(3)
    ws.shutdown()
  })

  it("refuses a note over the free plan's cap with 402 over REST, and tells the owner to upgrade", async () => {
    const { notes, buses } = stack()
    await fillFreePlan(notes)

    const response = await rest(buses, OWNER)("POST", "", {
      id: crypto.randomUUID(),
      title: "Eleventh",
      body: "",
    })

    expect(response.status).toBe(402)
    expect((await response.json()).error).toMatchObject({
      code: "PLAN_LIMIT_REACHED",
      entitlement: "maxNotes",
      limit: 10,
      canUpgrade: true,
    })
    expect(notes.writes).toBe(0)
  })

  it("refuses a note over the free plan's cap over the socket, naming the cap in the details", async () => {
    const { notes, buses } = stack()
    await fillFreePlan(notes)
    const ws = socket(buses, OWNER)

    const frame = await ws.command("note.create", {
      groupId,
      id: crypto.randomUUID(),
      title: "Eleventh",
      body: "",
    })

    expect(frame).toMatchObject({
      kind: "server.error",
      code: "forbidden",
      details: { code: "PLAN_LIMIT_REACHED", entitlement: "maxNotes", limit: 10 },
    })
    expect(notes.writes).toBe(0)
    ws.shutdown()
  })

  it("lets a group on Pro add notes past the free plan's cap", async () => {
    const { notes, buses } = stack(PRO_PLAN_ID)
    await fillFreePlan(notes)

    const response = await rest(buses, OWNER)("POST", "", {
      id: crypto.randomUUID(),
      title: "Eleventh",
      body: "",
    })

    expect(response.status).toBe(201)
    expect(notes.writes).toBe(1)
  })

  it("lets a group over its cap read, edit and delete what it has", async () => {
    const { notes, buses } = stack()
    await fillFreePlan(notes)
    await seedNote(notes)
    const send = rest(buses, OWNER)

    const read = await send("GET", `/${noteId}`, undefined)
    const edited = await send("PATCH", `/${noteId}`, { title: "Kept", body: "", version: 2 })
    const deleted = await send("DELETE", `/${noteId}`, { version: 3 })

    expect([read.status, edited.status, deleted.status]).toEqual([200, 200, 200])
  })

  describe("moving notes to another group", () => {
    const second = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111006"

    async function seedTwo(notes: MemoryNoteRepository) {
      await seedNote(notes)
      await notes.create({ groupId, id: second, title: "Other", body: "" }, OWNER, null)
      notes.writes = 0
    }

    function groupsOf(notes: MemoryNoteRepository) {
      return [...notes.notes.values()].map((note) => [note.id, note.groupId])
    }

    it("moves the notes over REST, keeping their ids and raising their versions", async () => {
      const { notes, buses } = stack()
      await seedTwo(notes)

      const response = await rest(buses, OWNER)("POST", "/move", {
        toGroupId: editableGroupId,
        noteIds: [noteId, second],
      })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.notes.map((note: { id: string }) => note.id)).toEqual([noteId, second])
      expect(body.notes[0]).toMatchObject({ groupId: editableGroupId, version: 3 })
      expect(groupsOf(notes)).toEqual([[noteId, editableGroupId], [second, editableGroupId]])
    })

    it("moves the notes over the socket", async () => {
      const { notes, buses } = stack()
      await seedTwo(notes)
      const ws = socket(buses, OWNER)

      const frame = await ws.command("note.move", {
        groupId,
        toGroupId: editableGroupId,
        noteIds: [noteId],
      })

      expect(frame).toMatchObject({ kind: "server.result", payload: { notes: [{ id: noteId }] } })
      expect(groupsOf(notes)).toEqual([[noteId, editableGroupId], [second, groupId]])
      ws.shutdown()
    })

    it("refuses a viewer of the source group and moves nothing", async () => {
      const { notes, buses } = stack()
      await seedTwo(notes)

      const response = await rest(buses, VIEWER)("POST", "/move", {
        toGroupId: editableGroupId,
        noteIds: [noteId],
      })

      expect(response.status).toBe(403)
      expect((await response.json()).error.code).toBe("ROLE_INSUFFICIENT")
      expect(notes.writes).toBe(0)
    })

    it("refuses a move to a group where the person only reads or is no member", async () => {
      const { notes, buses } = stack()
      await seedTwo(notes)
      const send = rest(buses, OWNER)

      const viewerTarget = await send("POST", "/move", {
        toGroupId: readOnlyGroupId,
        noteIds: [noteId],
      })
      const strangerTarget = await send("POST", "/move", {
        toGroupId: strangerGroupId,
        noteIds: [noteId],
      })

      expect(viewerTarget.status).toBe(403)
      expect((await viewerTarget.json()).error.code).toBe("ROLE_INSUFFICIENT")
      expect(strangerTarget.status).toBe(404)
      expect(notes.writes).toBe(0)
    })

    it("refuses a move into the same group, and an empty or repeating list", async () => {
      const { notes, buses } = stack()
      await seedTwo(notes)
      const send = rest(buses, OWNER)

      const same = await send("POST", "/move", { toGroupId: groupId, noteIds: [noteId] })
      const empty = await send("POST", "/move", { toGroupId: editableGroupId, noteIds: [] })
      const twice = await send("POST", "/move", {
        toGroupId: editableGroupId,
        noteIds: [noteId, noteId],
      })

      expect((await same.json()).error.code).toBe("SAME_GROUP")
      expect([same.status, empty.status, twice.status]).toEqual([400, 400, 400])
      expect(notes.writes).toBe(0)
    })

    it("refuses a move into the same group over the socket", async () => {
      const { notes, buses } = stack()
      await seedTwo(notes)
      const ws = socket(buses, OWNER)

      const frame = await ws.command("note.move", {
        groupId,
        toGroupId: groupId,
        noteIds: [noteId],
      })

      expect(frame).toMatchObject({
        kind: "server.error",
        code: "bad_request",
        details: { code: "SAME_GROUP" },
      })
      expect(notes.writes).toBe(0)
      ws.shutdown()
    })

    it("moves none when one of the notes is not in the source group", async () => {
      const { notes, buses } = stack()
      await seedTwo(notes)

      const response = await rest(buses, OWNER)("POST", "/move", {
        toGroupId: editableGroupId,
        noteIds: [noteId, crypto.randomUUID()],
      })

      expect(response.status).toBe(404)
      expect(groupsOf(notes)).toEqual([[noteId, groupId], [second, groupId]])
    })

    it("lets a move into a group on Pro past the free source group's cap", async () => {
      const { notes, buses } = stack(FREE_PLAN_ID, { [editableGroupId]: PRO_PLAN_ID })
      await fillFreePlan(notes)

      const response = await rest(buses, OWNER)("POST", "/move", {
        toGroupId: editableGroupId,
        noteIds: [(await notes.list(groupId, { limit: 1 })).notes[0].id],
      })

      expect(response.status).toBe(200)
    })

    it("refuses a move into a full free group when the source group is on Pro", async () => {
      const { notes, buses } = stack(FREE_PLAN_ID, { [groupId]: PRO_PLAN_ID })
      await seedTwo(notes)
      for (let i = 0; i < 10; i++) {
        await notes.create(
          { groupId: editableGroupId, id: crypto.randomUUID(), title: `T${i}`, body: "" },
          OWNER,
          null,
        )
      }
      notes.writes = 0

      const response = await rest(buses, OWNER)("POST", "/move", {
        toGroupId: editableGroupId,
        noteIds: [noteId],
      })

      expect(response.status).toBe(402)
      expect(notes.writes).toBe(0)
    })

    it("tells a viewer of the source group they cannot write there, even when the target is full", async () => {
      const { notes, buses } = stack()
      await seedTwo(notes)
      for (let i = 0; i < 10; i++) {
        await notes.create(
          { groupId: editableGroupId, id: crypto.randomUUID(), title: `T${i}`, body: "" },
          OWNER,
          null,
        )
      }
      notes.writes = 0

      const response = await rest(buses, VIEWER)("POST", "/move", {
        toGroupId: editableGroupId,
        noteIds: [noteId],
      })

      expect(response.status).toBe(403)
      expect((await response.json()).error.code).toBe("ROLE_INSUFFICIENT")
      expect(notes.writes).toBe(0)
    })

    it("refuses a move that would take the target group over the free plan's cap", async () => {
      const { notes, buses } = stack()
      await seedTwo(notes)
      for (let i = 0; i < 9; i++) {
        await notes.create(
          { groupId: editableGroupId, id: crypto.randomUUID(), title: `T${i}`, body: "" },
          OWNER,
          null,
        )
      }
      notes.writes = 0

      const response = await rest(buses, OWNER)("POST", "/move", {
        toGroupId: editableGroupId,
        noteIds: [noteId, second],
      })

      expect(response.status).toBe(402)
      expect((await response.json()).error.code).toBe("PLAN_LIMIT_REACHED")
      expect(notes.writes).toBe(0)
    })
  })

  describe("finding the group of a note by its id", () => {
    it("tells a member the group of a note in any of their groups", async () => {
      const { notes, buses } = stack()
      await seedNote(notes)
      const ws = socket(buses, VIEWER)

      const frame = await ws.query("note.locate", { id: noteId })

      expect(frame).toMatchObject({ kind: "server.result", payload: { groupId } })
      ws.shutdown()
    })

    it("answers a note in a group the person is not in exactly as a note that does not exist", async () => {
      const { notes, buses } = stack()
      await seedNote(notes)
      // OWNER is in `groupId` only through the roles above; this note is in a group nobody is in.
      const foreignId = crypto.randomUUID()
      await notes.create(
        { groupId: strangerGroupId, id: foreignId, title: "Secret", body: "" },
        OWNER,
        null,
      )
      const ws = socket(buses, OWNER)

      const foreign = await ws.query("note.locate", { id: foreignId })
      const missing = await ws.query("note.locate", { id: crypto.randomUUID() })

      expect(foreign).toMatchObject({
        kind: "server.error",
        code: "not_found",
        details: { code: "NOTE_NOT_FOUND" },
      })
      // Same frame but for the request id, which is the call's name in both.
      expect(JSON.stringify(foreign)).toBe(JSON.stringify(missing))
      expect(JSON.stringify(foreign)).not.toContain(strangerGroupId)
      ws.shutdown()
    })

    it("answers a note that was deleted as not found", async () => {
      const { notes, buses } = stack()
      await seedNote(notes)
      await notes.delete({ groupId, id: noteId, expectedVersion: 2 }, OWNER)
      const ws = socket(buses, OWNER)

      const frame = await ws.query("note.locate", { id: noteId })

      expect(frame).toMatchObject({ kind: "server.error", details: { code: "NOTE_NOT_FOUND" } })
      ws.shutdown()
    })
  })
})
