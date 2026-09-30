import { type APIRequestContext, expect, type Page, test } from "@playwright/test"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"

const VIEWER = 1

async function cleanup(request: APIRequestContext, username: string): Promise<void> {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, { data: { username } })
  expect.soft(response.status(), await response.text()).toBe(200)
}

async function signUp(request: APIRequestContext, username: string): Promise<void> {
  const response = await request.post(`${apiBase}/api/auth/password/sign-up`, {
    headers,
    data: { username, password },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

async function signIn(page: Page, username: string): Promise<void> {
  await page.goto("/sign-in")
  await page.locator("[data-e2e=auth-form-login]").fill(username)
  await page.locator("[data-e2e=auth-form-password]").fill(password)
  await page.locator("[data-e2e=auth-form-submit]").click()
  await page.waitForURL("/")
  await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
}

/** Creates a shared group as the page's user and makes `member` a viewer of it. */
async function sharedGroup(
  owner: Page,
  request: APIRequestContext,
  name: string,
  member: string,
): Promise<string> {
  const groupId = crypto.randomUUID()
  const created = await owner.request.post(`${apiBase}/api/groups`, {
    headers,
    data: { id: groupId, kind: 2, name },
  })
  expect(created.status(), await created.text()).toBe(201)
  const added = await request.post(`${apiBase}/api/test/add-member`, {
    data: { username: member, groupId, role: VIEWER },
  })
  expect(added.status(), await added.text()).toBe(200)
  return groupId
}

/** Opens a group's notes from the groups page, the way a person gets there. */
async function openNotes(page: Page, groupName: string): Promise<void> {
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", {
    name: "Groups",
  }).click()
  await page.getByRole("link", { name: groupName }).click()
  await expect(page.getByRole("heading", { level: 1, name: `Notes in ${groupName}` }))
    .toBeVisible()
}

test.describe("notes in a shared group", () => {
  test("a note created, edited and deleted by the owner shows in a viewer's open tab without a reload", async ({ browser, request }) => {
    const owner = "e2e_notes_live_owner"
    const member = "e2e_notes_live_viewer"
    const baseURL = test.info().project.use.baseURL
    for (const username of [owner, member]) await cleanup(request, username)
    const ownerContext = await browser.newContext({ baseURL })
    const memberContext = await browser.newContext({ baseURL })
    try {
      for (const username of [owner, member]) await signUp(request, username)
      const ownerPage = await ownerContext.newPage()
      const framesSent: string[] = []
      ownerPage.on("websocket", (socket) => {
        socket.on("framesent", (frame) => framesSent.push(String(frame.payload)))
      })
      await signIn(ownerPage, owner)
      await sharedGroup(ownerPage, request, "Notes team", member)

      // The viewer's tab counts the app's sockets and its page loads, so a reconnect or a reload,
      // which would read the notes on their own, fails the test instead of passing it.
      const memberPage = await memberContext.newPage()
      let memberSockets = 0
      memberPage.on("websocket", (socket) => {
        if (new URL(socket.url()).pathname === "/api/ws") memberSockets++
      })
      let memberLoads = 0
      memberPage.on("load", () => memberLoads++)
      await signIn(memberPage, member)
      await openNotes(memberPage, "Notes team")
      await expect(memberPage.locator("[data-e2e=notes-read-only]")).toBeVisible()
      const memberTitles = memberPage.locator("[data-e2e=note-item-title]")
      await expect(memberPage.getByText("No notes yet.")).toBeVisible()
      // Signing in loads the page again; from here on, nothing may load or connect again.
      const settled = { memberSockets, memberLoads }
      expect(settled.memberSockets).toBeGreaterThan(0)

      await openNotes(ownerPage, "Notes team")
      const ownerTitles = ownerPage.locator("[data-e2e=note-item-title]")

      // Create.
      await ownerPage.locator("[data-e2e=note-new-title]").fill("Groceries")
      await ownerPage.locator("[data-e2e=note-new-body]").fill("milk")
      await ownerPage.locator("[data-e2e=note-create]").click()
      await expect(ownerTitles).toHaveText(["Groceries"])
      await expect(memberTitles).toHaveText(["Groceries"], { timeout: 5_000 })
      await expect(memberPage.locator("[data-e2e=note-item-body]")).toHaveText(["milk"])

      // The create went over the socket, as a command with an idempotency key.
      const command = framesSent.map((payload) => JSON.parse(payload)).find(
        (frame) => frame.kind === "client.command" && frame.name === "note.create",
      )
      expect(command?.idempotencyKey).toBeTruthy()

      // Edit.
      await ownerPage.getByRole("link", { name: "Edit Groceries" }).click()
      await ownerPage.locator("[data-e2e=note-edit-title]").fill("Groceries for Friday")
      await ownerPage.locator("[data-e2e=note-save]").click()
      await expect(ownerTitles).toHaveText(["Groceries for Friday"])
      await expect(memberTitles).toHaveText(["Groceries for Friday"], { timeout: 5_000 })

      // Delete.
      await ownerPage.getByRole("button", { name: "Delete Groceries for Friday" }).click()
      await expect(ownerTitles).toHaveCount(0)
      await expect(memberTitles).toHaveCount(0, { timeout: 5_000 })
      await expect(memberPage.getByText("No notes yet.")).toBeVisible()

      expect({ memberSockets, memberLoads }).toEqual(settled)
    } finally {
      await ownerContext.close()
      await memberContext.close()
      for (const username of [owner, member]) await cleanup(request, username)
    }
  })

  test("a viewer cannot create, edit or delete a note over REST", async ({ browser, request }) => {
    const owner = "e2e_notes_rest_owner"
    const member = "e2e_notes_rest_viewer"
    const baseURL = test.info().project.use.baseURL
    for (const username of [owner, member]) await cleanup(request, username)
    const ownerContext = await browser.newContext({ baseURL })
    const memberContext = await browser.newContext({ baseURL })
    try {
      for (const username of [owner, member]) await signUp(request, username)
      const ownerPage = await ownerContext.newPage()
      await signIn(ownerPage, owner)
      const groupId = await sharedGroup(ownerPage, request, "Read only", member)
      const notes = `${apiBase}/api/groups/${groupId}/notes`
      const noteId = crypto.randomUUID()
      const created = await ownerPage.request.post(notes, {
        headers,
        data: { id: noteId, title: "Owner's note", body: "" },
      })
      expect(created.status(), await created.text()).toBe(201)

      const memberPage = await memberContext.newPage()
      await signIn(memberPage, member)
      const refused = [
        await memberPage.request.post(notes, {
          headers,
          data: { id: crypto.randomUUID(), title: "Mine", body: "" },
        }),
        await memberPage.request.patch(`${notes}/${noteId}`, {
          headers,
          data: { title: "Changed", body: "", version: 1 },
        }),
        await memberPage.request.delete(`${notes}/${noteId}`, { headers, data: { version: 1 } }),
      ]
      for (const response of refused) {
        expect(response.status()).toBe(403)
        expect((await response.json()).error.code).toBe("ROLE_INSUFFICIENT")
      }

      // The viewer still reads it, unchanged.
      const read = await memberPage.request.get(`${notes}/${noteId}`)
      expect(read.status()).toBe(200)
      expect((await read.json()).note).toMatchObject({ title: "Owner's note", version: 1 })
    } finally {
      await ownerContext.close()
      await memberContext.close()
      for (const username of [owner, member]) await cleanup(request, username)
    }
  })
})
