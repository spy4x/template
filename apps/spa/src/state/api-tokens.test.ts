import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { type ApiToken, ApiTokenAccess } from "@domain/api-tokens"
import { type ApiTokensDependencies, createApiTokensStore } from "./api-tokens.ts"

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"

const token: ApiToken = {
  id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111009",
  name: "Zapier",
  groupId,
  groupName: "Personal",
  access: ApiTokenAccess.READ,
  createdAt: "2026-10-04T10:00:00.000Z",
  expiresAt: "2027-01-02T10:00:00.000Z",
  lastUsedAt: null,
}

function store(overrides: Partial<ApiTokensDependencies> = {}, calls: unknown[][] = []) {
  return createApiTokensStore({
    list: () => (calls.push(["list"]), Promise.resolve({ ok: true, data: { tokens: [token] } })),
    create: (request) => (
      calls.push(["create", request]),
        Promise.resolve({ ok: true, data: { token, secret: "tpl_secret" } })
    ),
    revoke: (id) => (calls.push(["revoke", id]), Promise.resolve({ ok: true, data: null })),
    ...overrides,
  })
}

describe("API tokens store", () => {
  it("opens the form empty for the given group, read only, for 90 days", () => {
    const tokens = store()
    tokens.setValue("name", "Old")
    tokens.startCreate(groupId)

    expect(tokens.values.value).toEqual({
      name: "",
      groupId,
      access: ApiTokenAccess.READ,
      expiresInDays: 90,
    })
  })

  it("sends a trimmed request, keeps the secret until it is dismissed and lists the new token", async () => {
    const calls: unknown[][] = []
    const tokens = store({}, calls)
    tokens.startCreate(groupId)
    tokens.setValue("name", " Zapier ")
    tokens.setValue("access", ApiTokenAccess.WRITE)
    tokens.setValue("expiresInDays", null)
    await tokens.create()

    expect(calls).toEqual([[
      "create",
      { name: "Zapier", groupId, access: ApiTokenAccess.WRITE, expiresInDays: null },
    ]])
    expect(tokens.created.value?.secret).toBe("tpl_secret")
    expect(tokens.tokens.value).toEqual([token])

    tokens.dismissSecret()
    expect(tokens.created.value).toBe(null)
  })

  it("keeps a bad name on the page with its message and sends nothing", async () => {
    const calls: unknown[][] = []
    const tokens = store({}, calls)
    tokens.startCreate(groupId)
    tokens.setValue("name", "   ")
    await tokens.create()

    expect(calls).toEqual([])
    expect(tokens.errors.value.name).toContain("Name must be")
  })

  it("shows the API's refusal under the form and keeps no secret", async () => {
    const tokens = store({ create: () => Promise.resolve({ ok: false, error: "Too many tokens" }) })
    tokens.startCreate(groupId)
    tokens.setValue("name", "Zapier")
    await tokens.create()

    expect(tokens.errors.value.form).toBe("Too many tokens")
    expect(tokens.created.value).toBe(null)
    expect(tokens.pending.value.create).toBe(false)
  })

  it("reads the list again after a revoke, and keeps a failed revoke's message", async () => {
    const calls: unknown[][] = []
    const tokens = store({}, calls)
    expect(await tokens.revoke(token.id)).toBe(true)
    expect(calls).toEqual([["revoke", token.id], ["list"]])

    const failing = store({
      revoke: () => Promise.resolve({ ok: false, error: "Token not found" }),
    })
    expect(await failing.revoke(token.id)).toBe(false)
    expect(failing.errors.value.list).toBe("Token not found")
    expect(failing.pending.value.revoke).toBe(false)
  })
})
