import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { App } from "fresh"
import { handler as signIn } from "./routes/sign-in.ts"
import { handler as signOut } from "./routes/sign-out.ts"
import { handler as forgotPassword } from "./routes/forgot-password.ts"
import { handler as resetPassword } from "./routes/reset-password.ts"
import { handler as home } from "./routes/index.tsx"
import { handler as password } from "./routes/profile/password.ts"
import { handler as notes } from "./routes/notes/index.tsx"
import { handler as note } from "./routes/notes/[noteId]/index.tsx"
import { handler as selectGroup } from "./routes/groups/select.ts"
import { handler as groupsPage } from "./routes/groups/index.tsx"
import { handler as groupSettings } from "./routes/groups/[groupId]/index.tsx"
import { handler as oldNotes } from "./routes/groups/[groupId]/notes/index.tsx"
import { handler as oldNote } from "./routes/groups/[groupId]/notes/[noteId]/index.tsx"
import { pageMiddleware } from "./middleware.ts"
import type { State } from "./utils.ts"

const config = { apiUrl: "http://api:8000", webAppOrigin: "https://app.example.com" }
const sameOrigin = { origin: config.webAppOrigin, "sec-fetch-site": "same-origin" }
const info = {
  remoteAddr: { transport: "tcp", hostname: "192.0.2.7", port: 4000 },
  completed: Promise.resolve(),
} as Deno.ServeHandlerInfo<Deno.NetAddr>

/** A fake API that answers every call with `answer()` and records each request's JSON body. */
function fakeApi(answer: (path: string, method: string) => Response) {
  const calls: { method: string; path: string; body: unknown }[] = []
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init)
    const path = new URL(request.url).pathname
    const text = await request.text()
    calls.push({ method: request.method, path, body: text ? JSON.parse(text) : null })
    return answer(path, request.method)
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
    .get("/notes", notes.GET!)
    .post("/notes", notes.POST!)
    .post("/notes/:noteId", note.POST!)
    .post("/groups/select", selectGroup.POST!)
    .get("/groups", groupsPage.GET!)
    .get("/groups/:groupId", groupSettings.GET!)
    .get("/groups/:groupId/notes", oldNotes.GET!)
    .get("/groups/:groupId/notes/:noteId", oldNote.GET!)
    .post("/forgot-password", forgotPassword.POST!)
    .get("/reset-password", resetPassword.GET!)
    .post("/reset-password", resetPassword.POST!)
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
  it("signs in with the API's field names and hands the browser the API's session cookie", async () => {
    const cookie = "sessionIdToken=s; Max-Age=60; Path=/; HttpOnly; Secure; SameSite=Lax"
    const { calls, fetch } = fakeApi(() =>
      Response.json({ id: 1 }, { headers: { "set-cookie": cookie } })
    )

    const response = await appWith(fetch)(
      formPost("/sign-in", { login: "ada@example.com", password: "long-enough" }),
      info,
    )

    expect(calls).toEqual([{
      method: "POST",
      path: "/api/auth/password/check",
      body: { login: "ada@example.com", password: "long-enough" },
    }])
    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe("/")
    expect(response.headers.getSetCookie()).toEqual([cookie])
  })

  it("sends a session that still owes its one-time code on to the code page", async () => {
    const { fetch } = fakeApi(() => Response.json({ secondFactor: "Pending" }, { status: 202 }))

    const response = await appWith(fetch)(
      formPost("/sign-in", { login: "ada@example.com", password: "long-enough" }),
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
      formPost("/sign-in", { login: "ada@example.com", password: "long-enough" }),
      info,
    )

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("30")
    expect(await response.text()).toContain("Too many requests")
  })
})

describe("the password reset pages", () => {
  /** Nobody is signed in; every other call answers with `answer`. */
  const signedOut = (answer: () => Response) => (path: string) =>
    path === "/api/auth/me"
      ? Response.json({ error: "User not signed in" }, { status: 401 })
      : answer()
  const link = "/reset-password?email=ada%40example.com&code=code-from-the-link"

  it("asks the API for a link with the address and says it is on its way", async () => {
    const message = "If an account uses this address, a link to reset its password is on its way."
    const { calls, fetch } = fakeApi(signedOut(() => Response.json({ success: true, message })))

    const response = await appWith(fetch)(
      formPost("/forgot-password", { email: "ada@example.com" }),
      info,
    )

    expect(calls[0]).toEqual({
      method: "POST",
      path: "/api/auth/password/forgot",
      body: { email: "ada@example.com" },
    })
    expect(response.status).toBe(200)
    const page = await response.text()
    expect(page).toContain("Check your inbox")
    expect(page).toContain(message)
  })

  it("shows the reset form with the link's address and code, and sends no Referer from it", async () => {
    const { fetch } = fakeApi(signedOut(() => Response.json({})))

    const response = await appWith(fetch)(
      new Request(`${config.webAppOrigin}${link}`),
      info,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    const page = await response.text()
    expect(page).toContain(`name="email" value="ada@example.com"`)
    expect(page).toContain(`name="code" value="code-from-the-link"`)
  })

  it("sends the address, code and new password to the API and points to sign-in", async () => {
    const { calls, fetch } = fakeApi(signedOut(() => Response.json({ success: true })))

    const response = await appWith(fetch)(
      formPost("/reset-password", {
        email: "ada@example.com",
        code: "code-from-the-link",
        newPassword: "battery-staple",
      }),
      info,
    )

    expect(calls[0]).toEqual({
      method: "POST",
      path: "/api/auth/password/reset",
      body: { email: "ada@example.com", code: "code-from-the-link", newPassword: "battery-staple" },
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain("Password changed")
  })

  it("shows the API's refusal of a used link with its status, keeping the link's fields", async () => {
    const refusal = "This link is invalid, used or expired. Ask for a new one."
    const { fetch } = fakeApi(signedOut(() => Response.json({ error: refusal }, { status: 400 })))

    const response = await appWith(fetch)(
      formPost("/reset-password", {
        email: "ada@example.com",
        code: "used-code",
        newPassword: "battery-staple",
      }),
      info,
    )

    expect(response.status).toBe(400)
    const page = await response.text()
    expect(page).toContain(refusal)
    expect(page).toContain(`name="code" value="used-code"`)
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

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
const otherGroupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111003"
const farGroupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111098"
const noteId = "0f4a3c1e-9d2b-4e8f-a6c5-1b2d3e4f5a6b"

/**
 * A fake API for a signed-in person who belongs to two groups and has `selected` selected.
 * `rest` answers every other path.
 */
function notesApi(
  selected: string,
  rest: (path: string, method: string) => Response = () => notesList(),
) {
  return fakeApi((path, method) => {
    if (path === "/api/auth/me") return Response.json({ firstName: "Ada", lastName: "", mfa: 1 })
    if (path === "/api/groups") {
      return Response.json({
        groups: [
          { id: groupId, name: "Trip", kind: 2, role: 4 },
          { id: otherGroupId, name: "Work", kind: 2, role: 1 },
        ],
        nextCursor: null,
      })
    }
    if (path === "/api/groups/selected" && method === "GET") {
      return Response.json({ groupId: selected, version: 1 })
    }
    return rest(path, method)
  })
}

function notesList() {
  return Response.json({ notes: [], nextCursor: null })
}

describe("the note edit page", () => {
  it("keeps the typed text after a save against a stale version and links to the latest one", async () => {
    const { calls, fetch } = notesApi(groupId, (path) => {
      if (path === `/api/groups/${groupId}/notes`) return notesList()
      return Response.json(
        { error: { code: "VERSION_CONFLICT", message: "The note was changed by someone else" } },
        { status: 409 },
      )
    })

    const response = await appWith(fetch)(
      formPost(`/notes/${noteId}`, { title: "Mine", body: "Kept", version: "1" }),
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
    expect(html).toContain(`href="/notes/${noteId}"`)
  })
})

describe("the notes page", () => {
  const get = (fetch: typeof globalThis.fetch, path = "/notes") =>
    appWith(fetch)(new Request(`${config.webAppOrigin}${path}`), info)

  it("shows the notes of the selected group, whichever group the person last opened", async () => {
    for (const [selected, name] of [[groupId, "Trip"], [otherGroupId, "Work"]]) {
      const { calls, fetch } = notesApi(selected)

      const response = await get(fetch)

      expect(response.status).toBe(200)
      expect(await response.text()).toContain(`Notes in ${name}`)
      expect(calls.filter((call) => call.path.endsWith("/notes")).map((call) => call.path))
        .toEqual([`/api/groups/${selected}/notes`])
    }
  })

  it("reads the group list and the selection once each, and never one group by itself", async () => {
    const { calls, fetch } = notesApi(groupId)

    await get(fetch)

    const groupCalls = calls.filter((call) =>
      call.path.startsWith("/api/groups") && !call.path.endsWith("/notes")
    )
    expect(groupCalls.map((call) => call.path).sort()).toEqual([
      "/api/groups",
      "/api/groups/selected",
    ])
  })

  it("puts the group picker in the side menu, with the selected group chosen", async () => {
    const { fetch } = notesApi(otherGroupId)

    const html = await (await get(fetch)).text()

    expect(html).toContain('action="/groups/select"')
    expect(html).toContain(`<option selected value="${otherGroupId}">Work · Viewer</option>`)
    expect(html).toContain('aria-label="Manage groups"')
  })

  it("reads the selected group by itself when it is beyond the picker's first page", async () => {
    const farId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111099"
    const { calls, fetch } = notesApi(farId, (path) => {
      if (path === `/api/groups/${farId}`) {
        return Response.json({ group: { id: farId, name: "Far away", kind: 2, role: 4 } })
      }
      return notesList()
    })

    const response = await get(fetch)

    expect(response.status).toBe(200)
    expect(await response.text()).toContain("Notes in Far away")
    expect(calls.map((call) => call.path)).toContain(`/api/groups/${farId}/notes`)
  })

  it("says the group was not found when the person has no group", async () => {
    const { fetch } = fakeApi((path) => {
      if (path === "/api/auth/me") return Response.json({ firstName: "Ada", lastName: "", mfa: 1 })
      if (path === "/api/groups") return Response.json({ groups: [], nextCursor: null })
      return Response.json({ groupId: null, version: 0 })
    })

    const response = await get(fetch)

    expect(response.status).toBe(404)
    expect(await response.text()).toContain("This group was not found")
  })

  it("renders the page without a picker when the groups cannot be read", async () => {
    const { fetch } = fakeApi((path) => {
      if (path === "/api/auth/me") return Response.json({ firstName: "Ada", lastName: "", mfa: 1 })
      return Response.json({ error: "down" }, { status: 503 })
    })

    const response = await get(fetch)

    expect(await response.text()).not.toContain("group-picker")
  })
})

describe("creating a note", () => {
  const create = (fetch: typeof globalThis.fetch, shown: string) =>
    appWith(fetch)(
      formPost(`/notes?group=${shown}`, { id: noteId, title: "Tent", body: "Green" }),
      info,
    )

  it("posts to the group the page showed when that is still the selected group", async () => {
    const { calls, fetch } = notesApi(groupId)

    const response = await create(fetch, groupId)

    expect(response.status).toBe(303)
    expect(calls.find((call) => call.method === "POST")).toEqual({
      method: "POST",
      path: `/api/groups/${groupId}/notes`,
      body: { id: noteId, title: "Tent", body: "Green" },
    })
  })

  it("adds nothing and keeps the draft when the selected group is no longer the one shown", async () => {
    const { calls, fetch } = notesApi(groupId)

    const response = await create(fetch, otherGroupId)

    expect(response.status).toBe(409)
    expect(calls.filter((call) => call.method === "POST")).toEqual([])
    const html = await response.text()
    expect(html).toContain("Nothing was added")
    expect(html).toContain("Tent")
  })
})

describe("selecting a group", () => {
  it("stores the chosen group through the API and shows its notes", async () => {
    const { calls, fetch } = notesApi(groupId)

    const response = await appWith(fetch)(
      formPost("/groups/select", { groupId: otherGroupId }),
      info,
    )

    expect(calls.find((call) => call.method === "PUT")).toEqual({
      method: "PUT",
      path: "/api/groups/selected",
      body: { groupId: otherGroupId },
    })
    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe("/notes")
  })

  it("sends the person to the groups page when the API refuses the group", async () => {
    const { fetch } = notesApi(groupId, () => Response.json({ error: "no" }, { status: 404 }))

    const response = await appWith(fetch)(formPost("/groups/select", { groupId: "gone" }), info)

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe("/groups")
  })

  it("refuses a selection another site posts before the API hears of it", async () => {
    const { calls, fetch } = notesApi(groupId)

    const response = await appWith(fetch)(
      formPost("/groups/select", { groupId: otherGroupId }, {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      }),
      info,
    )

    expect(response.status).toBe(403)
    expect(calls).toEqual([])
  })
})

describe("old notes links", () => {
  const follow = (fetch: typeof globalThis.fetch, path: string) =>
    appWith(fetch)(new Request(`${config.webAppOrigin}${path}`), info)

  it("go to the notes at their new address when the group is already selected", async () => {
    const { fetch } = notesApi(groupId)

    const list = await follow(fetch, `/groups/${groupId}/notes`)
    const one = await follow(fetch, `/groups/${groupId}/notes/${noteId}`)

    expect([list.status, list.headers.get("location")]).toEqual([303, "/notes"])
    expect([one.status, one.headers.get("location")]).toEqual([303, `/notes/${noteId}`])
  })

  it("go to the groups page, changing nothing, when another group is selected", async () => {
    const { calls, fetch } = notesApi(otherGroupId)

    const response = await follow(fetch, `/groups/${groupId}/notes`)

    expect([response.status, response.headers.get("location")]).toEqual([303, "/groups"])
    expect(calls.some((call) => call.method !== "GET")).toBe(false)
  })
})

describe("the groups pages", () => {
  const get = (fetch: typeof globalThis.fetch, path: string) =>
    appWith(fetch)(new Request(`${config.webAppOrigin}${path}`), info)

  it("marks only the selected group on the list, and links each group to its settings", async () => {
    const { fetch } = notesApi(otherGroupId)

    const html = await (await get(fetch, "/groups")).text()

    expect(html.match(/>Selected</g)).toHaveLength(1)
    expect(html).toContain(`href="/groups/${groupId}"`)
    expect(html).toContain(`href="/groups/${otherGroupId}"`)
  })

  it("shows a group's settings with the person's role in it", async () => {
    const { fetch } = notesApi(
      groupId,
      (path) =>
        path === `/api/groups/${otherGroupId}`
          ? Response.json({ group: { id: otherGroupId, name: "Work", kind: 2, role: 1 } })
          : notesList(),
    )

    const response = await get(fetch, `/groups/${otherGroupId}`)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain("Work")
    expect(html).toContain("Viewer")
    expect(html).not.toContain(">Selected<")
  })

  it("answers 404 for a group the person does not belong to", async () => {
    const { fetch } = notesApi(groupId, () => Response.json({ error: {} }, { status: 404 }))

    const response = await get(fetch, `/groups/${farGroupId}`)

    expect(response.status).toBe(404)
    expect(await response.text()).toContain("This group does not exist.")
  })
})
