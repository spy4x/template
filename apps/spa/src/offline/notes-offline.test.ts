import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { NoteItem, NotePage, NotesDependencies } from "../state/notes.ts"
import type { GroupItem, GroupsDependencies } from "../state/groups.ts"
import { GroupKind, GroupRole } from "@domain/groups"
import type { OfflineLayer } from "./index.ts"
import { createMemoryStore } from "./memory-store.ts"
import { createOutbox, createPromiseLock } from "./outbox.ts"
import { offlineNotes } from "./notes-offline.ts"
import { offlineGroups } from "./groups-offline.ts"

const groupId = "g-1"

function note(id: string, version = 1, title = id): NoteItem {
  return {
    id,
    groupId,
    title,
    body: "",
    version,
    changeSequence: "1",
    createdByUserId: 1,
    updatedByUserId: 1,
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
  }
}

function layerWith(online: { socket: boolean }): OfflineLayer {
  const store = createMemoryStore()
  const outbox = createOutbox({
    store,
    userId: 1,
    lock: createPromiseLock(),
    isOnline: () => online.socket,
    newKey: () => crypto.randomUUID(),
    now: () => "2026-10-03T00:00:00.000Z",
    send: (_name, payload) => Promise.resolve({ note: note(String(payload.id), 1, "sent") }),
    fetchNote: () => Promise.resolve(null),
  })
  return { userId: 1, store, outbox }
}

/** Server-side dependencies whose network the test switches off and on. */
function network(pages: NoteItem[][]) {
  const state = { up: true, reads: 0 }
  const online: NotesDependencies = {
    fetchPage(_group, cursor): Promise<NotePage> {
      state.reads++
      if (!state.up) return Promise.reject(new TypeError("Failed to fetch"))
      const index = Number(cursor ?? 0)
      return Promise.resolve({
        notes: pages[index],
        nextCursor: index + 1 < pages.length ? String(index + 1) : null,
      })
    },
    get: (_group, id) => Promise.resolve({ note: note(id) }),
    create: () => Promise.reject(new Error("the store must not call the network to write")),
    update: () => Promise.reject(new Error("the store must not call the network to write")),
    delete: () => Promise.reject(new Error("the store must not call the network to write")),
    newId: () => "id",
  }
  return { state, online }
}

describe("offline notes reads", () => {
  it("answers from the device when the network is down", async () => {
    const layer = layerWith({ socket: false })
    const { state, online } = network([[note("a"), note("b")]])
    const deps = offlineNotes(online, () => layer)
    await deps.fetchPage(groupId, null)
    state.up = false
    const page = await deps.fetchPage(groupId, null)
    expect(page.notes.map((n) => n.id)).toEqual(["a", "b"])
  })

  it("keeps every page of a group, not only the first", async () => {
    const layer = layerWith({ socket: false })
    const { state, online } = network([[note("a")], [note("b")]])
    const deps = offlineNotes(online, () => layer)
    await deps.fetchPage(groupId, null)
    state.up = false
    expect((await deps.fetchPage(groupId, null)).notes.map((n) => n.id)).toEqual(["a", "b"])
  })

  it("shows a note created offline in the list read", async () => {
    const layer = layerWith({ socket: false })
    const { state, online } = network([[note("a")]])
    const deps = offlineNotes(online, () => layer)
    await deps.fetchPage(groupId, null)
    state.up = false
    await deps.create({ groupId, id: "mine", title: "Offline note", body: "" })
    const page = await deps.fetchPage(groupId, null)
    expect(page.notes.map((n) => n.title)).toEqual(["Offline note", "a"])
  })

  it("does not hide a server error behind the cached list", async () => {
    const layer = layerWith({ socket: true })
    const { online } = network([[note("a")]])
    online.fetchPage = () => Promise.reject(new Error("Request failed"))
    await expect(offlineNotes(online, () => layer).fetchPage(groupId, null)).rejects.toThrow(
      "Request failed",
    )
  })

  it("goes straight to the server when no layer is running", async () => {
    const { online } = network([[note("a")]])
    const page = await offlineNotes(online, () => null).fetchPage(groupId, null)
    expect(page.notes.map((n) => n.id)).toEqual(["a"])
  })

  it("lists what the device holds without asking the network", async () => {
    const layer = layerWith({ socket: false })
    await layer.store.replaceNotes(groupId, [note("cached")])
    const { state, online } = network([[]])
    const local = await offlineNotes(online, () => layer).readLocal!(groupId)
    expect(local.map((n) => n.id)).toEqual(["cached"])
    expect(state.reads).toBe(0)
  })
})

describe("offline notes writes", () => {
  it("returns the server's note when the socket is open", async () => {
    const layer = layerWith({ socket: true })
    const { online } = network([[]])
    const { note: created } = await offlineNotes(online, () => layer).create({
      groupId,
      id: "n",
      title: "T",
      body: "",
    })
    expect(created.title).toBe("sent")
  })

  it("returns the local note and queues the write when the socket is closed", async () => {
    const layer = layerWith({ socket: false })
    const { online } = network([[]])
    const { note: created } = await offlineNotes(online, () => layer).create({
      groupId,
      id: "n",
      title: "T",
      body: "",
    })
    expect(created.title).toBe("T")
    expect(layer.outbox.entries.value.length).toBe(1)
  })
})

describe("offline groups", () => {
  const group: GroupItem = {
    id: "g-1",
    kind: GroupKind.SHARED,
    name: "Team",
    role: GroupRole.OWNER,
    authorizationRevision: "1",
    changeSequence: "1",
    updatedAt: "2026-10-02T00:00:00.000Z",
  }

  it("answers the groups list from the device when the network is down", async () => {
    const layer = layerWith({ socket: false })
    let up = true
    const online: GroupsDependencies = {
      fetchPage: () =>
        up
          ? Promise.resolve({ groups: [group], nextCursor: null })
          : Promise.reject(new TypeError()),
      create: () => Promise.reject(new Error("not used")),
      advance: () => {},
      newId: () => "id",
    }
    const deps = offlineGroups(online, () => layer)
    await deps.fetchPage(null, "rest")
    up = false
    expect((await deps.fetchPage(null, "rest")).groups).toEqual([group])
  })
})
