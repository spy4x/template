import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { RealtimeRequestError } from "@spy4x/realtime"
import { type GroupDetails, GroupRole } from "@domain/groups"
import {
  createGroupsStore,
  type DeletedGroupItem,
  type GroupItem,
  type GroupPage,
  type ReadChannel,
} from "./groups.ts"

function item(id: string, sequence: string, name = id): GroupItem {
  return {
    id,
    name,
    role: GroupRole.OWNER,
    authorizationRevision: "1",
    changeSequence: sequence,
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

function deleted(id: string, name = id): DeletedGroupItem {
  return { ...item(id, "9", name), deletedAt: "2026-10-01T00:00:00.000Z" }
}

/** What a test of one change does not exercise: no deleted groups, and no other change. */
const UNUSED = {
  fetchDeleted: () => Promise.resolve({ groups: [] }),
  rename: () => Promise.reject(new Error("unused")),
  updateDetails: () => Promise.reject(new Error("unused")),
  remove: () => Promise.reject(new Error("unused")),
  restore: () => Promise.reject(new Error("unused")),
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

function harness(
  overrides: {
    pages?: GroupPage[]
    create?: () => Promise<{ group: GroupItem }>
    read?: () => Promise<GroupPage>
    fetchDeleted?: () => Promise<{ groups: DeletedGroupItem[] }>
    rename?: (input: { groupId: string; name: string }) => Promise<{ group: GroupItem }>
    updateDetails?: (
      input: { groupId: string } & GroupDetails,
    ) => Promise<{ group: GroupItem }>
    remove?: (input: { groupId: string }) => Promise<{ group: DeletedGroupItem }>
    restore?: (input: { groupId: string }) => Promise<{ group: GroupItem }>
  },
) {
  const pages = [...(overrides.pages ?? [{ groups: [], nextCursor: null }])]
  const reads: { cursor: string | null; via: ReadChannel }[] = []
  const advanced: [string, number][] = []
  const created: { id: string; name: string }[] = []
  const store = createGroupsStore({
    ...UNUSED,
    ...(overrides.fetchDeleted && { fetchDeleted: overrides.fetchDeleted }),
    ...(overrides.rename && { rename: overrides.rename }),
    ...(overrides.updateDetails && { updateDetails: overrides.updateDetails }),
    ...(overrides.remove && { remove: overrides.remove }),
    ...(overrides.restore && { restore: overrides.restore }),
    fetchPage(cursor, via) {
      reads.push({ cursor, via })
      if (overrides.read) return overrides.read()
      return Promise.resolve(pages.shift() ?? { groups: [], nextCursor: null })
    },
    create(input) {
      created.push(input)
      return overrides.create?.() ?? Promise.resolve({ group: item(input.id, "1", input.name) })
    },
    advance: (groupId, sequence) => advanced.push([groupId, sequence]),
    newId: () => "new-id",
  })
  return { store, reads, advanced, created }
}

describe("groups store", () => {
  it("keeps the reason a read failed until a read succeeds, apart from the create form's error", async () => {
    let fail = true
    const { store } = harness({
      read: () =>
        fail
          ? Promise.reject(new RealtimeRequestError("timeout", "network down"))
          : Promise.resolve({ groups: [item("a", "1")], nextCursor: null }),
    })

    await store.refresh().catch(() => {})
    expect(store.loadError.value).toBe("network down")
    expect(store.error.value).toBeNull()

    fail = false
    await store.refresh()
    expect(store.loadError.value).toBeNull()
  })

  it("reads every page and moves the cursor of each group to its change sequence", async () => {
    const { store, reads, advanced } = harness({
      pages: [
        { groups: [item("a", "3")], nextCursor: "c1" },
        { groups: [item("b", "7")], nextCursor: null },
      ],
    })

    await store.refresh()

    expect(store.groups.value.map((group) => group.id)).toEqual(["a", "b"])
    expect(reads).toEqual([{ cursor: null, via: "rest" }, { cursor: "c1", via: "rest" }])
    expect(advanced).toEqual([["a", 3], ["b", 7]])
  })

  it("reads once more after a running read, and lets calls made meanwhile share that read", async () => {
    const { store, reads } = harness({})

    await Promise.all([store.refresh(), store.refresh(), store.refresh()])

    expect(reads).toHaveLength(2)
  })

  it("shows a group added while a read was running", async () => {
    const stale = deferred<GroupPage>()
    const served = [
      stale.promise,
      Promise.resolve({ groups: [item("a", "1"), item("new", "1")], nextCursor: null }),
    ]
    const store = createGroupsStore({
      ...UNUSED,
      fetchPage: () => served.shift() ?? Promise.resolve({ groups: [], nextCursor: null }),
      create: () => Promise.reject(new Error("unused")),
      advance: () => {},
      newId: () => "x",
    })

    const first = store.refresh()
    // The change lands after the first read started; its hint asks for another read.
    const hinted = store.refresh()
    stale.resolve({ groups: [item("a", "1")], nextCursor: null })
    await Promise.all([first, hinted])

    expect(store.groups.value.map((group) => group.id)).toEqual(["a", "new"])
  })

  it("replaces the list with the server's answer, dropping a group it no longer lists", async () => {
    const { store } = harness({
      pages: [{ groups: [item("a", "1"), item("b", "1")], nextCursor: null }, {
        groups: [item("a", "2")],
        nextCursor: null,
      }],
    })

    await store.refresh()
    await store.refresh()

    expect(store.groups.value.map((group) => group.id)).toEqual(["a"])
  })

  it("reads over the socket for the refresh button and shows a failure under the form", async () => {
    const { store, reads } = harness({})
    await store.refreshFromUser()
    expect(reads).toEqual([{ cursor: null, via: "socket" }])

    const failing = createGroupsStore({
      ...UNUSED,
      fetchPage: () => Promise.reject(new RealtimeRequestError("unauthorized", "Session ended")),
      create: () => Promise.reject(new Error("unused")),
      advance: () => {},
      newId: () => "x",
    })
    await failing.refreshFromUser()
    expect(failing.error.value).toBe("Session ended")
    expect(failing.loading.value).toBe(false)
  })

  it("creates a group with a new id, puts it first and clears the name", async () => {
    const { store, created, advanced } = harness({
      pages: [{ groups: [item("a", "1")], nextCursor: null }],
    })
    await store.refresh()
    store.name.value = "  Trip  "

    await store.create()

    expect(created).toEqual([{ id: "new-id", name: "Trip" }])
    expect(store.groups.value.map((group) => group.id)).toEqual(["new-id", "a"])
    expect(advanced.at(-1)).toEqual(["new-id", 1])
    expect(store.name.value).toBe("")
    expect(store.creating.value).toBe(false)
  })

  it("keeps the name and shows the server's message when a create is refused", async () => {
    const { store } = harness({
      create: () => Promise.reject(new RealtimeRequestError("conflict", "Group id is in use")),
    })
    store.name.value = "Trip"

    await store.create()

    expect(store.error.value).toBe("Group id is in use")
    expect(store.name.value).toBe("Trip")
    expect(store.groups.value).toEqual([])
  })

  it("ignores a create with an empty name or one already running", async () => {
    const { store, created } = harness({})
    await store.create()
    store.name.value = "Trip"
    const first = store.create()
    await store.create()
    await first

    expect(created).toHaveLength(1)
  })

  it("renames a group to what the person typed and clears the draft", async () => {
    const renamed: { groupId: string; name: string }[] = []
    const { store } = harness({
      pages: [{ groups: [item("a", "1", "Old"), item("b", "1")], nextCursor: null }],
      rename: (input) => {
        renamed.push(input)
        return Promise.resolve({ group: item(input.groupId, "2", input.name) })
      },
    })
    await store.refresh()
    store.renameDraft.value = { groupId: "a", name: "  New  " }

    const done = await store.rename("a")

    expect(done).toBe(true)
    expect(renamed).toEqual([{ groupId: "a", name: "New" }])
    expect(store.groups.value.map((group) => group.name)).toEqual(["New", "b"])
    expect(store.renameDraft.value).toBeNull()
    expect(store.working.value).toBeNull()
  })

  it("keeps the card's members when a rename answers without them", async () => {
    const listed = { ...item("a", "1", "Old"), memberCount: 3, members: [{ name: "Ann" }] }
    const { store } = harness({
      pages: [{ groups: [listed], nextCursor: null }],
      rename: (input) => Promise.resolve({ group: item(input.groupId, "2", input.name) }),
    })
    await store.refresh()
    store.renameDraft.value = { groupId: "a", name: "New" }

    await store.rename("a")

    expect(store.groups.value[0]).toMatchObject({
      name: "New",
      changeSequence: "2",
      memberCount: 3,
      members: [{ name: "Ann" }],
    })
  })

  it("keeps the typed name and shows the server's reason when a rename is refused", async () => {
    const { store } = harness({
      rename: () => Promise.reject(new RealtimeRequestError("forbidden", "Only an admin can")),
    })
    store.renameDraft.value = { groupId: "a", name: "New" }

    const done = await store.rename("a")

    expect(done).toBe(false)
    expect(store.actionError.value).toEqual({
      groupId: "a",
      action: "rename",
      message: "Only an admin can",
    })
    expect(store.renameDraft.value).toEqual({ groupId: "a", name: "New" })
  })

  it("shows a group's new details at once and keeps its other fields", async () => {
    const sent: unknown[] = []
    const { store } = harness({
      pages: [{ groups: [item("a", "1"), item("b", "1")], nextCursor: null }],
      updateDetails: (input) => {
        sent.push(input)
        return Promise.resolve({
          group: { ...item("a", "2"), description: "Flat", color: "green", emoji: "🏠" },
        })
      },
    })
    await store.refresh()

    const done = await store.updateDetails("a", {
      description: "Flat",
      color: "green",
      emoji: "🏠",
    })

    expect(done).toBe(true)
    expect(sent).toEqual([{ groupId: "a", description: "Flat", color: "green", emoji: "🏠" }])
    const [a, b] = store.groups.value
    expect(a).toMatchObject({ id: "a", description: "Flat", color: "green", emoji: "🏠" })
    expect(b.color).toBeUndefined()
  })

  it("shows the server's reason when saving details is refused", async () => {
    const { store } = harness({
      updateDetails: () => Promise.reject(new RealtimeRequestError("forbidden", "Not allowed")),
    })

    const done = await store.updateDetails("a", { description: "", color: null, emoji: null })

    expect(done).toBe(false)
    expect(store.actionError.value).toEqual({
      groupId: "a",
      action: "details",
      message: "Not allowed",
    })
  })

  it("does not send a rename that has no name, or one typed for another group", async () => {
    let sent = 0
    const { store } = harness({
      rename: () => {
        sent++
        return Promise.reject(new Error("unused"))
      },
    })
    store.renameDraft.value = { groupId: "other", name: "New" }

    expect(await store.rename("a")).toBe(false)
    store.renameDraft.value = { groupId: "a", name: "   " }
    expect(await store.rename("a")).toBe(false)

    expect(sent).toBe(0)
  })

  it("moves a deleted group from the list to the deleted groups", async () => {
    const { store } = harness({
      pages: [{ groups: [item("a", "1"), item("b", "1")], nextCursor: null }],
      remove: ({ groupId }) => Promise.resolve({ group: deleted(groupId) }),
    })
    await store.refresh()

    const done = await store.remove("b")

    expect(done).toBe(true)
    expect(store.groups.value.map((group) => group.id)).toEqual(["a"])
    expect(store.deleted.value.map((group) => group.id)).toEqual(["b"])
  })

  it("keeps the group listed and shows the reason when its delete is refused", async () => {
    const { store } = harness({
      pages: [{ groups: [item("a", "1")], nextCursor: null }],
      remove: () =>
        Promise.reject(
          new RealtimeRequestError("conflict", "A person must keep at least one group"),
        ),
    })
    await store.refresh()

    const done = await store.remove("a")

    expect(done).toBe(false)
    expect(store.groups.value.map((group) => group.id)).toEqual(["a"])
    expect(store.deleted.value).toEqual([])
    expect(store.actionError.value?.message).toBe("A person must keep at least one group")
  })

  it("moves a restored group from the deleted groups back to the list", async () => {
    const { store } = harness({
      pages: [{ groups: [item("a", "1")], nextCursor: null }],
      fetchDeleted: () => Promise.resolve({ groups: [deleted("b")] }),
      restore: ({ groupId }) => Promise.resolve({ group: item(groupId, "10") }),
    })
    await store.refresh()
    expect(store.deleted.value.map((group) => group.id)).toEqual(["b"])

    await store.restore("b")

    expect(store.deleted.value).toEqual([])
    expect(store.groups.value.map((group) => group.id)).toEqual(["b", "a"])
  })

  it("reads the deleted groups with every list read, and keeps them when that read fails", async () => {
    let fail = false
    const { store } = harness({
      fetchDeleted: () =>
        fail
          ? Promise.reject(new TypeError("offline"))
          : Promise.resolve({ groups: [deleted("b")] }),
    })

    await store.refresh()
    fail = true
    await store.refresh()

    expect(store.deleted.value.map((group) => group.id)).toEqual(["b"])
    expect(store.loadError.value).toBeNull()
  })

  it("runs one change at a time", async () => {
    const gate = deferred<{ group: DeletedGroupItem }>()
    let sent = 0
    const { store } = harness({
      remove: () => {
        sent++
        return sent === 1 ? gate.promise : Promise.resolve({ group: deleted("a") })
      },
    })

    const first = store.remove("a")
    const second = await store.remove("a")
    gate.resolve({ group: deleted("a") })
    await first

    expect(second).toBe(false)
    expect(sent).toBe(1)
  })

  it("forgets everything on reset", async () => {
    const { store } = harness({ pages: [{ groups: [item("a", "1")], nextCursor: null }] })
    await store.refresh()
    store.name.value = "x"

    store.reset()

    expect(store.groups.value).toEqual([])
    expect(store.name.value).toBe("")
  })
})
