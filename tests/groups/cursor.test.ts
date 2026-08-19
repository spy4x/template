import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { GroupError } from "@domain/groups"
import { GroupListCursorCodec } from "@server/groups/group-list-cursor.ts"

const pageKey = {
  updatedAt: new Date("2026-08-18T10:00:00.000Z"),
  id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001",
}

describe("group list cursor", () => {
  it("round-trips a user-bound keyset", async () => {
    const codec = new GroupListCursorCodec("cursor-secret")
    const cursor = await codec.encode(7, pageKey)

    expect(await codec.decode(cursor, 7)).toEqual(pageKey)
  })

  it("rejects payload or signature tampering", async () => {
    const codec = new GroupListCursorCodec("cursor-secret")
    const cursor = await codec.encode(7, pageKey)
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("a") ? "b" : "a"}`

    await expect(codec.decode(tampered, 7)).rejects.toThrow(GroupError)
  })

  it("rejects cursor reuse by another user", async () => {
    const codec = new GroupListCursorCodec("cursor-secret")
    const cursor = await codec.encode(7, pageKey)

    await expect(codec.decode(cursor, 8)).rejects.toThrow(GroupError)
  })
})
