import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { UserMFAStatus } from "@domain/identity"
import { type NoteCreateCommand, NoteError, type NoteListQuery } from "@domain/notes"
import { createNoteSocketRequests } from "./socket.ts"
import { DEFAULT_NOTE_LIST_LIMIT } from "./list.ts"

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
const id = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
const actor = {
  userId: 7,
  userMfa: UserMFAStatus.NOT_CONFIGURED,
  sessionSecondFactor: SecondFactorStatus.NotRequired,
}
const signal = new AbortController().signal

function harness() {
  const seen: { create: NoteCreateCommand | null; list: NoteListQuery | null } = {
    create: null,
    list: null,
  }
  const unused = () => Promise.reject(new Error("not used"))
  const requests = createNoteSocketRequests({
    create(command) {
      seen.create = command
      return unused()
    },
    update: unused,
    delete: unused,
    move: unused,
    get: unused,
    list(query) {
      seen.list = query
      return Promise.resolve({ notes: [], nextPageKey: null })
    },
    cursor: { encode: unused, decode: unused },
  })
  return { requests, seen }
}

describe("note socket requests", () => {
  it("declares the writes as commands and the reads as queries", () => {
    const { requests } = harness()

    expect(Object.fromEntries(Object.entries(requests).map(([name, r]) => [name, r.kind])))
      .toEqual({
        "note.create": "command",
        "note.update": "command",
        "note.delete": "command",
        "note.move": "command",
        "note.list": "query",
        "note.get": "query",
      })
  })

  it("dispatches a create with the socket's actor and idempotency key", async () => {
    const { requests, seen } = harness()

    await requests["note.create"].handle({
      actor,
      requestId: "req-1",
      signal,
      idempotencyKey: "key-1",
      payload: { groupId, id, title: " Plan ", body: "b" },
    }).catch(() => {})

    expect(seen.create?.data).toEqual({
      actor,
      groupId,
      id,
      title: "Plan",
      body: "b",
      idempotencyKey: "key-1",
    })
  })

  it("refuses a create payload that names a user, before anything is dispatched", async () => {
    const { requests, seen } = harness()

    await expect(requests["note.create"].handle({
      actor,
      requestId: "req-1",
      signal,
      idempotencyKey: "key-1",
      payload: { groupId, id, title: "Plan", body: "", userId: 999 },
    })).rejects.toBeInstanceOf(NoteError)
    expect(seen.create).toBe(null)
  })

  it("lists the first page of the default size when the payload names only the group", async () => {
    const { requests, seen } = harness()

    const page = await requests["note.list"].handle({
      actor,
      requestId: "req-2",
      signal,
      payload: { groupId },
    })

    expect(seen.list?.data).toEqual({ actor, groupId, page: { limit: DEFAULT_NOTE_LIST_LIMIT } })
    expect(page).toEqual({ notes: [], nextCursor: null })
  })
})
