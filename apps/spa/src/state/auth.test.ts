import { expect } from "@std/expect"
import { afterEach, describe, it } from "@std/testing/bdd"
import { bootstrapSession } from "./auth.ts"
import { sessionState } from "./session.ts"

const realFetch = globalThis.fetch
const user = { id: 1, firstName: "Test", lastName: "User" }

/** Makes the next `/api/auth/me` answer with `status` and the user (or an error for 401). */
function meAnswers(status: number) {
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify(status === 401 ? { error: "User not signed in" } : user), {
        status,
        headers: { "content-type": "application/json" },
      }),
    )
}

describe("bootstrapSession", () => {
  afterEach(() => {
    globalThis.fetch = realFetch
    sessionState.value = { ...sessionState.value, user: null, isMfaRequired: false, isReady: false }
  })

  it("marks the session as owing its second factor when /me answers 202", async () => {
    meAnswers(202)

    await bootstrapSession()

    expect(sessionState.value.isMfaRequired).toBe(true)
    expect(sessionState.value.user?.id).toBe(1)
    expect(sessionState.value.isReady).toBe(true)
  })

  it("clears the second-factor state when /me answers 200", async () => {
    sessionState.value = { ...sessionState.value, isMfaRequired: true }
    meAnswers(200)

    await bootstrapSession()

    expect(sessionState.value.isMfaRequired).toBe(false)
    expect(sessionState.value.user?.id).toBe(1)
  })

  it("leaves no user and no second-factor state when /me answers 401", async () => {
    meAnswers(401)

    await bootstrapSession()

    expect(sessionState.value.user).toBeNull()
    expect(sessionState.value.isMfaRequired).toBe(false)
    expect(sessionState.value.isReady).toBe(true)
  })
})
