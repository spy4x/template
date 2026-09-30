import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import { drainMicrotasks, FakeClock, FakeSocket } from "@spy4x/realtime/testing"
import { CommandBus, QueryBus } from "@spy4x/platform/cqrs"
import { GroupRole } from "@domain/groups"
import {
  NoteCreateCommand,
  NoteDeleteCommand,
  NoteGetQuery,
  NoteListQuery,
  NoteUpdateCommand,
} from "@domain/notes"
import { createSessionGate } from "../../cqrs/session-gate.ts"
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
  createNoteUpdateHandler,
} from "./handlers.ts"
import { createNoteSocketRequests } from "./socket.ts"

/**
 * Both transports over one pair of buses, as the API wires them: the REST route and the socket
 * parse, and the handlers on the buses decide who may do what. Nothing here stubs the handlers,
 * so a transport that skipped the buses, or a handler that skipped the check, fails these tests.
 */

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
const noteId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
const OWNER = 1
const VIEWER = 2

function stack() {
  const notes = new MemoryNoteRepository()
  const dependencies = {
    notes,
    groups: roles({
      [`${groupId}:${OWNER}`]: GroupRole.OWNER,
      [`${groupId}:${VIEWER}`]: GroupRole.VIEWER,
    }),
  }
  const commands = new CommandBus()
  commands.use(createSessionGate([]))
  commands.register(NoteCreateCommand, createNoteCreateHandler(dependencies))
  commands.register(NoteUpdateCommand, createNoteUpdateHandler(dependencies))
  commands.register(NoteDeleteCommand, createNoteDeleteHandler(dependencies))
  const queries = new QueryBus()
  queries.use(createSessionGate([]))
  queries.register(NoteListQuery, createNoteListHandler(dependencies))
  queries.register(NoteGetQuery, createNoteGetHandler(dependencies))
  const buses = {
    create: (command: NoteCreateCommand) => commands.execute(command),
    update: (command: NoteUpdateCommand) => commands.execute(command),
    delete: (command: NoteDeleteCommand) => commands.execute(command),
    list: (query: NoteListQuery) => queries.execute(query),
    get: (query: NoteGetQuery) => queries.execute(query),
    cursor: {
      encode: () => Promise.resolve("next"),
      decode: () => Promise.resolve({ updatedAt: new Date(0), id: noteId }),
    },
  }
  return { notes, buses }
}

async function seedNote(notes: MemoryNoteRepository) {
  await notes.create({ groupId, id: noteId, title: "Plan", body: "" }, OWNER)
  await notes.update(
    { groupId, id: noteId, title: "Plan v2", body: "", expectedVersion: 1 },
    OWNER,
  )
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
  return { command, shutdown: () => realtime.shutdown() }
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
})
