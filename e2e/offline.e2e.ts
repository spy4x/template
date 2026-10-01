import {
  type APIRequestContext,
  type BrowserContext,
  expect,
  type Page,
  test,
} from "@playwright/test"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const SHARED_GROUP = 2

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

/** The user's own group with one note in it. */
async function groupWithNote(page: Page, name: string, title: string) {
  const groupId = crypto.randomUUID()
  const noteId = crypto.randomUUID()
  const group = await page.request.post(`${apiBase}/api/groups`, {
    headers,
    data: { id: groupId, kind: SHARED_GROUP, name },
  })
  expect(group.status(), await group.text()).toBe(201)
  const note = await page.request.post(`${apiBase}/api/groups/${groupId}/notes`, {
    headers,
    data: { id: noteId, title, body: "" },
  })
  expect(note.status(), await note.text()).toBe(201)
  return { groupId, noteId }
}

/** Opens a group's notes, then makes sure the service worker holds the app before going offline. */
async function openNotesAndCacheShell(page: Page, groupId: string): Promise<void> {
  const selected = await page.request.put(`${apiBase}/api/groups/selected`, {
    headers,
    data: { groupId },
  })
  expect(selected.ok(), await selected.text()).toBe(true)
  await page.goto("/notes")
  await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  // One more load under the worker's control, so everything the page needs is cached.
  await page.reload()
  await expect(page.locator("[data-e2e=note-list]")).toBeVisible()
}

/** Goes offline and loads the page again: the app must start from the cache alone. */
async function reloadOffline(context: BrowserContext, page: Page): Promise<void> {
  await context.setOffline(true)
  await page.reload()
  await expect(page.locator("[data-e2e=shell-ws-status]")).not.toHaveText("Online")
}

async function serverNotes(page: Page, groupId: string): Promise<{ title: string }[]> {
  const response = await page.request.get(`${apiBase}/api/groups/${groupId}/notes`)
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json()).notes
}

test.describe("offline notes", () => {
  test("a person with no network opens the app, reads notes, adds one, and it syncs when the network is back", async ({ browser, request }) => {
    const user = "e2e_offline_writer"
    await cleanup(request, user)
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      await signUp(request, user)
      const page = await context.newPage()
      await signIn(page, user)
      const { groupId } = await groupWithNote(page, "Offline team", "Written online")
      await openNotesAndCacheShell(page, groupId)

      // The worker caches the app's files, never the API's answers or the socket route.
      const cachedPaths = async () =>
        await page.evaluate(async () => {
          const paths: string[] = []
          for (const name of await caches.keys()) {
            for (const request of await (await caches.open(name)).keys()) {
              paths.push(new URL(request.url).pathname)
            }
          }
          return paths
        })
      await expect.poll(cachedPaths).toContain("/")
      expect((await cachedPaths()).filter((path) => /^\/(api|ws)(\/|$)/.test(path))).toEqual([])

      await reloadOffline(context, page)
      const titles = page.locator("[data-e2e=note-item-title]")
      await expect(titles).toHaveText(["Written online"])

      await page.locator("[data-e2e=note-new-title]").fill("Written offline")
      await page.locator("[data-e2e=note-new-body]").fill("no network here")
      await page.locator("[data-e2e=note-create]").click()
      await expect(titles).toHaveText(["Written offline", "Written online"])
      await expect(page.locator("[data-e2e=offline-pending]")).toHaveText(
        "1 change is waiting to sync.",
      )

      await context.setOffline(false)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online", {
        timeout: 20_000,
      })
      await expect(page.locator("[data-e2e=offline-pending]")).toHaveCount(0)
      await expect.poll(async () => (await serverNotes(page, groupId)).map((n) => n.title))
        .toEqual(["Written offline", "Written online"])

      // Still there after a fresh load.
      await page.reload()
      await expect(titles).toHaveText(["Written offline", "Written online"])
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })

  test("a person with no network switches between groups already on the device, and the server learns the choice when the network is back", async ({ browser, request }) => {
    const user = "e2e_offline_picker"
    await cleanup(request, user)
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      await signUp(request, user)
      const page = await context.newPage()
      await signIn(page, user)
      const first = await groupWithNote(page, "Offline first", "In the first")
      const second = await groupWithNote(page, "Offline second", "In the second")
      // Open both online so their notes are in the local store.
      await openNotesAndCacheShell(page, second.groupId)
      await openNotesAndCacheShell(page, first.groupId)
      const titles = page.locator("[data-e2e=note-item-title]")
      await expect(titles).toHaveText(["In the first"])

      await reloadOffline(context, page)
      await expect(titles).toHaveText(["In the first"])
      const picker = page.locator("#sidebar-group-picker")
      await picker.focus()
      await page.keyboard.press("ArrowDown")
      await page.keyboard.type("Offline second")
      await page.keyboard.press("Enter")
      await expect(page.getByRole("heading", { level: 1, name: "Notes in Offline second" }))
        .toBeVisible()
      await expect(titles).toHaveText(["In the second"])

      await context.setOffline(false)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online", {
        timeout: 20_000,
      })
      await expect.poll(async () => {
        const response = await page.request.get(`${apiBase}/api/groups/selected`)
        return (await response.json()).groupId
      }).toBe(second.groupId)
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })

  test("two devices editing the same note offline end with one visible conflict and no lost edit", async ({ browser, request }) => {
    // Two browsers, two offline reloads and a 20 s wait for sync: 28 s on main, which is too close to 30 s.
    test.setTimeout(60_000)
    const user = "e2e_offline_pair"
    await cleanup(request, user)
    const baseURL = test.info().project.use.baseURL
    const contextA = await browser.newContext({ baseURL })
    const contextB = await browser.newContext({ baseURL })
    try {
      await signUp(request, user)
      const a = await contextA.newPage()
      const b = await contextB.newPage()
      await signIn(a, user)
      await signIn(b, user)
      const { groupId } = await groupWithNote(a, "Pair team", "Shared note")
      for (const page of [a, b]) await openNotesAndCacheShell(page, groupId)
      await reloadOffline(contextA, a)
      await reloadOffline(contextB, b)

      for (const [page, title] of [[a, "Edited on A"], [b, "Edited on B"]] as const) {
        await page.getByRole("link", { name: "Edit Shared note" }).click()
        await page.locator("[data-e2e=note-edit-title]").fill(title)
        await page.locator("[data-e2e=note-save]").click()
        await expect(page.locator("[data-e2e=note-item-title]")).toHaveText([title])
        await expect(page.locator("[data-e2e=offline-pending]")).toBeVisible()
      }

      // Device A reconnects first: its edit reaches the server.
      await contextA.setOffline(false)
      await expect(a.locator("[data-e2e=offline-pending]")).toHaveCount(0, { timeout: 20_000 })
      await expect.poll(async () => (await serverNotes(a, groupId)).map((n) => n.title))
        .toEqual(["Edited on A"])

      // Device B reconnects second: its edit is not applied over A's, and it is not dropped.
      await contextB.setOffline(false)
      const conflict = b.locator("[data-e2e=note-sync-conflict]")
      await expect(conflict).toHaveCount(1, { timeout: 20_000 })
      await expect(conflict.locator("[data-e2e=conflict-mine]")).toContainText("Edited on B")
      await expect(conflict.locator("[data-e2e=conflict-theirs]")).toContainText("Edited on A")
      expect((await serverNotes(a, groupId)).map((n) => n.title)).toEqual(["Edited on A"])

      // Keeping mine sends B's text on top of A's.
      await conflict.locator("[data-e2e=conflict-keep-mine]").click()
      await expect(conflict).toHaveCount(0)
      await expect.poll(async () => (await serverNotes(a, groupId)).map((n) => n.title))
        .toEqual(["Edited on B"])
    } finally {
      await contextA.close()
      await contextB.close()
      await cleanup(request, user)
    }
  })

  test("choosing the server's version drops the offline edit and shows the server's note", async ({ browser, request }) => {
    // Two browsers, two offline reloads and a 20 s wait for sync: 28 s on main, which is too close to 30 s.
    test.setTimeout(60_000)
    const user = "e2e_offline_theirs"
    await cleanup(request, user)
    const baseURL = test.info().project.use.baseURL
    const contextA = await browser.newContext({ baseURL })
    const contextB = await browser.newContext({ baseURL })
    try {
      await signUp(request, user)
      const a = await contextA.newPage()
      const b = await contextB.newPage()
      await signIn(a, user)
      await signIn(b, user)
      const { groupId, noteId } = await groupWithNote(a, "Theirs team", "Shared note")
      for (const page of [a, b]) await openNotesAndCacheShell(page, groupId)
      await reloadOffline(contextB, b)

      await b.getByRole("link", { name: "Edit Shared note" }).click()
      await b.locator("[data-e2e=note-edit-title]").fill("Edited on B")
      await b.locator("[data-e2e=note-save]").click()

      // Device A, online, changes the note first.
      const changed = await a.request.patch(`${apiBase}/api/groups/${groupId}/notes/${noteId}`, {
        headers,
        data: { title: "Edited on A", body: "", version: 1 },
      })
      expect(changed.status(), await changed.text()).toBe(200)

      await contextB.setOffline(false)
      const conflict = b.locator("[data-e2e=note-sync-conflict]")
      await expect(conflict).toHaveCount(1, { timeout: 20_000 })
      await conflict.locator("[data-e2e=conflict-use-theirs]").click()
      await expect(conflict).toHaveCount(0)
      await expect(b.locator("[data-e2e=note-item-title]")).toHaveText(["Edited on A"])
      expect((await serverNotes(a, groupId)).map((n) => n.title)).toEqual(["Edited on A"])
    } finally {
      await contextA.close()
      await contextB.close()
      await cleanup(request, user)
    }
  })
})
