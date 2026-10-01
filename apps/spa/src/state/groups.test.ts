import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { RealtimeRequestError } from "@spy4x/realtime"
import { GroupKind, GroupRole } from "@domain/groups"
import { createGroupsStore, type GroupItem, type GroupPage, type ReadChannel } from "./groups.ts"

function item(id: string, sequence: string, name = id): GroupItem {
  return {
    id,
    kind: GroupKind.SHARED,
    name,
    role: GroupRole.OWNER,
    authorizationRevision: "1",
    changeSequence: sequence,
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
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
  },
) {
  const pages = [...(overrides.pages ?? [{ groups: [], nextCursor: null }])]
  const reads: { cursor: string | null; via: ReadChannel }[] = []
  const advanced: [string, number][] = []
  const created: { id: string; kind: GroupKind; name: string }[] = []
  const store = createGroupsStore({
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
      fetchPage: () => Promise.reject(new RealtimeRequestError("unauthorized", "Session ended")),
      create: () => Promise.reject(new Error("unused")),
      advance: () => {},
      newId: () => "x",
    })
    await failing.refreshFromUser()
    expect(failing.error.value).toBe("Session ended")
    expect(failing.loading.value).toBe(false)
  })

  it("creates a shared group with a new id, puts it first and clears the name", async () => {
    const { store, created, advanced } = harness({
      pages: [{ groups: [item("a", "1")], nextCursor: null }],
    })
    await store.refresh()
    store.name.value = "  Trip  "

    await store.create()

    expect(created).toEqual([{ id: "new-id", kind: GroupKind.SHARED, name: "Trip" }])
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

  it("forgets everything on reset", async () => {
    const { store } = harness({ pages: [{ groups: [item("a", "1")], nextCursor: null }] })
    await store.refresh()
    store.name.value = "x"

    store.reset()

    expect(store.groups.value).toEqual([])
    expect(store.name.value).toBe("")
  })
})
