import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { entryFromV1 } from "./local-store.ts"

const v1 = {
  seq: 3,
  key: "k",
  groupId: "g-1",
  noteId: "n-1",
  kind: "update",
  title: "T",
  body: "B",
  baseVersion: 2,
  attempted: true,
  status: "pending",
  queuedAt: "2026-10-03T00:00:00.000Z",
}

describe("upgrading a queued write", () => {
  it("moves a queued write of the first database version into the outbox's shape", () => {
    expect(entryFromV1(v1)).toEqual({
      seq: 3,
      key: "k",
      entityId: "n-1",
      kind: "update",
      payload: { groupId: "g-1", title: "T", body: "B" },
      baseVersion: 2,
      attempted: true,
      status: "pending",
      queuedAt: "2026-10-03T00:00:00.000Z",
    })
  })

  it("leaves a queued write that is already in the outbox's shape as it is", () => {
    const upgraded = entryFromV1(v1)
    expect(entryFromV1(upgraded)).toBe(upgraded)
  })
})
