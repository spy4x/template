import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { createApi, errorCode, errorMessage } from "./api.ts"

/** A fake API: records the one request it gets and answers with `response`. */
function fakeFetch(response: Response) {
  const seen: Request[] = []
  const fetch = (input: string | URL | Request, init?: RequestInit) => {
    seen.push(new Request(input, init))
    return Promise.resolve(response)
  }
  return { seen, fetch: fetch as typeof globalThis.fetch }
}

const browserRequest = new Request("https://app.example.com/sign-in", {
  method: "POST",
  headers: {
    cookie: "sessionIdToken=abc",
    origin: "https://app.example.com",
    "sec-fetch-site": "same-origin",
    "user-agent": "test-browser",
    authorization: "Bearer should-not-pass",
    host: "app.example.com",
  },
})

describe("createApi", () => {
  it("passes the browser's cookie and origin headers to the API unchanged, and nothing else of its own", async () => {
    const { seen, fetch } = fakeFetch(Response.json({}))
    const api = createApi({
      apiUrl: "http://api:8000",
      request: browserRequest,
      remoteAddress: "192.0.2.7",
      setCookies: [],
      fetch,
    })

    await api.call("POST", "/api/auth/password/check", { username: "ada", password: "pw" })

    const [sent] = seen
    expect(sent.url).toBe("http://api:8000/api/auth/password/check")
    expect(Object.fromEntries(sent.headers)).toEqual({
      "content-type": "application/json",
      cookie: "sessionIdToken=abc",
      origin: "https://app.example.com",
      "sec-fetch-site": "same-origin",
      "user-agent": "test-browser",
      "x-real-ip": "192.0.2.7",
    })
    expect(await sent.json()).toEqual({ username: "ada", password: "pw" })
  })

  it("swaps only the page's own origin for the API's when given origins", async () => {
    const origins = { page: "https://www.example.com", api: "https://app.example.com" }
    const sent = async (origin: string) => {
      const { seen, fetch } = fakeFetch(Response.json({}))
      const request = new Request("https://www.example.com/act", {
        method: "POST",
        headers: { origin },
      })
      await createApi({
        apiUrl: "http://api:8000",
        request,
        remoteAddress: "",
        setCookies: [],
        origins,
        fetch,
      })
        .call("POST", "/api/auth/sign-out")
      return seen[0].headers.get("origin")
    }

    expect(await sent("https://www.example.com")).toBe("https://app.example.com")
    expect(await sent("https://evil.example.net")).toBe("https://evil.example.net")
    expect(await sent("null")).toBe("null")
  })

  it("keeps the client address a proxy in front already set", async () => {
    const { seen, fetch } = fakeFetch(Response.json({}))
    const request = new Request("https://app.example.com/", {
      headers: { "x-real-ip": "198.51.100.4", "x-forwarded-for": "198.51.100.4" },
    })
    const api = createApi({
      apiUrl: "http://api:8000",
      request,
      remoteAddress: "10.0.0.2",
      setCookies: [],
      fetch,
    })

    await api.call("GET", "/api/auth/me")

    expect(seen[0].headers.get("x-real-ip")).toBe("198.51.100.4")
    expect(seen[0].headers.get("x-forwarded-for")).toBe("198.51.100.4")
  })

  it("collects every cookie the API sets, exactly as the API wrote it", async () => {
    const headers = new Headers()
    headers.append("set-cookie", "sessionIdToken=s; Path=/; HttpOnly; Secure; SameSite=Lax")
    headers.append("set-cookie", "user_id=1; Path=/; Secure; SameSite=Lax")
    const { fetch } = fakeFetch(new Response(null, { status: 204, headers }))
    const setCookies: string[] = []
    const api = createApi({
      apiUrl: "http://api:8000",
      request: browserRequest,
      remoteAddress: "",
      setCookies,
      fetch,
    })

    const answer = await api.call("POST", "/api/auth/sign-out")

    expect(answer).toEqual({ status: 204, body: null })
    expect(setCookies).toEqual([
      "sessionIdToken=s; Path=/; HttpOnly; Secure; SameSite=Lax",
      "user_id=1; Path=/; Secure; SameSite=Lax",
    ])
  })
})

describe("errorMessage", () => {
  it("reads both error shapes the API answers with", () => {
    expect(errorMessage({ status: 401, body: { error: "Invalid token" } }, "x")).toBe(
      "Invalid token",
    )
    const conflict = {
      status: 409,
      body: { error: { code: "VERSION_CONFLICT", message: "Changed by someone else" } },
    }
    expect(errorMessage(conflict, "x")).toBe("Changed by someone else")
    expect(errorCode(conflict)).toBe("VERSION_CONFLICT")
    expect(errorMessage({ status: 502, body: null }, "Sign in failed")).toBe("Sign in failed")
  })
})
