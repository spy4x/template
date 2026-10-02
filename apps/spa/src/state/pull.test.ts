import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { signal } from "@preact/signals"
import { userChangeGroupId } from "@domain/identity"
import { createPull } from "./pull.ts"

const USER = 7

/**
 * A pull over fakes. `groupsAfterRead` is the list the server answers when the groups are read;
 * `calls` records every read in order, so a read of a group that is gone shows up.
 */
function harness(options: { open: string | null; groupsAfterRead: string[] }) {
  const calls: string[] = []
  const groups = signal<readonly { id: string }[]>([{ id: "home" }, { id: "team" }])
  const pull = createPull({
    userId: USER,
    flushOutbox: () => Promise.resolve(void calls.push("flush")),
    profile: { refresh: () => Promise.resolve(void calls.push("profile")) },
    selection: { refresh: () => Promise.resolve(void calls.push("selection")) },
    groups: {
      groups,
      refresh: () => {
        calls.push("groups")
        groups.value = options.groupsAfterRead.map((id) => ({ id }))
        return Promise.resolve()
      },
    },
    notes: {
      groupId: signal(options.open),
      refresh: () => Promise.resolve(void calls.push("notes")),
    },
  })
  return { pull, calls }
}

describe("the pull after a hint", () => {
  it("never reads the notes of the open group once that group is deleted", async () => {
    const { pull, calls } = harness({ open: "team", groupsAfterRead: ["home"] })

    await pull({ groupId: "team" })

    expect(calls).toContain("groups")
    expect(calls).not.toContain("notes")
  })

  it("reads the notes of the open group after the groups, while the group is still there", async () => {
    const { pull, calls } = harness({ open: "team", groupsAfterRead: ["home", "team"] })

    await pull({ groupId: "team" })

    expect(calls).toEqual(["flush", "selection", "groups", "notes"])
  })

  it("leaves the notes alone for another group's hint, and reads them with no hint at all", async () => {
    const other = harness({ open: "team", groupsAfterRead: ["home", "team"] })
    await other.pull({ groupId: "home" })
    expect(other.calls).not.toContain("notes")

    const all = harness({ open: "team", groupsAfterRead: ["home", "team"] })
    await all.pull()
    expect(all.calls).toContain("notes")
  })

  it("reads no notes when none is open", async () => {
    const { pull, calls } = harness({ open: null, groupsAfterRead: ["home"] })

    await pull()

    expect(calls).toEqual(["flush", "selection", "groups"])
  })

  it("answers this person's own hint with the profile and the selection only", async () => {
    const { pull, calls } = harness({ open: "team", groupsAfterRead: ["home", "team"] })

    await pull({ groupId: userChangeGroupId(USER) })

    expect([...calls].sort()).toEqual(["profile", "selection"])
  })
})
