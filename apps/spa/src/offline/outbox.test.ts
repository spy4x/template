import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { ConnectionLostError, RealtimeRequestError } from "@spy4x/realtime"
import type { NoteItem } from "../state/notes.ts"
import { createMemoryStore } from "./memory-store.ts"
import { createOutbox } from "./outbox.ts"

const groupId = "g-1"

function note(id: string, version = 1, title = id, body = ""): NoteItem {
  return {
    id,
    groupId,
    title,
    body,
    version,
    changeSequence: "1",
    createdByUserId: 1,
    updatedByUserId: 1,
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
  }
}

function refused(code: string) {
  return new RealtimeRequestError("conflict", "refused", { code })
}

interface Sent {
  name: string
  payload: Record<string, unknown>
  key: string
}

/** An outbox over a memory store whose server is a function the test replaces. */
function harness() {
  const store = createMemoryStore()
  const sent: Sent[] = []
  const state = {
    /** Throws to simulate the server; returns the answer otherwise. */
    server: (_sent: Sent): unknown => ({ note: note("n-1", 2) }),
    current: null as NoteItem | null,
    online: true,
  }
  let keys = 0
  const outbox = createOutbox({
    store,
    userId: 1,
    isOnline: () => state.online,
    newKey: () => `key-${++keys}`,
    now: () => "2026-10-03T00:00:00.000Z",
    send(name, payload, key) {
      const call = { name, payload, key }
      sent.push(call)
      try {
        return Promise.resolve(state.server(call))
      } catch (error) {
        return Promise.reject(error)
      }
    },
    fetchNote: () => Promise.resolve(state.current),
  })
  const offline = () => {
    state.online = false
    state.server = () => {
      throw new ConnectionLostError("the socket is not open")
    }
  }
  return { store, outbox, sent, state, offline }
}

describe("outbox while the socket is down", () => {
  it("keeps a note created offline and shows it in the list", async () => {
    const { outbox, offline } = harness()
    offline()
    const outcome = await outbox.submit({
      kind: "create",
      groupId,
      noteId: "n-new",
      title: "Written offline",
      body: "text",
    })
    expect(outcome.kind).toBe("queued")
    const shown = await outbox.overlay(groupId, [note("n-1")])
    expect(shown.map((n) => n.title)).toEqual(["Written offline", "n-1"])
  })

  it("keeps a queued write across a restart of the layer", async () => {
    const { store, outbox, offline } = harness()
    offline()
    await outbox.submit({ kind: "create", groupId, noteId: "n-new", title: "T", body: "" })
    const again = createOutbox({
      store,
      userId: 1,
      isOnline: () => true,
      newKey: () => "other",
      now: () => "",
      send: () => Promise.resolve({ note: note("n-new") }),
      fetchNote: () => Promise.resolve(null),
    })
    expect((await again.reload()).map((e) => e.noteId)).toEqual(["n-new"])
  })

  it("sends the queue in order with the original keys once the socket is back", async () => {
    const { outbox, sent, state, offline } = harness()
    offline()
    await outbox.submit({ kind: "create", groupId, noteId: "a", title: "A", body: "" })
    await outbox.submit({ kind: "create", groupId, noteId: "b", title: "B", body: "" })
    state.online = true
    state.server = ({ payload }) => ({ note: note(String(payload.id)) })
    await outbox.flush()
    expect(sent.map((s) => [s.name, s.payload.id, s.key])).toEqual([
      ["note.create", "a", "key-1"],
      ["note.create", "b", "key-2"],
    ])
    expect(outbox.entries.value).toEqual([])
  })

  it("stops at the first write that cannot reach the server and keeps the rest", async () => {
    const { outbox, sent, state, offline } = harness()
    offline()
    await outbox.submit({ kind: "create", groupId, noteId: "a", title: "A", body: "" })
    await outbox.submit({ kind: "create", groupId, noteId: "b", title: "B", body: "" })
    sent.length = 0
    state.online = true
    await outbox.flush()
    expect(sent.length).toBe(1)
    expect(outbox.entries.value.length).toBe(2)
  })
})

describe("outbox merging edits of one note", () => {
  it("sends a note created and edited offline as one create with the last text", async () => {
    const { outbox, sent, state, offline } = harness()
    offline()
    await outbox.submit({ kind: "create", groupId, noteId: "n", title: "First", body: "" })
    await outbox.submit({
      kind: "update",
      groupId,
      noteId: "n",
      title: "Second",
      body: "b",
      version: 0,
    })
    state.online = true
    state.server = () => ({ note: note("n", 1, "Second") })
    await outbox.flush()
    expect(sent.map((s) => [s.name, s.payload.title])).toEqual([["note.create", "Second"]])
  })

  it("sends nothing for a note created and deleted before any send", async () => {
    const { outbox, sent, offline } = harness()
    offline()
    await outbox.submit({ kind: "create", groupId, noteId: "n", title: "T", body: "" })
    const outcome = await outbox.submit({
      kind: "delete",
      groupId,
      noteId: "n",
      title: "T",
      body: "",
      version: 0,
    })
    expect(outcome.kind).toBe("dropped")
    expect(outbox.entries.value).toEqual([])
    expect(sent.filter((s) => s.name !== "note.create").length).toBe(0)
  })

  it("sends a second edit of a note as one update on the first edit's base version", async () => {
    const { outbox, sent, state, offline } = harness()
    offline()
    await outbox.submit({ kind: "update", groupId, noteId: "n", title: "A", body: "", version: 3 })
    await outbox.submit({ kind: "update", groupId, noteId: "n", title: "B", body: "", version: 3 })
    state.online = true
    state.server = () => ({ note: note("n", 4, "B") })
    await outbox.flush()
    expect(sent.map((s) => [s.payload.title, s.payload.version])).toEqual([["B", 3]])
  })

  it("keeps the key of an edit that was never sent", async () => {
    const { outbox, offline } = harness()
    offline()
    await outbox.submit({ kind: "update", groupId, noteId: "n", title: "A", body: "", version: 3 })
    await outbox.submit({ kind: "update", groupId, noteId: "n", title: "B", body: "", version: 3 })
    expect(outbox.entries.value.map((e) => [e.key, e.title])).toEqual([["key-1", "B"]])
  })

  it("uses a new key for an edit made after a send whose outcome is unknown", async () => {
    const { outbox, sent, state } = harness()
    state.server = () => {
      throw new ConnectionLostError("closed after the send")
    }
    await outbox.submit({ kind: "update", groupId, noteId: "n", title: "A", body: "", version: 3 })
    await outbox.submit({ kind: "update", groupId, noteId: "n", title: "B", body: "", version: 3 })
    expect(sent.map((s) => s.key)).toEqual(["key-1", "key-2"])
  })

  it("deletes version 1 for a note created and deleted after a send with unknown outcome", async () => {
    const { outbox, sent, state } = harness()
    state.server = () => {
      throw new ConnectionLostError("closed after the send")
    }
    await outbox.submit({ kind: "create", groupId, noteId: "n", title: "T", body: "" })
    state.server = () => ({})
    const outcome = await outbox.submit({
      kind: "delete",
      groupId,
      noteId: "n",
      title: "T",
      body: "",
      version: 0,
    })
    expect(outcome.kind).toBe("sent")
    expect(sent[sent.length - 1]).toMatchObject({ name: "note.delete", payload: { version: 1 } })
  })
})

describe("outbox when the server answers", () => {
  it("answers a change made online with the server's note and leaves nothing queued", async () => {
    const { outbox, state } = harness()
    state.server = () => ({ note: note("n", 2, "Saved") })
    const outcome = await outbox.submit({
      kind: "update",
      groupId,
      noteId: "n",
      title: "Saved",
      body: "",
      version: 1,
    })
    expect(outcome).toEqual({ kind: "sent", note: note("n", 2, "Saved") })
    expect(outbox.entries.value).toEqual([])
  })

  it("hands a refusal to the person who just made the change and queues nothing", async () => {
    const { outbox, state } = harness()
    state.server = () => {
      throw refused("VERSION_CONFLICT")
    }
    const outcome = await outbox.submit({
      kind: "update",
      groupId,
      noteId: "n",
      title: "Mine",
      body: "",
      version: 1,
    })
    expect(outcome.kind).toBe("failed")
    expect(outbox.entries.value).toEqual([])
  })
})

describe("outbox conflicts found after a reconnect", () => {
  async function staleUpdate() {
    const h = harness()
    h.offline()
    await h.outbox.submit({
      kind: "update",
      groupId,
      noteId: "n",
      title: "Mine",
      body: "my body",
      version: 1,
    })
    h.state.server = () => {
      throw refused("VERSION_CONFLICT")
    }
    h.state.current = note("n", 2, "Theirs")
    h.state.online = true
    await h.outbox.flush()
    return h
  }

  it("keeps an edit the server refused as a visible conflict with both versions", async () => {
    const { outbox } = await staleUpdate()
    const [entry] = outbox.entries.value
    expect(entry.status).toBe("conflict")
    expect(entry.conflict?.reason).toBe("version")
    expect(entry.conflict?.server?.title).toBe("Theirs")
    expect(entry.title).toBe("Mine")
  })

  it("does not send a conflicted write again on its own", async () => {
    const { outbox, sent } = await staleUpdate()
    sent.length = 0
    await outbox.flush()
    expect(sent).toEqual([])
  })

  it("sends my version on top of the server's when I keep mine", async () => {
    const { outbox, sent, state } = await staleUpdate()
    state.server = () => ({ note: note("n", 3, "Mine") })
    sent.length = 0
    await outbox.keepMine(outbox.entries.value[0].seq!)
    expect(sent.map((s) => [s.name, s.payload.title, s.payload.version])).toEqual([
      ["note.update", "Mine", 2],
    ])
    expect(outbox.entries.value).toEqual([])
  })

  it("shows the server's note and drops mine when I use the server's", async () => {
    const { outbox, store } = await staleUpdate()
    await outbox.useTheirs(outbox.entries.value[0].seq!)
    expect(outbox.entries.value).toEqual([])
    expect((await store.readNotes(groupId)).map((n) => n.title)).toEqual(["Theirs"])
  })

  it("keeps an edit of a note deleted on the server as a conflict with no server note", async () => {
    const h = harness()
    h.offline()
    await h.outbox.submit({
      kind: "update",
      groupId,
      noteId: "n",
      title: "Mine",
      body: "",
      version: 1,
    })
    h.state.server = () => {
      throw refused("NOTE_NOT_FOUND")
    }
    h.state.current = null
    h.state.online = true
    await h.outbox.flush()
    expect(h.outbox.entries.value[0].conflict?.reason).toBe("gone")
    expect(h.outbox.entries.value[0].conflict?.server).toBe(null)
  })

  it("treats a delete of a note already gone as done", async () => {
    const h = harness()
    h.offline()
    await h.outbox.submit({
      kind: "delete",
      groupId,
      noteId: "n",
      title: "T",
      body: "",
      version: 1,
    })
    h.state.server = () => {
      throw refused("NOTE_NOT_FOUND")
    }
    h.state.online = true
    await h.outbox.flush()
    expect(h.outbox.entries.value).toEqual([])
  })

  it("keeps a write the server refuses for another reason, with the server's message", async () => {
    const h = harness()
    h.offline()
    await h.outbox.submit({ kind: "create", groupId, noteId: "n", title: "T", body: "" })
    h.state.server = () => {
      throw refused("ROLE_INSUFFICIENT")
    }
    h.state.online = true
    await h.outbox.flush()
    const [entry] = h.outbox.entries.value
    expect(entry.status).toBe("conflict")
    expect(entry.conflict).toMatchObject({ reason: "rejected", message: "refused" })
  })
})
