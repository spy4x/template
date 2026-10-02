import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { RealtimeRequestError } from "@spy4x/realtime"
import { createNotesStore, NOTE_MESSAGES, type NoteItem, type NotePage } from "./notes.ts"

const groupId = "g-1"

function item(id: string, version = 1, title = id): NoteItem {
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

function conflict(currentVersion: number) {
  return new RealtimeRequestError("conflict", "The note was changed by someone else", {
    code: "VERSION_CONFLICT",
    currentVersion,
  })
}

function harness(overrides: {
  pages?: NotePage[]
  update?: () => Promise<{ note: NoteItem }>
  delete?: () => Promise<unknown>
  get?: () => Promise<{ note: NoteItem }>
  create?: () => Promise<{ note: NoteItem }>
} = {}) {
  const pages = [...(overrides.pages ?? [])]
  const reads: { groupId: string; cursor: string | null }[] = []
  const calls: { name: string; input: unknown }[] = []
  let ids = 0
  const store = createNotesStore({
    fetchPage(forGroup, cursor) {
      reads.push({ groupId: forGroup, cursor })
      return Promise.resolve(pages.shift() ?? { notes: [], nextCursor: null })
    },
    get(forGroup, id) {
      calls.push({ name: "get", input: { groupId: forGroup, id } })
      return overrides.get?.() ?? Promise.resolve({ note: item(id) })
    },
    create(input) {
      calls.push({ name: "create", input })
      return overrides.create?.() ??
        Promise.resolve({ note: { ...item(input.id), title: input.title } })
    },
    update(input) {
      calls.push({ name: "update", input })
      return overrides.update?.() ??
        Promise.resolve({ note: { ...item(input.id, input.version + 1), title: input.title } })
    },
    delete(input) {
      calls.push({ name: "delete", input })
      return overrides.delete?.() ?? Promise.resolve({})
    },
    newId: () => `new-${++ids}`,
  })
  return { store, reads, calls }
}

describe("notes store", () => {
  it("shows the notes the device holds while the read is still running", async () => {
    let answer: (page: NotePage) => void = () => {}
    const store = createNotesStore({
      fetchPage: () => new Promise<NotePage>((resolve) => (answer = resolve)),
      get: () => Promise.reject(new Error("unused")),
      create: () => Promise.reject(new Error("unused")),
      update: () => Promise.reject(new Error("unused")),
      delete: () => Promise.reject(new Error("unused")),
      newId: () => "id",
      readLocal: () => Promise.resolve([item("cached")]),
    })

    const opening = store.open(groupId, null)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.notes.value.map((note) => note.id)).toEqual(["cached"])
    expect(store.loading.value).toBe(true)

    answer({ notes: [item("fresh")], nextCursor: null })
    await opening
    expect(store.notes.value.map((note) => note.id)).toEqual(["fresh"])
  })

  it("reads every page of the group it opens", async () => {
    const { store, reads } = harness({
      pages: [
        { notes: [item("a")], nextCursor: "c1" },
        { notes: [item("b")], nextCursor: null },
      ],
    })

    await store.open(groupId, null)

    expect(store.notes.value.map((note) => note.id)).toEqual(["a", "b"])
    expect(reads).toEqual([{ groupId, cursor: null }, { groupId, cursor: "c1" }])
  })

  it("creates with the form's id and trimmed title, then starts a new draft with a new id", async () => {
    const { store, calls } = harness()
    await store.open(groupId, null)
    const firstId = store.draftId.value
    store.draft.value = { title: "  Plan  ", body: "b" }

    await store.create()

    expect(calls).toEqual([
      { name: "create", input: { groupId, id: firstId, title: "Plan", body: "b" } },
    ])
    expect(store.notes.value.map((note) => note.title)).toEqual(["Plan"])
    expect(store.draft.value).toEqual({ title: "", body: "" })
    expect(store.draftId.value).not.toBe(firstId)
  })

  it("gives back the note it created, and nothing when the title is missing", async () => {
    const { store } = harness()
    await store.open(groupId, null)
    store.draft.value = { title: "Plan", body: "" }
    const id = store.draftId.value

    expect((await store.create())?.id).toBe(id)

    store.draft.value = { title: " ", body: "" }
    expect(await store.create()).toBe(null)
  })

  it("puts a missing title error on the title and sends nothing", async () => {
    const { store, calls } = harness()
    await store.open(groupId, null)
    store.draft.value = { title: "   ", body: "b" }

    await store.create()

    expect(store.createErrors.value).toEqual({ title: NOTE_MESSAGES.titleRequired, form: null })
    expect(calls).toEqual([])
  })

  it("hands the screen the plan's refusal when the group is at its note cap", async () => {
    const refusal = {
      code: "PLAN_LIMIT_REACHED",
      entitlement: "maxNotes",
      limit: 10,
      canUpgrade: false,
    }
    const { store } = harness({
      create: () =>
        Promise.reject(new RealtimeRequestError("forbidden", "The note limit is reached", refusal)),
    })
    await store.open(groupId, null)
    store.draft.value = { title: "Eleventh", body: "" }

    expect(await store.create()).toBe(null)

    expect(store.createErrors.value).toEqual({
      title: null,
      form: "The note limit is reached",
      plan: refusal,
    })
    expect(store.draft.value.title).toBe("Eleventh")
  })

  it("saves the edit with the version it started from", async () => {
    const { store, calls } = harness({ pages: [{ notes: [item("a", 4)], nextCursor: null }] })
    await store.open(groupId, "a")
    store.editing.value = { ...store.editing.value!, title: "New title" }

    expect(await store.save()).toBe(true)

    expect(calls).toEqual([
      { name: "update", input: { groupId, id: "a", title: "New title", body: "", version: 4 } },
    ])
    expect(store.editing.value).toBe(null)
    expect(store.notes.value[0].version).toBe(5)
  })

  it("keeps the typed text and flags a conflict when the note moved on", async () => {
    const { store } = harness({
      pages: [{ notes: [item("a", 1)], nextCursor: null }],
      update: () => Promise.reject(conflict(2)),
    })
    await store.open(groupId, "a")
    store.editing.value = { ...store.editing.value!, title: "Mine" }

    expect(await store.save()).toBe(false)

    expect(store.editing.value).toMatchObject({ title: "Mine", version: 1, conflict: true })
    expect(store.editErrors.value.form).toBe(NOTE_MESSAGES.conflict)
  })

  it("starts the edit again from the latest version when asked", async () => {
    const { store } = harness({
      pages: [{ notes: [item("a", 1)], nextCursor: null }],
      update: () => Promise.reject(conflict(2)),
      get: () => Promise.resolve({ note: item("a", 2, "Theirs") }),
    })
    await store.open(groupId, "a")
    await store.save()

    await store.reloadLatest()

    expect(store.editing.value).toEqual({
      id: "a",
      title: "Theirs",
      body: "",
      version: 2,
      conflict: false,
      base: { title: "Theirs", body: "" },
    })
    expect(store.editErrors.value).toEqual({ title: null, form: null })
  })

  it("rereads the list when a delete was refused for a stale version", async () => {
    const { store, reads } = harness({
      pages: [
        { notes: [item("a", 1)], nextCursor: null },
        { notes: [item("a", 2, "Changed")], nextCursor: null },
      ],
      delete: () => Promise.reject(conflict(2)),
    })
    await store.open(groupId, null)

    await store.remove(store.notes.value[0])

    expect(store.listError.value).toBe(NOTE_MESSAGES.deleteConflict)
    expect(reads.length).toBe(2)
    expect(store.notes.value.map((note) => note.title)).toEqual(["Changed"])
  })

  it("deletes the open note and says so, so the page can leave it", async () => {
    const { store, calls } = harness({ pages: [{ notes: [item("a", 3)], nextCursor: null }] })
    await store.open(groupId, "a")

    expect(await store.remove(store.notes.value[0])).toBe(true)

    expect(calls).toEqual([{ name: "delete", input: { groupId, id: "a", version: 3 } }])
    expect(store.editing.value).toBe(null)
    expect(store.notes.value).toEqual([])
  })

  it("flags a conflict on the open note when its delete was refused for a stale version", async () => {
    const { store } = harness({
      pages: [{ notes: [item("a", 1)], nextCursor: null }, {
        notes: [item("a", 2)],
        nextCursor: null,
      }],
      delete: () => Promise.reject(conflict(2)),
    })
    await store.open(groupId, "a")

    expect(await store.remove(store.notes.value[0])).toBe(false)

    expect(store.editing.value).toMatchObject({ id: "a", conflict: true })
  })

  it("marks a note that is not in the open group as missing, with no list error", async () => {
    const { store } = harness({
      pages: [{ notes: [item("a")], nextCursor: null }],
      get: () =>
        Promise.reject(
          new RealtimeRequestError("not_found", "Note not found", { code: "NOTE_NOT_FOUND" }),
        ),
    })

    await store.open(groupId, "elsewhere")

    expect(store.missing.value).toBe(true)
    expect(store.editing.value).toBe(null)
    expect(store.listError.value).toBe(null)

    await store.open(groupId, "a")
    expect(store.missing.value).toBe(false)
  })

  it("counts typed text as unsaved until it is saved, created or discarded", async () => {
    const { store } = harness({ pages: [{ notes: [item("a", 4)], nextCursor: null }] })
    await store.open(groupId, null)
    expect(store.unsaved.value).toBe(false)
    store.draft.value = { title: "Half", body: "" }
    expect(store.unsaved.value).toBe(true)
    store.discardDraft()
    expect(store.unsaved.value).toBe(false)

    await store.open(groupId, "a")
    expect(store.unsaved.value).toBe(false)
    store.editing.value = { ...store.editing.value!, title: "Changed" }
    expect(store.unsaved.value).toBe(true)
    store.editing.value = { ...store.editing.value!, title: "a" }
    expect(store.unsaved.value).toBe(false)
    store.editing.value = { ...store.editing.value!, body: "Typed text" }
    expect(store.unsaved.value).toBe(true)
    store.editing.value = { ...store.editing.value!, body: "" }
    store.editing.value = { ...store.editing.value!, title: "Changed" }
    await store.save()
    expect(store.unsaved.value).toBe(false)
  })

  it("keeps the typed text unsaved while the note is flagged as changed by someone else", async () => {
    const { store } = harness({ pages: [{ notes: [item("a", 1)], nextCursor: null }] })
    await store.open(groupId, "a")
    expect(store.unsaved.value).toBe(false)

    store.editing.value = { ...store.editing.value!, conflict: true }

    expect(store.unsaved.value).toBe(true)
  })

  it("does not count another member's change to the open note as the person's own edit", async () => {
    const { store } = harness({
      pages: [{ notes: [item("a", 1)], nextCursor: null }, {
        notes: [item("a", 2, "Theirs")],
        nextCursor: null,
      }],
    })
    await store.open(groupId, "a")

    await store.refresh()

    expect(store.unsaved.value).toBe(false)
  })

  it("forgets the previous group's notes and draft when another group opens", async () => {
    const { store, reads } = harness({ pages: [{ notes: [item("a")], nextCursor: null }] })
    await store.open(groupId, null)
    store.draft.value = { title: "Half typed", body: "" }

    await store.open("g-2", null)

    expect(store.notes.value).toEqual([])
    expect(store.draft.value).toEqual({ title: "", body: "" })
    expect(reads.map((read) => read.groupId)).toEqual([groupId, "g-2"])
  })
})
