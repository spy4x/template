import { expect } from "@std/expect"
import { afterEach, describe, it } from "@std/testing/bdd"
import type { User } from "@domain/identity"
import { isRealtimeOpen, sessionGate } from "./realtime.ts"
import { sessionState } from "./session.ts"

const realFetch = globalThis.fetch

function meAnswers(status: number, body: unknown) {
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    )
}

afterEach(() => {
  globalThis.fetch = realFetch
  sessionState.value = { ...sessionState.value, user: null, isMfaRequired: false, wsStatus: "idle" }
})

describe("sessionGate", () => {
  it("lets the socket reconnect while the cookie still belongs to the page's user", async () => {
    meAnswers(200, { id: 1 })
    expect((await sessionGate(1)()).allowed).toBe(true)
  })

  it("refuses the reconnect and signs the page out when the cookie now belongs to another user", async () => {
    sessionState.value = { ...sessionState.value, user: { id: 1 } as User }
    meAnswers(200, { id: 2 })
    expect((await sessionGate(1)()).allowed).toBe(false)
    expect(sessionState.value.user).toBeNull()
  })

  it("lets the socket try again when the server cannot be reached", async () => {
    globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"))
    expect((await sessionGate(1)()).allowed).toBe(true)
  })
})

describe("isRealtimeOpen", () => {
  it("is true only for the user the page is signed in as, with the socket open", () => {
    sessionState.value = { ...sessionState.value, user: { id: 1 } as User, wsStatus: "open" }
    expect([isRealtimeOpen(1), isRealtimeOpen(2)]).toEqual([true, false])
  })

  it("is false while the socket is not open", () => {
    sessionState.value = { ...sessionState.value, user: { id: 1 } as User, wsStatus: "closed" }
    expect(isRealtimeOpen(1)).toBe(false)
  })
})
