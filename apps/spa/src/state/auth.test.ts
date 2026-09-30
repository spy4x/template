import { expect } from "@std/expect"
import { afterEach, describe, it } from "@std/testing/bdd"
import { type User, UserMFAStatus } from "@domain/identity"
import { bootstrapSession, signOut, totpConnectFinish, totpDisconnect } from "./auth.ts"
import { sessionState } from "./session.ts"

const realFetch = globalThis.fetch
const user = { id: 1, firstName: "Test", lastName: "User" }

/** What the API sends for `status`: no profile while the second factor is pending. */
function body(status: number) {
  if (status === 401) return { error: "User not signed in" }
  return status === 202 ? { secondFactor: "Pending" } : user
}

/** Makes the next `/api/auth/me` answer with `status` and the user (or an error for 401). */
function meAnswers(status: number) {
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify(body(status)), {
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
    expect(sessionState.value.user).toBeNull()
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

  it("opens as the remembered user when the server cannot be reached", async () => {
    globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"))

    await bootstrapSession(() => ({ id: 5 } as User))

    expect(sessionState.value.user?.id).toBe(5)
    expect(sessionState.value.isReady).toBe(true)
  })

  it("signs the person out when the server cannot be reached and nobody is remembered", async () => {
    globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"))

    await bootstrapSession(() => null)

    expect(sessionState.value.user).toBeNull()
    expect(sessionState.value.isReady).toBe(true)
  })

  it("ignores the remembered user when the server answers 401", async () => {
    meAnswers(401)

    await bootstrapSession(() => ({ id: 5 } as User))

    expect(sessionState.value.user).toBeNull()
  })
})

describe("signOut", () => {
  afterEach(() => {
    globalThis.fetch = realFetch
    sessionState.value = { ...sessionState.value, user: null }
  })

  it("signs the page out even when the server cannot be reached", async () => {
    sessionState.value = { ...sessionState.value, user: { id: 1 } as User }
    globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"))

    await signOut()

    expect(sessionState.value.user).toBeNull()
  })
})

/** Makes every request answer 200 with `{ success: true }`. */
function apiSucceeds() {
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
}

describe("two-factor enrolment", () => {
  afterEach(() => {
    globalThis.fetch = realFetch
    sessionState.value = { ...sessionState.value, user: null }
  })

  it("marks the user's authenticator app as connected after the first code", async () => {
    sessionState.value = {
      ...sessionState.value,
      user: { ...user, mfa: UserMFAStatus.CONFIGURATION_NOT_FINISHED } as unknown as User,
    }
    apiSucceeds()

    expect(await totpConnectFinish("123456")).toEqual({ ok: true })

    expect(sessionState.value.user?.mfa).toBe(UserMFAStatus.CONFIGURED)
  })

  it("marks the user's authenticator app as removed after disabling", async () => {
    sessionState.value = {
      ...sessionState.value,
      user: { ...user, mfa: UserMFAStatus.CONFIGURED } as unknown as User,
    }
    apiSucceeds()

    expect(await totpDisconnect()).toEqual({ ok: true })

    expect(sessionState.value.user?.mfa).toBe(UserMFAStatus.NOT_CONFIGURED)
  })
})
