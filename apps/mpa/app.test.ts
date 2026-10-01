import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { App } from "fresh"
import { handler as signIn } from "./routes/sign-in.ts"
import { handler as signOut } from "./routes/sign-out.ts"
import { handler as home } from "./routes/index.tsx"
import { handler as password } from "./routes/profile/password.ts"
import { handler as notes } from "./routes/groups/[groupId]/notes/index.tsx"
import { handler as note } from "./routes/groups/[groupId]/notes/[noteId]/index.tsx"
import { pageMiddleware } from "./middleware.ts"
import type { State } from "./utils.ts"

const config = { apiUrl: "http://api:8000", webAppOrigin: "https://app.example.com" }
const sameOrigin = { origin: config.webAppOrigin, "sec-fetch-site": "same-origin" }
const info = {
  remoteAddr: { transport: "tcp", hostname: "192.0.2.7", port: 4000 },
  completed: Promise.resolve(),
} as Deno.ServeHandlerInfo<Deno.NetAddr>

/** A fake API that answers every call with `answer()` and records each request's JSON body. */
function fakeApi(answer: (path: string) => Response) {
  const calls: { method: string; path: string; body: unknown }[] = []
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init)
    const path = new URL(request.url).pathname
    const text = await request.text()
    calls.push({ method: request.method, path, body: text ? JSON.parse(text) : null })
    return answer(path)
  }
  return { calls, fetch: fetch as typeof globalThis.fetch }
}

function appWith(fetch: typeof globalThis.fetch) {
  return new App<State>()
    .use(pageMiddleware(config, fetch))
    .get("/page", (ctx) => ctx.html("<p>page</p>"))
    .get("/", home.GET!)
    .post("/profile/password", password.POST!)
    .post("/sign-in", signIn.POST!)
    .post("/sign-out", signOut.POST!)
    .get("/groups/:groupId/notes", notes.GET!)
    .post("/groups/:groupId/notes/:noteId", note.POST!)
    .handler()
}

function formPost(path: string, fields: Record<string, string>, headers = sameOrigin): Request {
  return new Request(`${config.webAppOrigin}${path}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(fields),
  })
}

describe("pageMiddleware", () => {
  it("refuses a sign-out another site posts before the API hears of it", async () => {
    const { calls, fetch } = fakeApi(() => Response.json({ success: true }))

    const response = await appWith(fetch)(
      formPost("/sign-out", {}, {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      }),
      info,
    )

    expect(response.status).toBe(403)
    expect(calls).toEqual([])
  })

  it("lets the app's own sign-out form through to the API", async () => {
    const { calls, fetch } = fakeApi(() => Response.json({ success: true }))

    const response = await appWith(fetch)(formPost("/sign-out", {}), info)

    expect(response.status).not.toBe(403)
    expect(calls.map((call) => call.path)).toEqual(["/api/auth/sign-out"])
  })

  it("lets a same-origin post under no-referrer through, whose origin is null", async () => {
    const { calls, fetch } = fakeApi(() => Response.json({ success: true }))

    const response = await appWith(fetch)(
      formPost("/sign-out", {}, { origin: "null", "sec-fetch-site": "same-origin" }),
      info,
    )

    expect(response.status).not.toBe(403)
    expect(calls).toHaveLength(1)
  })

  it("answers a form over the size cap with 413 and never calls the API", async () => {
    const { calls, fetch } = fakeApi(() => Response.json({}))

    const response = await appWith(fetch)(
      formPost("/sign-in", { login: "x".repeat(300 * 1024), password: "p" }),
      info,
    )

    expect(response.status).toBe(413)
    expect(calls).toEqual([])
  })

  it("forbids other sites to frame a page and keeps it out of every cache", async () => {
    const { fetch } = fakeApi(() => Response.json({}))

    const response = await appWith(fetch)(new Request(`${config.webAppOrigin}/page`), info)

    expect(response.headers.get("x-frame-options")).toBe("DENY")
    expect(response.headers.get("content-security-policy")).toBe("frame-ancestors 'none'")
    expect(response.headers.get("cache-control")).toBe("no-store")
  })
})

describe("the sign-in page", () => {
  it("signs in with AuthForm's fields renamed and hands the browser the API's session cookie", async () => {
    const cookie = "sessionIdToken=s; Max-Age=60; Path=/; HttpOnly; Secure; SameSite=Lax"
    const { calls, fetch } = fakeApi(() =>
      Response.json({ id: 1 }, { headers: { "set-cookie": cookie } })
    )

    const response = await appWith(fetch)(
      formPost("/sign-in", { login: "ada", password: "long-enough" }),
      info,
    )

    expect(calls).toEqual([{
      method: "POST",
      path: "/api/auth/password/check",
      body: { username: "ada", password: "long-enough" },
    }])
    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe("/")
    expect(response.headers.getSetCookie()).toEqual([cookie])
  })

  it("sends a session that still owes its one-time code on to the code page", async () => {
    const { fetch } = fakeApi(() => Response.json({ secondFactor: "Pending" }, { status: 202 }))

    const response = await appWith(fetch)(
      formPost("/sign-in", { login: "ada", password: "long-enough" }),
      info,
    )

    expect(response.headers.get("location")).toBe("/totp")
  })
})

describe("the sign-in page when the API says to wait", () => {
  it("passes the API's 429 and Retry-After on to the browser", async () => {
    const { fetch } = fakeApi((path) =>
      path === "/api/auth/me"
        ? Response.json({ error: "User not signed in" }, { status: 401 })
        : Response.json({ error: "Too many requests" }, {
          status: 429,
          headers: { "retry-after": "30" },
        })
    )

    const response = await appWith(fetch)(
      formPost("/sign-in", { login: "ada", password: "long-enough" }),
      info,
    )

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("30")
    expect(await response.text()).toContain("Too many requests")
  })
})

describe("the profile page", () => {
  const signedIn = (path: string) => {
    if (path === "/api/auth/me") return Response.json({ firstName: "Ada", lastName: "", mfa: 1 })
    if (path === "/api/push/devices") return Response.json({ data: [] })
    return Response.json({ error: "Invalid password" }, { status: 400 })
  }

  it("shows a refused password change with the API's message and never the typed passwords", async () => {
    const { fetch } = fakeApi(signedIn)

    const response = await appWith(fetch)(
      formPost("/profile/password", {
        password: "current-secret-1",
        newPassword: "new-secret-2",
      }),
      info,
    )
    const html = await response.text()

    expect(response.status).toBe(400)
    expect(html).toContain("Invalid password")
    expect(html).not.toContain("current-secret-1")
    expect(html).not.toContain("new-secret-2")
  })

  it("answers an API outage with an error, not with a signed-out page", async () => {
    const { fetch } = fakeApi(() => Response.json({ error: "down" }, { status: 503 }))

    const response = await appWith(fetch)(new Request(`${config.webAppOrigin}/`), info)

    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain("Sign in required")
  })
})

describe("the note edit page", () => {
  const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
  const noteId = "0f4a3c1e-9d2b-4e8f-a6c5-1b2d3e4f5a6b"

  it("keeps the typed text after a save against a stale version and links to the latest one", async () => {
    const { calls, fetch } = fakeApi((path) => {
      if (path === "/api/auth/me") return Response.json({ firstName: "Ada", lastName: "", mfa: 1 })
      if (path === `/api/groups/${groupId}`) {
        return Response.json({ group: { id: groupId, name: "Trip", kind: 2, role: 4 } })
      }
      if (path === `/api/groups/${groupId}/notes`) {
        return Response.json({ notes: [], nextCursor: null })
      }
      return Response.json(
        { error: { code: "VERSION_CONFLICT", message: "The note was changed by someone else" } },
        { status: 409 },
      )
    })

    const response = await appWith(fetch)(
      formPost(`/groups/${groupId}/notes/${noteId}`, { title: "Mine", body: "Kept", version: "1" }),
      info,
    )
    const html = await response.text()

    expect(calls.find((call) => call.method === "PATCH")).toEqual({
      method: "PATCH",
      path: `/api/groups/${groupId}/notes/${noteId}`,
      body: { title: "Mine", body: "Kept", version: 1 },
    })
    expect(response.status).toBe(409)
    expect(html).toContain('data-e2e="note-conflict"')
    expect(html).toContain("The note was changed by someone else")
    expect(html).toContain('value="Mine"')
    expect(html).toContain(`href="/groups/${groupId}/notes/${noteId}"`)
  })
})

describe("the notes page", () => {
  const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
  const notesFetch = (groupStatus: number) =>
    fakeApi((path) => {
      if (path === "/api/auth/me") return Response.json({ firstName: "Ada", lastName: "", mfa: 1 })
      if (path === `/api/groups/${groupId}`) {
        return groupStatus === 200
          ? Response.json({ group: { id: groupId, name: "Trip", kind: 2, role: 4 } })
          : Response.json({ error: { code: "GROUP_NOT_FOUND" } }, { status: groupStatus })
      }
      return Response.json({ notes: [], nextCursor: null })
    })

  it("reads its group with one call and never lists the person's groups", async () => {
    const { calls, fetch } = notesFetch(200)

    const response = await appWith(fetch)(
      new Request(`${config.webAppOrigin}/groups/${groupId}/notes`),
      info,
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toContain("Trip")
    const groupCalls = calls.filter((call) =>
      /^\/api\/groups(\/|\?|$)/.test(call.path) &&
      !call.path.includes("/notes")
    )
    expect(groupCalls.map((call) => call.path)).toEqual([`/api/groups/${groupId}`])
  })

  it("shows a group that is missing or not the person's as not found", async () => {
    const { fetch } = notesFetch(404)

    const response = await appWith(fetch)(
      new Request(`${config.webAppOrigin}/groups/${groupId}/notes`),
      info,
    )

    expect(await response.text()).toContain("This group was not found")
  })
})
