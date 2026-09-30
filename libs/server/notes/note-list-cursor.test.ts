import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { NoteError } from "@domain/notes"
import { GroupListCursorCodec } from "@server/groups/group-list-cursor.ts"
import { NoteListCursorCodec } from "./note-list-cursor.ts"

const secret = "note-list-cursor-test-secret-0123456789"
const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
const otherGroupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111003"
const pageKey = {
  updatedAt: new Date("2026-08-18T10:00:00.000Z"),
  id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001",
}

async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  const error = await promise.then(() => null, (caught) => caught)
  return error instanceof NoteError ? error.code : error === null ? null : String(error)
}

describe("note list cursor", () => {
  it("round-trips a page key for the same user and group", async () => {
    const codec = new NoteListCursorCodec(secret)
    const cursor = await codec.encode(7, groupId, pageKey)

    expect(await codec.decode(cursor, 7, groupId)).toEqual(pageKey)
  })

  it("refuses a cursor handed to another user or another group", async () => {
    const codec = new NoteListCursorCodec(secret)
    const cursor = await codec.encode(7, groupId, pageKey)

    expect(await codeOf(codec.decode(cursor, 8, groupId))).toBe("INVALID_CURSOR")
    expect(await codeOf(codec.decode(cursor, 7, otherGroupId))).toBe("INVALID_CURSOR")
  })

  it("refuses a group list cursor signed with the same key", async () => {
    const groups = new GroupListCursorCodec(secret)
    const groupCursor = await groups.encode(7, pageKey)

    expect(await codeOf(new NoteListCursorCodec(secret).decode(groupCursor, 7, groupId)))
      .toBe("INVALID_CURSOR")
  })

  it("refuses a tampered cursor", async () => {
    const codec = new NoteListCursorCodec(secret)
    const cursor = await codec.encode(7, groupId, pageKey)
    const tampered = cursor.slice(0, -2) + (cursor.endsWith("AA") ? "BB" : "AA")

    expect(await codeOf(codec.decode(tampered, 7, groupId))).toBe("INVALID_CURSOR")
  })
})
