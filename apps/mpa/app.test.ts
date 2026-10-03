import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { App } from "fresh"
import { handler as signIn } from "./routes/sign-in.ts"
import { handler as signOut } from "./routes/sign-out.ts"
import { handler as signUp } from "./routes/sign-up.ts"
import { handler as totp } from "./routes/totp.ts"
import { handler as forgotPassword } from "./routes/forgot-password.ts"
import { handler as resetPassword } from "./routes/reset-password.ts"
import { handler as home } from "./routes/index.tsx"
import { handler as password } from "./routes/profile/password.ts"
import { handler as notes } from "./routes/notes/index.tsx"
import { handler as note } from "./routes/notes/[noteId]/index.tsx"
import { handler as moveNotes } from "./routes/notes/move.ts"
import { handler as moveNote } from "./routes/notes/[noteId]/move.ts"
import { handler as selectGroup } from "./routes/groups/select.ts"
import { handler as groupsPage } from "./routes/groups/index.tsx"
import { handler as groupSettings } from "./routes/groups/[groupId]/index.tsx"
import { handler as renameGroup } from "./routes/groups/[groupId]/rename.ts"
import { handler as deleteGroup } from "./routes/groups/[groupId]/delete.ts"
import { handler as restoreGroup } from "./routes/groups/[groupId]/restore.ts"
import { handler as leaveGroup } from "./routes/groups/[groupId]/leave.ts"
import { handler as transferGroup } from "./routes/groups/[groupId]/transfer.ts"
import { handler as memberRole } from "./routes/groups/[groupId]/members/[userId]/role.ts"
import { handler as memberRemove } from "./routes/groups/[groupId]/members/[userId]/remove.ts"
import { handler as oldNotes } from "./routes/groups/[groupId]/notes/index.tsx"
import { handler as oldNote } from "./routes/groups/[groupId]/notes/[noteId]/index.tsx"
import { handler as emailPage } from "./routes/email/index.tsx"
import { handler as emailVerify } from "./routes/email/verify.ts"
import { handler as emailSend } from "./routes/email/send.ts"
import { handler as emailChange } from "./routes/email/change.ts"
import { handler as invitePage } from "./routes/invite/[token].tsx"
import { handler as inviteAccept } from "./routes/invite/accept.ts"
import { handler as inviteDecline } from "./routes/invite/decline.ts"
import { handler as invitationCreate } from "./routes/groups/[groupId]/invitations/index.ts"
import { handler as invitationRevoke } from "./routes/groups/[groupId]/invitations/[invitationId]/revoke.ts"
import { EMAIL_FAILURES } from "@ui/email-screen.tsx"
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
    .get("/sign-in", signIn.GET!)
    .post("/sign-in", signIn.POST!)
    .get("/sign-up", signUp.GET!)
    .get("/totp", totp.GET!)
    .post("/totp", totp.POST!)
    .post("/sign-out", signOut.POST!)
    .get("/notes", notes.GET!)
    .post("/notes", notes.POST!)
    .post("/notes/move", moveNotes.POST!)
    .get("/notes/:noteId", note.GET!)
    .post("/notes/:noteId", note.POST!)
    .post("/notes/:noteId/move", moveNote.POST!)
    .post("/groups/select", selectGroup.POST!)
    .get("/groups", groupsPage.GET!)
    .get("/groups/:groupId", groupSettings.GET!)
    .post("/groups/:groupId/rename", renameGroup.POST!)
    .post("/groups/:groupId/delete", deleteGroup.POST!)
    .post("/groups/:groupId/restore", restoreGroup.POST!)
    .post("/groups/:groupId/leave", leaveGroup.POST!)
    .post("/groups/:groupId/transfer", transferGroup.POST!)
    .post("/groups/:groupId/members/:userId/role", memberRole.POST!)
    .post("/groups/:groupId/members/:userId/remove", memberRemove.POST!)
    .get("/groups/:groupId/notes", oldNotes.GET!)
    .get("/groups/:groupId/notes/:noteId", oldNote.GET!)
    .post("/forgot-password", forgotPassword.POST!)
    .get("/reset-password", resetPassword.GET!)
    .post("/reset-password", resetPassword.POST!)
    .get("/email", emailPage.GET!)
    .post("/email/verify", emailVerify.POST!)
    .post("/email/send", emailSend.POST!)
    .post("/email/change", emailChange.POST!)
    .post("/invite/accept", inviteAccept.POST!)
    .post("/invite/decline", inviteDecline.POST!)
    .get("/invite/:token", invitePage.GET!)
    .post("/groups/:groupId/invitations", invitationCreate.POST!)
    .post("/groups/:groupId/invitations/:invitationId/revoke", invitationRevoke.POST!)
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

describe("returning to the requested page after sign-in", () => {
  const signedOut = () => Response.json({ error: "User not signed in" }, { status: 401 })
  const get = (fetch: typeof globalThis.fetch, path: string) =>
    appWith(fetch)(new Request(`${config.webAppOrigin}${path}`), info)
  /** The value of the hidden `next` field in a page, or `null` when the form has none. */
  const hiddenNext = (html: string) =>
    html.match(/<input type="hidden" name="next" value="([^"]*)"/)?.[1] ?? null
  const UNSAFE = ["//evil.example", "https://evil.example", "/\\evil.example", "/api/auth/me"]

  it("sends a signed-out visit to a note to sign-in, with the note and its query as next", async () => {
    const { fetch } = fakeApi(signedOut)

    const response = await get(fetch, `/notes/${noteId}?from=link`)

    expect(response.status).toBe(303)
    expect(response.headers.get("location"))
      .toBe(`/sign-in?${new URLSearchParams({ next: `/notes/${noteId}?from=link` })}`)
  })

  it("sends a visit whose session owes its code to the code page, with the page as next", async () => {
    const { fetch } = fakeApi(() => Response.json({ secondFactor: "Pending" }, { status: 202 }))

    const response = await get(fetch, "/groups")

    expect(response.headers.get("location")).toBe("/totp?next=%2Fgroups")
  })

  it("sends a signed-out post to sign-in without next, since its address is no page", async () => {
    const { fetch } = fakeApi(signedOut)

    const response = await appWith(fetch)(formPost("/email/verify", { code: "Ab3_x-9Q" }), info)

    expect(response.headers.get("location")).toBe("/sign-in")
  })

  it("puts next into the sign-in form and into its link to sign-up", async () => {
    const { fetch } = fakeApi(signedOut)

    const html = await (await get(fetch, "/sign-in?next=%2Fnotes%2Fabc")).text()

    expect(hiddenNext(html)).toBe("/notes/abc")
    expect(html).toContain(`href="/sign-up?next=%2Fnotes%2Fabc"`)
  })

  it("keeps next on the sign-up page's link back to sign-in", async () => {
    const { fetch } = fakeApi(signedOut)

    const html = await (await get(fetch, "/sign-up?next=%2Fnotes%2Fabc")).text()

    expect(hiddenNext(html)).toBe("/notes/abc")
    expect(html).toContain(`href="/sign-in?next=%2Fnotes%2Fabc"`)
  })

  it("draws no next field when the page carries none", async () => {
    const { fetch } = fakeApi(signedOut)

    const html = await (await get(fetch, "/sign-in")).text()

    expect(html).not.toContain(`name="next"`)
    expect(html).toContain(`href="/sign-up"`)
  })

  it("puts the notes list into the form in place of an unsafe next", async () => {
    for (const next of UNSAFE) {
      const { fetch } = fakeApi(signedOut)

      const html = await (await get(fetch, `/sign-in?${new URLSearchParams({ next })}`)).text()

      expect(hiddenNext(html)).toBe("/notes")
    }
  })

  it("goes to next after the password when no code is owed", async () => {
    const { fetch } = fakeApi(() => Response.json({ id: 1 }))

    const response = await appWith(fetch)(
      formPost("/sign-in", {
        login: "ada@example.com",
        password: "long-enough",
        next: "/notes/abc",
      }),
      info,
    )

    expect(response.headers.get("location")).toBe("/notes/abc")
  })

  it("carries next on to the code page when a code is owed", async () => {
    const { fetch } = fakeApi(() => Response.json({ secondFactor: "Pending" }, { status: 202 }))

    const response = await appWith(fetch)(
      formPost("/sign-in", {
        login: "ada@example.com",
        password: "long-enough",
        next: "/notes/abc",
      }),
      info,
    )

    expect(response.headers.get("location")).toBe("/totp?next=%2Fnotes%2Fabc")
  })

  it("puts next into the code form", async () => {
    const { fetch } = fakeApi(() => Response.json({ secondFactor: "Pending" }, { status: 202 }))

    const html = await (await get(fetch, "/totp?next=%2Fnotes%2Fabc")).text()

    expect(hiddenNext(html)).toBe("/notes/abc")
    expect(html).toContain(`href="/sign-in?next=%2Fnotes%2Fabc"`)
  })

  it("goes to next after the code", async () => {
    const { fetch } = fakeApi(() => Response.json({ id: 1 }))

    const response = await appWith(fetch)(
      formPost("/totp", { otp: "123456", next: "/notes/abc" }),
      info,
    )

    expect(response.headers.get("location")).toBe("/notes/abc")
  })

  it("goes to the notes list in place of an unsafe next after the password", async () => {
    for (const next of UNSAFE) {
      const { fetch } = fakeApi(() => Response.json({ id: 1 }))

      const response = await appWith(fetch)(
        formPost("/sign-in", { login: "ada@example.com", password: "long-enough", next }),
        info,
      )

      expect(response.headers.get("location")).toBe("/notes")
    }
  })

  it("checks next again after the code, where the person may have changed it", async () => {
    for (const next of UNSAFE) {
      const { fetch } = fakeApi(() => Response.json({ id: 1 }))

      const response = await appWith(fetch)(formPost("/totp", { otp: "123456", next }), info)

      expect(response.headers.get("location")).toBe("/notes")
    }
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
          { id: groupId, name: "Trip", role: 4 },
          { id: otherGroupId, name: "Work", role: 1 },
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
        return Response.json({ group: { id: farId, name: "Far away", role: 4 } })
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

  it("shows the plan's upgrade prompt from the API's 402, keeping the draft", async () => {
    const { fetch } = notesApi(groupId, (_path, method) =>
      method === "POST"
        ? Response.json({
          error: {
            code: "PLAN_LIMIT_REACHED",
            message: "This group's plan holds up to 10 notes",
            entitlement: "maxNotes",
            limit: 10,
            canUpgrade: true,
          },
        }, { status: 402 })
        : notesList())

    const response = await create(fetch, groupId)

    expect(response.status).toBe(402)
    const html = await response.text()
    expect(html).toContain(`data-e2e="plan-refusal"`)
    expect(html).toContain(`href="/groups/${groupId}/pricing"`)
    expect(html).toContain("Tent")
  })
})

describe("moving notes", () => {
  const second = "0f4a3c1e-9d2b-4e8f-a6c5-1b2d3e4f5a6c"
  const listed = () =>
    Response.json({
      notes: [{ id: noteId, groupId, title: "Tent", body: "", version: 1 }],
      nextCursor: null,
    })
  const movable = (rest: (path: string, method: string) => Response = () => listed()) =>
    fakeApi((path, method) => {
      if (path === "/api/auth/me") return Response.json({ firstName: "Ada", lastName: "", mfa: 1 })
      if (path === "/api/groups") {
        return Response.json({
          groups: [
            { id: groupId, name: "Trip", role: 4 },
            { id: otherGroupId, name: "Work", role: 2 },
          ],
          nextCursor: null,
        })
      }
      if (path === "/api/groups/selected") return Response.json({ groupId, version: 1 })
      return rest(path, method)
    })
  const posts = (calls: { method: string }[]) => calls.filter((call) => call.method === "POST")

  it("offers the list a move form with the groups the person may write to", async () => {
    const { fetch } = movable()

    const html = await (await appWith(fetch)(new Request(`${config.webAppOrigin}/notes`), info))
      .text()

    expect(html).toContain(`action="/notes/move?group=${groupId}"`)
    expect(html).toContain(`name="noteIds" value="${noteId}"`)
    expect(html).toContain(`<option value="${otherGroupId}">Work</option>`)
  })

  it("posts the ticked notes to the API in one call and returns to the list", async () => {
    const { calls, fetch } = movable()
    const body = new URLSearchParams([
      ["toGroupId", otherGroupId],
      ["noteIds", noteId],
      ["noteIds", second],
    ])

    const response = await appWith(fetch)(
      new Request(`${config.webAppOrigin}/notes/move?group=${groupId}`, {
        method: "POST",
        headers: sameOrigin,
        body,
      }),
      info,
    )

    expect([response.status, response.headers.get("location")]).toEqual([303, "/notes"])
    expect(posts(calls)).toEqual([{
      method: "POST",
      path: `/api/groups/${groupId}/notes/move`,
      body: { toGroupId: otherGroupId, noteIds: [noteId, second] },
    }])
  })

  it("moves nothing when the selected group is no longer the one the page showed", async () => {
    const { calls, fetch } = movable()

    const response = await appWith(fetch)(
      formPost(`/notes/move?group=${otherGroupId}`, { toGroupId: otherGroupId, noteIds: noteId }),
      info,
    )

    expect(response.status).toBe(409)
    expect(posts(calls)).toEqual([])
    expect(await response.text()).toContain("Nothing was moved")
  })

  it("asks for a tick, and calls no API, when no note is ticked", async () => {
    const { calls, fetch } = movable()

    const response = await appWith(fetch)(
      formPost(`/notes/move?group=${groupId}`, { toGroupId: otherGroupId }),
      info,
    )

    expect(response.status).toBe(400)
    expect(posts(calls)).toEqual([])
    expect(await response.text()).toContain("Tick the notes you want to move.")
  })

  it("moves one note from its page, naming it by the address", async () => {
    const { calls, fetch } = movable()

    const response = await appWith(fetch)(
      formPost(`/notes/${noteId}/move`, { toGroupId: otherGroupId }),
      info,
    )

    expect([response.status, response.headers.get("location")]).toEqual([303, "/notes"])
    expect(posts(calls)).toEqual([{
      method: "POST",
      path: `/api/groups/${groupId}/notes/move`,
      body: { toGroupId: otherGroupId, noteIds: [noteId] },
    }])
  })

  it("shows the note's page again with the API's reason when the move is refused", async () => {
    const { fetch } = movable((path, method) =>
      method === "POST"
        ? Response.json(
          { error: { code: "ROLE_INSUFFICIENT", message: "Only an editor can move notes there" } },
          { status: 403 },
        )
        : path.endsWith("/notes")
        ? notesList()
        : Response.json({
          note: { id: noteId, groupId, title: "Tent", body: "", version: 2 },
        })
    )

    const response = await appWith(fetch)(
      formPost(`/notes/${noteId}/move`, { toGroupId: otherGroupId }),
      info,
    )

    expect(response.status).toBe(403)
    expect(await response.text()).toContain("Only an editor can move notes there")
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
          ? Response.json({ group: { id: otherGroupId, name: "Work", role: 1 } })
          : notesList(),
    )

    const response = await get(fetch, `/groups/${otherGroupId}`)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain("Work")
    expect(html).toContain("Viewer")
    expect(html).not.toContain(">Selected<")
  })

  const settings = (path: string, method: string) => {
    if (path === `/api/groups/${groupId}` && method === "GET") {
      return Response.json({ group: { id: groupId, name: "Trip", role: 4 } })
    }
    return notesList()
  }
  const refusal = (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status })

  it("gives the owner the rename form and the delete section on a group's settings", async () => {
    const { fetch } = notesApi(groupId, settings)

    const html = await (await get(fetch, `/groups/${groupId}`)).text()

    expect(html).toContain(`action="/groups/${groupId}/rename"`)
    expect(html).toContain(`action="/groups/${groupId}/delete"`)
  })

  it("shows a viewer neither the rename form nor the delete section", async () => {
    const { fetch } = notesApi(
      groupId,
      (path) =>
        path === `/api/groups/${otherGroupId}`
          ? Response.json({ group: { id: otherGroupId, name: "Work", role: 1 } })
          : notesList(),
    )

    const html = await (await get(fetch, `/groups/${otherGroupId}`)).text()

    expect(html).not.toContain("/rename")
    expect(html).not.toContain("/delete")
  })

  it("renames through PATCH with the form's name and returns to the settings page", async () => {
    const { calls, fetch } = notesApi(groupId, () => Response.json({ group: {} }))

    const response = await appWith(fetch)(
      formPost(`/groups/${groupId}/rename`, { name: "Trek" }),
      info,
    )

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe(`/groups/${groupId}`)
    expect(calls.filter((call) => call.method === "PATCH")).toEqual([
      { method: "PATCH", path: `/api/groups/${groupId}`, body: { name: "Trek" } },
    ])
  })

  it("shows a refused rename on the settings page, with the typed name kept", async () => {
    const { fetch } = notesApi(
      groupId,
      (path, method) =>
        method === "PATCH"
          ? refusal(403, "ROLE_INSUFFICIENT", "Group role is insufficient")
          : settings(path, method),
    )

    const response = await appWith(fetch)(
      formPost(`/groups/${groupId}/rename`, { name: "Trek" }),
      info,
    )
    const html = await response.text()

    expect(response.status).toBe(403)
    expect(html).toContain("Group role is insufficient")
    expect(html).toContain('value="Trek"')
  })

  it("deletes through DELETE and shows the groups page, where the group can be restored", async () => {
    const { calls, fetch } = notesApi(groupId, () => Response.json({ group: {} }))

    const response = await appWith(fetch)(formPost(`/groups/${groupId}/delete`, {}), info)

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe("/groups")
    expect(calls.filter((call) => call.method === "DELETE").map((call) => call.path))
      .toEqual([`/api/groups/${groupId}`])
  })

  it("shows why a delete was refused on the settings page, with the section open", async () => {
    const { fetch } = notesApi(
      groupId,
      (path, method) =>
        method === "DELETE"
          ? refusal(409, "LAST_GROUP", "A person must keep at least one group")
          : settings(path, method),
    )

    const response = await appWith(fetch)(formPost(`/groups/${groupId}/delete`, {}), info)
    const html = await response.text()

    expect(response.status).toBe(409)
    expect(html).toContain("A person must keep at least one group")
    expect(html).toMatch(/<details[^>]* open/)
  })

  it("disables the delete button on the settings page of the person's only group", async () => {
    const { fetch } = fakeApi((path) => {
      if (path === "/api/auth/me") return Response.json({ firstName: "Ada", lastName: "", mfa: 1 })
      if (path === "/api/groups") {
        return Response.json({ groups: [{ id: groupId, name: "Trip", role: 4 }], nextCursor: null })
      }
      if (path === "/api/groups/selected") return Response.json({ groupId, version: 1 })
      return Response.json({ group: { id: groupId, name: "Trip", role: 4 } })
    })

    const html = await (await get(fetch, `/groups/${groupId}`)).text()

    expect(html).toContain("This is your only group, so it cannot be deleted.")
    expect(html).not.toContain(`action="/groups/${groupId}/delete"`)
  })

  const membersOf = (path: string, method: string) =>
    path === `/api/groups/${groupId}/members` && method === "GET"
      ? Response.json({
        members: [
          { userId: 1, name: "Ada", email: null, role: 4, joinedAt: "2026-01-01T00:00:00Z" },
          { userId: 7, name: "Vic", email: null, role: 1, joinedAt: "2026-02-01T00:00:00Z" },
        ],
      })
      : settings(path, method)

  it("lists the members on a group's settings, with the owner's forms for each member below them", async () => {
    const { fetch } = notesApi(groupId, membersOf)

    const html = await (await get(fetch, `/groups/${groupId}`)).text()

    expect(html).toContain("Members (2)")
    expect(html).toContain("Vic")
    expect(html).toContain(`action="/groups/${groupId}/members/7/role"`)
    expect(html).toContain(`action="/groups/${groupId}/members/7/remove"`)
    expect(html).not.toContain(`action="/groups/${groupId}/members/1/role"`)
  })

  it("changes a member's role through PATCH with the role as a number, and returns to the settings page", async () => {
    const { calls, fetch } = notesApi(groupId, () => Response.json({ member: {} }))

    const response = await appWith(fetch)(
      formPost(`/groups/${groupId}/members/7/role`, { role: "2" }),
      info,
    )

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe(`/groups/${groupId}`)
    expect(calls.filter((call) => call.method === "PATCH")).toEqual([
      { method: "PATCH", path: `/api/groups/${groupId}/members/7`, body: { role: 2 } },
    ])
  })

  it("shows a refused role change under that member's row", async () => {
    const { fetch } = notesApi(
      groupId,
      (path, method) =>
        method === "PATCH"
          ? refusal(403, "ROLE_INSUFFICIENT", "Group role is insufficient")
          : membersOf(path, method),
    )

    const response = await appWith(fetch)(
      formPost(`/groups/${groupId}/members/7/role`, { role: "3" }),
      info,
    )
    const html = await response.text()

    expect(response.status).toBe(403)
    const row = html.slice(html.indexOf('data-user-id="7"'))
    expect(row).toContain("Group role is insufficient")
  })

  it("tells a member the plan refused the role change and to ask the owner, under that row", async () => {
    const { fetch } = notesApi(
      groupId,
      (path, method) =>
        method === "PATCH"
          ? Response.json({
            error: {
              code: "PLAN_FEATURE_MISSING",
              message: "This group's plan does not include changing roles",
              entitlement: "memberRoles",
              limit: null,
              canUpgrade: false,
            },
          }, { status: 402 })
          : membersOf(path, method),
    )

    const response = await appWith(fetch)(
      formPost(`/groups/${groupId}/members/7/role`, { role: "3" }),
      info,
    )
    const html = await response.text()

    expect(response.status).toBe(402)
    const row = html.slice(html.indexOf('data-user-id="7"'))
    expect(row).toContain(`data-e2e="plan-refusal"`)
    expect(row).toContain("Ask the group's owner to upgrade the plan.")
    expect(row).not.toContain("/pricing")
  })

  it("removes a member through DELETE and returns to the settings page", async () => {
    const { calls, fetch } = notesApi(groupId, () => Response.json({ removed: true }))

    const response = await appWith(fetch)(
      formPost(`/groups/${groupId}/members/7/remove`, {}),
      info,
    )

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe(`/groups/${groupId}`)
    expect(calls.filter((call) => call.method === "DELETE").map((call) => call.path))
      .toEqual([`/api/groups/${groupId}/members/7`])
  })

  it("leaves through POST and shows the groups page", async () => {
    const { calls, fetch } = notesApi(groupId, () => Response.json({ left: true }))

    const response = await appWith(fetch)(formPost(`/groups/${otherGroupId}/leave`, {}), info)

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe("/groups")
    expect(calls.filter((call) => call.method === "POST").map((call) => call.path))
      .toEqual([`/api/groups/${otherGroupId}/leave`])
  })

  it("shows why a leave was refused on the settings page, with the confirmation open", async () => {
    const { fetch } = notesApi(
      groupId,
      (path, method) =>
        method === "POST"
          ? refusal(409, "LAST_GROUP", "A person must keep at least one group")
          : path === `/api/groups/${otherGroupId}`
          ? Response.json({ group: { id: otherGroupId, name: "Work", role: 1 } })
          : notesList(),
    )

    const response = await appWith(fetch)(formPost(`/groups/${otherGroupId}/leave`, {}), info)
    const html = await response.text()

    expect(response.status).toBe(409)
    expect(html).toContain("A person must keep at least one group")
    expect(html).toMatch(
      /<details[^>]*data-e2e="group-leave-details"[^>]* open|<details[^>]* open[^>]*data-e2e="group-leave-details"/,
    )
  })

  it("transfers through POST with the chosen member, the name and the password, then shows the settings", async () => {
    const { calls, fetch } = notesApi(groupId, () => Response.json({ transferred: true }))

    const response = await appWith(fetch)(
      formPost(`/groups/${groupId}/transfer`, { userId: "7", name: "Trip", password: "pw-secret" }),
      info,
    )

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe(`/groups/${groupId}`)
    expect(calls.filter((call) => call.method === "POST"))
      .toEqual([{
        method: "POST",
        path: `/api/groups/${groupId}/transfer`,
        body: { userId: 7, name: "Trip", password: "pw-secret" },
      }])
  })

  it("shows a wrong password under its field, keeps the member and the name, and never sends the password back", async () => {
    const member = (userId: number, role: number, name: string) => ({
      userId,
      name,
      email: null,
      role,
      joinedAt: "2026-10-01T00:00:00.000Z",
      isYou: userId === 1,
    })
    const { fetch } = notesApi(groupId, (path, method) => {
      if (method === "POST") return refusal(400, "PASSWORD_INVALID", "The password is incorrect")
      if (path === `/api/groups/${groupId}/members`) {
        return Response.json({
          members: [member(1, 4, "Ada"), member(5, 1, "Bob"), member(7, 2, "Cyd")],
          memberCount: 3,
        })
      }
      return settings(path, method)
    })

    const response = await appWith(fetch)(
      formPost(`/groups/${groupId}/transfer`, { userId: "7", name: "Trip", password: "pw-secret" }),
      info,
    )
    const html = await response.text()

    expect(response.status).toBe(400)
    expect(html).not.toContain("pw-secret")
    expect(html).toMatch(/id="group-transfer-password-error"[^>]*>The password is incorrect</)
    expect(html).toMatch(/<option selected value="7">Cyd<\/option>/)
    expect(html).toMatch(/data-e2e="group-transfer-name"[^>]*value="Trip"/)
    expect(html).toMatch(
      /<details[^>]*data-e2e="group-transfer-details"[^>]* open|<details[^>]* open[^>]*data-e2e="group-transfer-details"/,
    )
  })

  /** The owner and one editor, so the transfer form is drawn. */
  const transferMembers = () =>
    Response.json({
      members: [
        { userId: 1, name: "Ada", email: null, role: 4, joinedAt: "2026-10-01", isYou: true },
        { userId: 7, name: "Cyd", email: null, role: 2, joinedAt: "2026-10-01", isYou: false },
      ],
      memberCount: 2,
    })

  it("tells the owner of a subscribed group that the subscription moves and stays on their card", async () => {
    const billing = (subscribed: boolean) => ({
      enabled: true,
      planId: "pro",
      status: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialEnd: null,
      notice: null,
      canManage: true,
      subscribed,
      hasCustomer: subscribed,
      seatPrice: null,
    })
    const explanation = async (subscribed: boolean) => {
      const { fetch } = notesApi(groupId, (path, method) => {
        if (path === `/api/groups/${groupId}/members`) return transferMembers()
        if (path === `/api/groups/${groupId}/billing`) {
          return Response.json({ billing: billing(subscribed) })
        }
        return settings(path, method)
      })
      const html = await (await get(fetch, `/groups/${groupId}`)).text()
      const start = html.indexOf('data-e2e="group-transfer-explanation"')
      expect(start).toBeGreaterThan(-1)
      return html.slice(start, html.indexOf("</p>", start))
    }

    expect(await explanation(true)).toContain("stays on your card")
    expect(await explanation(false)).not.toContain("subscription")
  })

  it("passes the API's 429 and Retry-After on from a refused transfer", async () => {
    const { fetch } = notesApi(groupId, (path, method) => {
      if (method === "POST") {
        return Response.json(
          { error: { code: "RATE_LIMITED", message: "Too many attempts" } },
          { status: 429, headers: { "retry-after": "60" } },
        )
      }
      if (path === `/api/groups/${groupId}/members`) return transferMembers()
      return settings(path, method)
    })

    const response = await appWith(fetch)(
      formPost(`/groups/${groupId}/transfer`, { userId: "7", name: "Trip", password: "pw" }),
      info,
    )

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("60")
    expect(await response.text()).toContain("Too many attempts")
  })

  it("lists the groups that can still be restored, each with a restore form", async () => {
    const { fetch } = notesApi(groupId, (path) =>
      path === "/api/groups/deleted"
        ? Response.json({
          groups: [{
            id: farGroupId,
            name: "Old trip",
            role: 4,
            deletedAt: "2026-10-01T00:00:00Z",
          }],
        })
        : notesList())

    const html = await (await get(fetch, "/groups")).text()

    expect(html).toContain("Old trip")
    expect(html).toContain(`action="/groups/${farGroupId}/restore"`)
  })

  it("restores through POST and shows the groups page", async () => {
    const { calls, fetch } = notesApi(groupId, () => Response.json({ group: {} }))

    const response = await appWith(fetch)(formPost(`/groups/${farGroupId}/restore`, {}), info)

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe("/groups")
    expect(calls.filter((call) => call.path.endsWith("/restore"))).toEqual([
      { method: "POST", path: `/api/groups/${farGroupId}/restore`, body: null },
    ])
  })

  it("shows why a restore was refused on the groups page", async () => {
    const { fetch } = notesApi(
      groupId,
      (_path, method) =>
        method === "POST" ? refusal(404, "GROUP_NOT_FOUND", "Group not found") : notesList(),
    )

    const response = await appWith(fetch)(formPost(`/groups/${farGroupId}/restore`, {}), info)

    expect(response.status).toBe(404)
    expect(await response.text()).toContain("Group not found")
  })

  it("answers 404 for a group the person does not belong to", async () => {
    const { fetch } = notesApi(groupId, () => Response.json({ error: {} }, { status: 404 }))

    const response = await get(fetch, `/groups/${farGroupId}`)

    expect(response.status).toBe(404)
    expect(await response.text()).toContain("This group does not exist.")
  })
})

describe("the e-mail page", () => {
  const unproven = { email: "ann@example.com", proven: false, pending: null }
  /** A signed-in person whose address waits for its code; `rest` answers every other path. */
  const emailApi = (rest: (path: string) => Response = () => Response.json({ success: true })) =>
    fakeApi((path) => {
      if (path === "/api/auth/me") return Response.json({ firstName: "Ann", lastName: "", mfa: 1 })
      if (path === "/api/auth/email") return Response.json(unproven)
      if (path === "/api/push/devices") return Response.json({ data: [] })
      return rest(path)
    })

  it("shows the code banner on the profile page while the address waits for it", async () => {
    const { fetch } = emailApi()

    const response = await appWith(fetch)(new Request(`${config.webAppOrigin}/`), info)
    const html = await response.text()

    expect(html).toContain(`data-e2e="email-banner"`)
    expect(html).toContain(`href="/email"`)
    expect(html).toContain("ann@example.com")
  })

  it("shows a message, not a server error, when the address cannot be read", async () => {
    const { fetch } = fakeApi((path) => {
      if (path === "/api/auth/me") return Response.json({ firstName: "Ann", lastName: "", mfa: 1 })
      if (path === "/api/auth/email") return Response.json({ error: "down" }, { status: 503 })
      return Response.json({ data: [] })
    })

    const response = await appWith(fetch)(new Request(`${config.webAppOrigin}/email`), info)

    expect(response.status).toBe(502)
    expect(await response.text()).toContain(EMAIL_FAILURES.load)
  })

  it("sends a signed-out visitor to sign-in, which returns to the e-mail page", async () => {
    const { fetch } = fakeApi(() => Response.json({ error: "User not signed in" }, { status: 401 }))

    const response = await appWith(fetch)(new Request(`${config.webAppOrigin}/email`), info)

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe("/sign-in?next=%2Femail")
  })

  it("sends the code with the API's field name and hands the browser a new session cookie", async () => {
    const { calls, fetch } = emailApi(() =>
      Response.json({ success: true }, { headers: { "set-cookie": "sessionIdToken=new; Path=/" } })
    )

    const response = await appWith(fetch)(formPost("/email/verify", { code: "Ab3_x-9Q" }), info)

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe("/email")
    expect(response.headers.getSetCookie()).toEqual(["sessionIdToken=new; Path=/"])
    expect(calls.find((call) => call.path === "/api/auth/email/verify")?.body).toEqual({
      code: "Ab3_x-9Q",
    })
  })

  it("shows a refused code with the API's message, status and Retry-After", async () => {
    const { fetch } = emailApi(() =>
      Response.json({ error: "Too many wrong codes, try again later." }, {
        status: 429,
        headers: { "retry-after": "900" },
      })
    )

    const response = await appWith(fetch)(formPost("/email/verify", { code: "nope" }), info)

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("900")
    expect(await response.text()).toContain("Too many wrong codes, try again later.")
  })

  it("asks for a new code and says it is on its way", async () => {
    const { calls, fetch } = emailApi(() =>
      Response.json({ success: true, message: "A new code is on its way to ann@example.com." })
    )

    const response = await appWith(fetch)(formPost("/email/send", {}), info)

    expect(response.status).toBe(200)
    expect(await response.text()).toContain("A new code is on its way to ann@example.com.")
    expect(calls.map((call) => call.path)).toContain("/api/auth/email/send")
  })

  it("keeps the typed address of a refused change, but never the password", async () => {
    const { calls, fetch } = emailApi(() =>
      Response.json({ error: "Invalid password" }, { status: 400 })
    )

    const response = await appWith(fetch)(
      formPost("/email/change", { email: "new@example.com", password: "typed-secret-1" }),
      info,
    )
    const html = await response.text()

    expect(response.status).toBe(400)
    expect(html).toContain("Invalid password")
    expect(html).toContain(`value="new@example.com"`)
    expect(html).not.toContain("typed-secret-1")
    expect(calls.find((call) => call.path === "/api/auth/email/change")?.body).toEqual({
      email: "new@example.com",
      password: "typed-secret-1",
    })
  })
})

describe("invitations", () => {
  const token = "A".repeat(43)
  const invitationId = "9c1e4f5a-2b3c-4d5e-8f90-a1b2c3d4e5f6"
  const get = (fetch: typeof globalThis.fetch, path: string) =>
    appWith(fetch)(new Request(`${config.webAppOrigin}${path}`), info)
  const preview = {
    id: invitationId,
    groupId: otherGroupId,
    groupName: "Work",
    inviterName: "Ann",
    role: 2,
    addressed: false,
    forYou: true,
    expiresAt: "2026-10-09T10:00:00.000Z",
  }
  const refusal = (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status })

  it("sends a signed-out visitor to sign-in with the invitation as next", async () => {
    const { calls, fetch } = fakeApi(() =>
      Response.json({ error: "User not signed in" }, { status: 401 })
    )

    const response = await get(fetch, `/invite/${token}`)

    expect(response.status).toBe(303)
    expect(response.headers.get("location"))
      .toBe(`/sign-in?${new URLSearchParams({ next: `/invite/${token}` })}`)
    expect(calls.map((call) => call.path)).not.toContain("/api/invitations/preview")
  })

  it("shows the group, the inviter and the role, and sends no referrer from the page", async () => {
    const { calls, fetch } = notesApi(groupId, () => Response.json({ invitation: preview }))

    const response = await get(fetch, `/invite/${token}`)
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(html).toContain('data-e2e="invitation-group">Work<')
    expect(html).toContain('action="/invite/accept"')
    expect(calls.find((call) => call.path === "/api/invitations/preview")?.body).toEqual({ token })
  })

  it("says why a link no longer works, with the API's status", async () => {
    const { fetch } = notesApi(
      groupId,
      () => refusal(410, "INVITATION_EXPIRED", "This invitation has expired"),
    )

    const response = await get(fetch, `/invite/${token}`)

    expect(response.status).toBe(410)
    expect(await response.text()).toContain("This invitation has expired")
  })

  it("accepts by the token and opens the notes of the group the API selected", async () => {
    const { calls, fetch } = notesApi(groupId, () => Response.json({ groupId: otherGroupId }))

    const response = await appWith(fetch)(formPost("/invite/accept", { token }), info)

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe("/notes")
    expect(calls.find((call) => call.path === "/api/invitations/accept")?.body).toEqual({ token })
  })

  it("shows a refused accept on the invitation page, and one from the list on the groups page", async () => {
    const refused = (path: string) =>
      path === "/api/invitations/accept"
        ? refusal(410, "INVITATION_USED_UP", "This invitation has been used up")
        : path === "/api/invitations/preview"
        ? Response.json({ invitation: preview })
        : path === "/api/invitations/mine"
        ? Response.json({ invitations: [preview] })
        : notesList()
    const { fetch } = notesApi(groupId, refused)

    const byLink = await appWith(fetch)(formPost("/invite/accept", { token }), info)
    const byList = await appWith(fetch)(formPost("/invite/accept", { invitationId }), info)

    expect(byLink.status).toBe(410)
    expect(await byLink.text()).toContain("This invitation has been used up")
    const listed = await byList.text()
    expect(listed).toContain('data-e2e="my-invitations"')
    expect(listed).toContain("This invitation has been used up")
  })

  it("declines and shows the groups page", async () => {
    const { calls, fetch } = notesApi(groupId, () => Response.json({ declined: true }))

    const response = await appWith(fetch)(formPost("/invite/decline", { invitationId }), info)

    expect(response.headers.get("location")).toBe("/groups")
    expect(calls.find((call) => call.path === "/api/invitations/decline")?.body)
      .toEqual({ invitationId })
  })

  const owner = (rest: (path: string, method: string) => Response) =>
    notesApi(groupId, (path, method) => {
      if (path === `/api/groups/${groupId}` && method === "GET") {
        return Response.json({ group: { id: groupId, name: "Trip", role: 4 } })
      }
      if (path === `/api/groups/${groupId}/invitations` && method === "GET") {
        return Response.json({ invitations: [] })
      }
      return rest(path, method)
    })

  it("offers a viewer only in the create form when the group is on the free plan", async () => {
    const billing = (planId: string) => ({
      enabled: true,
      planId,
      status: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialEnd: null,
      notice: null,
      canManage: true,
      subscribed: false,
      hasCustomer: false,
      seatPrice: null,
    })
    const page = async (planId: string) => {
      const { fetch } = owner((path) =>
        path === `/api/groups/${groupId}/billing`
          ? Response.json({ billing: billing(planId) })
          : notesList()
      )
      const html = await (await get(fetch, `/groups/${groupId}`)).text()
      const start = html.indexOf('data-e2e="invitation-role"')
      const select = html.slice(start, html.indexOf("</select>", start))
      return [...select.matchAll(/<option[^>]*value="(\d)"/g)].map((m) => m[1])
    }

    expect(await page("free")).toEqual(["1"])
    expect(await page("pro")).toEqual(["1", "2", "3"])
  })

  it("creates with the form's values and draws the new link once, on the app's own origin", async () => {
    const { calls, fetch } = owner((path, method) =>
      path === `/api/groups/${groupId}/invitations` && method === "POST"
        ? Response.json({ invitation: {}, token, mailSent: false }, { status: 201 })
        : notesList()
    )

    const response = await appWith(fetch)(
      formPost(`/groups/${groupId}/invitations`, {
        role: "2",
        expiresInDays: "3",
        maxUses: "10",
        email: "",
      }),
      info,
    )
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain(`${config.webAppOrigin}/invite/${token}`)
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      role: 2,
      expiresInDays: 3,
      maxUses: 10,
      email: "",
      sendEmail: false,
      acceptSeatPrice: false,
    })
  })

  it("posts the price confirmation of a group billed per member, shows its refusal at the box and keeps the box as posted", async () => {
    const billing = {
      enabled: true,
      planId: "pro",
      status: 2,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialEnd: null,
      notice: null,
      canManage: true,
      subscribed: true,
      hasCustomer: true,
      seatPrice: { seats: 3, amount: 900, currency: "EUR" },
    }
    const { calls, fetch } = owner((path, method) =>
      path === `/api/groups/${groupId}/billing`
        ? Response.json({ billing })
        : method === "POST"
        ? refusal(400, "SEAT_PRICE_NOT_ACCEPTED", "Confirm the higher price")
        : notesList()
    )
    const create = (fields: Record<string, string>) =>
      appWith(fetch)(
        formPost(`/groups/${groupId}/invitations`, {
          role: "2",
          expiresInDays: "3",
          maxUses: "1",
          email: "",
          ...fields,
        }),
        info,
      )

    const refused = await create({})
    const html = await refused.text()
    const ticked = await (await create({ acceptSeatPrice: "true" })).text()
    const box = (page: string) => page.match(/<input[^>]*name="acceptSeatPrice"[^>]*>/)?.[0] ?? ""

    expect(refused.status).toBe(400)
    expect(box(html)).not.toMatch(/\schecked/)
    expect(box(ticked)).toMatch(/\schecked/)
    expect(html).toContain("pays €36.00 instead of €27.00")
    expect(html).toContain(`id="invitation-seat-price-error"`)
    expect(html.match(/Confirm the higher price/g)).toHaveLength(1)
    expect(html).not.toContain(`id="invitation-email-error"`)
    expect(calls.filter((call) => call.method === "POST").map((call) => call.body))
      .toMatchObject([{ acceptSeatPrice: false }, { acceptSeatPrice: true }])
  })

  it("shows a refusal for the price under the form when the group's billing could not be read", async () => {
    const { fetch } = owner((path, method) =>
      path === `/api/groups/${groupId}/billing`
        ? Response.json({ error: { message: "Down" } }, { status: 503 })
        : method === "POST"
        ? refusal(400, "SEAT_PRICE_NOT_ACCEPTED", "Confirm the higher price")
        : notesList()
    )

    const html = await (await appWith(fetch)(
      formPost(`/groups/${groupId}/invitations`, {
        role: "2",
        expiresInDays: "3",
        maxUses: "1",
        email: "",
      }),
      info,
    )).text()

    expect(html).not.toContain(`name="acceptSeatPrice"`)
    expect(html).toContain("Confirm the higher price")
  })

  it("keeps what the person filled in when a create is refused, with the API's message", async () => {
    const { fetch } = owner((_path, method) =>
      method === "POST"
        ? refusal(403, "ROLE_INSUFFICIENT", "An admin can invite viewers and editors only")
        : notesList()
    )

    const response = await appWith(fetch)(
      formPost(`/groups/${groupId}/invitations`, {
        role: "3",
        expiresInDays: "3",
        maxUses: "1",
        email: "friend@example.com",
      }),
      info,
    )
    const html = await response.text()

    expect(response.status).toBe(403)
    expect(html).toContain("An admin can invite viewers and editors only")
    expect(html).toContain('value="friend@example.com"')
    expect(html).not.toContain("invitation-created")
  })

  it("revokes through DELETE and returns to the settings page", async () => {
    const { calls, fetch } = owner(() => Response.json({ revoked: true }))

    const response = await appWith(fetch)(
      formPost(`/groups/${groupId}/invitations/${invitationId}/revoke`, {}),
      info,
    )

    expect(response.headers.get("location")).toBe(`/groups/${groupId}`)
    expect(calls.find((call) => call.method === "DELETE")?.path)
      .toBe(`/api/groups/${groupId}/invitations/${invitationId}`)
  })
})
