import { expect } from "@std/expect"
import { afterEach, describe, it } from "@std/testing/bdd"
import {
  configureModules,
  forgetModules,
  forgetUser,
  localReads,
  recallUser,
  rememberUser,
  startModules,
  stopChanges,
} from "../modules.ts"
import type { NoteItem } from "../state/notes.ts"
import { sessionState, type SessionUser } from "../state/session.ts"
import { currentLayer, startOffline, stopOffline } from "./index.ts"
import { createMemoryStorage } from "./memory-storage.ts"
import type { NoteEntry } from "./notes-cache.ts"
import { notesCollection } from "./notes-collection.ts"

const realFetch = globalThis.fetch
const globals = globalThis as { document?: unknown; localStorage?: Storage }
const signedOut = sessionState.value
const user = (id: number) => ({ id }) as SessionUser

function note(id: string, version = 1, title = id): NoteItem {
  return {
    id,
    groupId: "g-1",
    title,
    body: "",
    version,
    changeSequence: "1",
    createdByUserId: 7,
    updatedByUserId: 7,
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
  }
}

/**
 * A write as the app queued it before the notes moved to the collections layer, field for field
 * as it lies in `offline:user:<id>:outbox` on a device (the store adds `seq`).
 */
const QUEUED_BY_AN_EARLIER_VERSION: NoteEntry = {
  key: "key-from-last-week",
  entityId: "n-1",
  kind: "update",
  payload: { groupId: "g-1", title: "Written offline", body: "last week" },
  baseVersion: 3,
  attempted: true,
  status: "pending",
  queuedAt: "2026-10-01T08:00:00.000Z",
}

interface Call {
  url: string
  key: string | null
  body: unknown
}

/** A server that takes every call and records it. */
function server(): Call[] {
  const calls: Call[] = []
  globalThis.fetch = ((url: string, init: RequestInit) => {
    calls.push({
      url,
      key: new Headers(init.headers).get("Idempotency-Key"),
      body: JSON.parse(String(init.body)),
    })
    return Promise.resolve(Response.json({ result: { note: note("n-1", 4, "Written offline") } }))
  }) as unknown as typeof fetch
  return calls
}

/** Lets every queued step run: the queue's read, the runner's start and its flush. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setTimeout(resolve, 0))
}

const reads = { pull: () => {}, check: () => Promise.resolve() }

/** The page as the sync runners read it: a visible tab. */
function visiblePage(): void {
  globals.document = {
    visibilityState: "visible",
    addEventListener: () => {},
    removeEventListener: () => {},
  }
}

/** A page with no socket, signed in as `id`, on a device that holds `storage`. */
function startPage(id: number, storage: ReturnType<typeof createMemoryStorage>): void {
  visiblePage()
  configureModules({ realtime: false, offline: true })
  sessionState.value = { ...signedOut, user: user(id) }
  startModules(id, reads, { storage })
}

afterEach(async () => {
  stopChanges()
  await stopOffline()
  configureModules({})
  sessionState.value = signedOut
  globalThis.fetch = realFetch
  delete globals.document
})

describe("a queue an earlier version of the app left on the device", () => {
  it("is looked for in the database the queue has always had", () => {
    const definition = notesCollection({ userId: 7, cache: createMemoryStorage().of(7).notes })

    expect(definition.database).toBe("offline:user:7:outbox")
  })

  it("is sent as the note command it was, with the key it was queued under", async () => {
    const storage = createMemoryStorage()
    await storage.of(7).queue.putEntry(QUEUED_BY_AN_EARLIER_VERSION)
    const calls = server()

    startPage(7, storage)
    await settle()

    expect(calls).toEqual([{
      url: "/api/call/note.update",
      key: "key-from-last-week",
      body: { groupId: "g-1", id: "n-1", title: "Written offline", body: "last week", version: 3 },
    }])
    expect(await storage.of(7).queue.readOutbox()).toEqual([])
    expect((await storage.of(7).notes.readNotes("g-1")).map((n) => n.version)).toEqual([4])
  })

  it("shows a conflict it held, with the server's side, for the person to choose", async () => {
    const storage = createMemoryStorage()
    await storage.of(7).queue.putEntry({
      ...QUEUED_BY_AN_EARLIER_VERSION,
      status: "conflict",
      conflict: {
        reason: "version",
        message: "Someone changed this note while you were offline.",
        server: note("n-1", 5, "Theirs"),
      },
    })
    const calls = server()

    startPage(7, storage)
    await settle()

    const [entry] = currentLayer()!.entries.value
    expect([entry.status, entry.conflict?.server?.title]).toEqual(["conflict", "Theirs"])
    expect(calls).toEqual([])
  })
})

describe("the queue of a started page", () => {
  it("is not sent while the cookie belongs to someone else", async () => {
    const storage = createMemoryStorage()
    await storage.of(7).queue.putEntry(QUEUED_BY_AN_EARLIER_VERSION)
    const calls = server()

    startPage(7, storage)
    // The session changed under the page before the queue was read.
    sessionState.value = { ...signedOut, user: user(8) }
    await settle()

    expect(calls).toEqual([])
    expect((await storage.of(7).queue.readOutbox()).map((entry) => entry.key)).toEqual([
      "key-from-last-week",
    ])
  })

  it("is not sent by a layer that was stopped while the queue was being read", async () => {
    const storage = createMemoryStorage()
    await storage.of(7).queue.putEntry(QUEUED_BY_AN_EARLIER_VERSION)
    const sent: string[] = []
    const transport = {
      calls: {
        command: (name: string) => Promise.resolve(void sent.push(name)),
        query: () => Promise.resolve(),
      },
      canSend: () => true,
    }

    visiblePage()
    startOffline(7, transport, storage)
    await stopOffline()
    await settle()
    const stopped = [...sent]
    startOffline(7, transport, storage)
    await settle()

    expect([stopped, sent]).toEqual([[], ["note.update"]])
  })
})

describe("what the device keeps", () => {
  /** A device that holds a read copy, a note and a queued write of user 7. */
  async function deviceInUse() {
    const storage = createMemoryStorage()
    const device = storage.of(7)
    device.reads.set("groups", { value: [{ id: "g-1" }], savedAt: 1 })
    await device.notes.putNote(note("n-9"))
    await device.queue.putEntry({ ...QUEUED_BY_AN_EARLIER_VERSION, status: "conflict" })
    return { storage, device }
  }

  it("keeps a list read through the running layer, and answers from it when unreachable", async () => {
    const storage = createMemoryStorage()
    server()
    startPage(7, storage)
    await localReads.through("members:g-1", () => Promise.resolve(["Ann"]))

    const answer = await localReads.through(
      "members:g-1",
      () => Promise.reject(new TypeError("Failed to fetch")),
    )

    expect([answer.value, answer.fresh]).toEqual([["Ann"], false])
    expect([...storage.of(7).reads.keys()]).toEqual(["members:g-1"])
  })

  it("keeps nothing while the local-data module is off", async () => {
    const storage = createMemoryStorage()
    startPage(7, storage)
    stopChanges()
    await stopOffline()
    configureModules({ realtime: false, offline: false })
    startModules(7, reads, { storage })

    await localReads.through("members:g-1", () => Promise.resolve(["Ann"]))

    expect(currentLayer()).toBeNull()
    expect([...storage.of(7).reads.keys()]).toEqual([])
  })

  it("deletes the read copies and the notes on sign-out, and keeps the queued writes", async () => {
    const { storage, device } = await deviceInUse()
    server()
    startPage(7, storage)
    await settle()

    forgetModules()
    await settle()

    expect([...device.reads.keys()]).toEqual([])
    expect(await device.notes.readNotes("g-1")).toEqual([])
    expect((await device.queue.readOutbox()).map((entry) => entry.entityId)).toEqual(["n-1"])
  })

  it("saves no answer that arrives after the sign-out", async () => {
    const { storage, device } = await deviceInUse()
    server()
    startPage(7, storage)
    let answer!: (members: string[]) => void
    const reading = localReads.through(
      "members:g-1",
      () => new Promise<string[]>((resolve) => answer = resolve),
    )

    forgetModules()
    await settle()
    answer(["Ann"])
    await reading

    expect([...device.reads.keys()]).toEqual([])
  })

  it("deletes the remembered user's copies at a start that finds no session, and keeps their queue", async () => {
    const { storage, device } = await deviceInUse()
    const kept = new Map<string, string>()
    globals.localStorage = {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    } as Storage
    try {
      configureModules({ realtime: false, offline: true })
      rememberUser(user(7))

      // No layer runs: the page found no session and shows the sign-in page.
      await forgetUser(storage)

      expect(recallUser()).toBeNull()
      expect([...device.reads.keys()]).toEqual([])
      expect(await device.notes.readNotes("g-1")).toEqual([])
      expect((await device.queue.readOutbox()).map((entry) => entry.entityId)).toEqual(["n-1"])
    } finally {
      delete globals.localStorage
    }
  })
})
