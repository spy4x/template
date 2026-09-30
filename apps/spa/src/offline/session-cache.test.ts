import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { SessionUser } from "../state/session.ts"
import { forgetUser, recallUser, rememberUser, type SessionStorage } from "./session-cache.ts"

function memory(): SessionStorage {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  }
}

const user = { id: 7, firstName: "Ada", lastName: "L" } as unknown as SessionUser

describe("remembered user", () => {
  it("gives back the user that was remembered", () => {
    const storage = memory()
    rememberUser(user, storage)
    expect(recallUser(storage)).toEqual(user)
  })

  it("gives back nobody after the user was forgotten", () => {
    const storage = memory()
    rememberUser(user, storage)
    forgetUser(storage)
    expect(recallUser(storage)).toBe(null)
  })

  it("ignores a stored value that is not a user", () => {
    const storage = memory()
    storage.setItem("offline:session", "not json")
    expect(recallUser(storage)).toBe(null)
    storage.setItem("offline:session", JSON.stringify({ name: "no id" }))
    expect(recallUser(storage)).toBe(null)
  })

  it("works without storage", () => {
    rememberUser(user, null)
    forgetUser(null)
    expect(recallUser(null)).toBe(null)
  })
})
