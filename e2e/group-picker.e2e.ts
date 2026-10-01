import { type APIRequestContext, expect, type Page, test } from "@playwright/test"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const SHARED_GROUP = 2

async function cleanup(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect.soft(response.status(), await response.text()).toBe(200)
}

async function signUp(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post(`${apiBase}/api/auth/password/sign-up`, {
    headers,
    data: { email, password },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in")
  await page.locator("[data-e2e=auth-form-login]").fill(email)
  await page.locator("[data-e2e=auth-form-password]").fill(password)
  await page.locator("[data-e2e=auth-form-submit]").click()
  await page.waitForURL("/")
  await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
}

/** One group of the person's, with a note in it. */
async function noteIn(page: Page, groupId: string, title: string): Promise<void> {
  const note = await page.request.post(`${apiBase}/api/groups/${groupId}/notes`, {
    headers,
    data: { id: crypto.randomUUID(), title, body: "" },
  })
  expect(note.status(), await note.text()).toBe(201)
}

async function sharedGroup(page: Page, name: string): Promise<string> {
  const id = crypto.randomUUID()
  const created = await page.request.post(`${apiBase}/api/groups`, {
    headers,
    data: { id, kind: SHARED_GROUP, name },
  })
  expect(created.status(), await created.text()).toBe(201)
  return id
}

async function personalGroup(page: Page): Promise<{ id: string; name: string }> {
  const list = await page.request.get(`${apiBase}/api/groups`)
  const groups: { id: string; kind: number; name: string }[] = (await list.json()).groups
  const personal = groups.find((group) => group.kind === 1)
  expect(personal, "a new user has a personal group").toBeDefined()
  return personal!
}

const heading = (page: Page, name: string) =>
  page.getByRole("heading", { level: 1, name: `Notes in ${name}` })

/** Picks a group from the side menu's picker with the keyboard alone: type, then Enter. */
async function pickWithKeyboard(page: Page, groupName: string): Promise<void> {
  const picker = page.locator("#sidebar-group-picker")
  await picker.focus()
  await page.keyboard.press("ArrowDown")
  await expect(page.getByRole("option", { name: new RegExp(groupName) })).toBeVisible()
  await page.keyboard.type(groupName)
  await page.keyboard.press("Enter")
}

test.describe("notes at /notes with a group picker", () => {
  test("/notes shows only the selected group's notes, and the picker switches groups with the keyboard alone", async ({ browser, request }) => {
    const user = "e2e_picker_keyboard@example.com"
    await cleanup(request, user)
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      await signUp(request, user)
      const page = await context.newPage()
      await signIn(page, user)
      const personal = await personalGroup(page)
      const team = await sharedGroup(page, "Team B")
      await noteIn(page, personal.id, "Only in personal")
      await noteIn(page, team, "Only in team")

      await page.goto("/notes")
      await expect(heading(page, personal.name)).toBeVisible()
      const titles = page.locator("[data-e2e=note-item-title]")
      await expect(titles).toHaveText(["Only in personal"])

      await pickWithKeyboard(page, "Team B")
      await expect(heading(page, "Team B")).toBeVisible()
      await expect(titles).toHaveText(["Only in team"])
      await expect(page).toHaveURL("/notes")

      // The choice is the server's: it survives a reload.
      await page.reload()
      await expect(heading(page, "Team B")).toBeVisible()
      await expect(titles).toHaveText(["Only in team"])

      // The cog next to the picker opens the groups page, by keyboard.
      await page.getByRole("link", { name: "Manage groups" }).first().focus()
      await page.keyboard.press("Enter")
      await expect(page).toHaveURL("/groups")
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })

  test("a group chosen on one device moves the person's other device, without a reload", async ({ browser, request }) => {
    const user = "e2e_picker_devices@example.com"
    await cleanup(request, user)
    const baseURL = test.info().project.use.baseURL
    const laptopContext = await browser.newContext({ baseURL })
    const phoneContext = await browser.newContext({ baseURL })
    try {
      await signUp(request, user)
      const laptop = await laptopContext.newPage()
      const phone = await phoneContext.newPage()
      await signIn(laptop, user)
      await signIn(phone, user)
      const personal = await personalGroup(laptop)
      const team = await sharedGroup(laptop, "Shared view")
      await noteIn(laptop, team, "Seen on both")

      await laptop.goto("/notes")
      await phone.goto("/notes")
      await expect(heading(phone, personal.name)).toBeVisible()
      await expect(phone.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
      let phoneLoads = 0
      phone.on("load", () => phoneLoads++)

      await pickWithKeyboard(laptop, "Shared view")

      await expect(heading(phone, "Shared view")).toBeVisible({ timeout: 15_000 })
      await expect(phone.locator("[data-e2e=note-item-title]")).toHaveText(["Seen on both"])
      expect(phoneLoads, "the other device learns it over the socket, without a page load")
        .toBe(0)
    } finally {
      await laptopContext.close()
      await phoneContext.close()
      await cleanup(request, user)
    }
  })

  test("an old /groups/:groupId/notes link opens /notes for the selected group and /groups for any other, and selects nothing", async ({ browser, request }) => {
    const user = "e2e_picker_redirect@example.com"
    await cleanup(request, user)
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      await signUp(request, user)
      const page = await context.newPage()
      await signIn(page, user)
      const personal = await personalGroup(page)
      const team = await sharedGroup(page, "Old link team")
      await noteIn(page, personal.id, "In the selected group")

      await page.goto(`/groups/${personal.id}/notes`)
      await expect(page).toHaveURL("/notes")
      await expect(heading(page, personal.name)).toBeVisible()

      // A link to a group that is not selected must not select it.
      await page.goto(`/groups/${team}/notes`)
      await expect(page).toHaveURL("/groups")
      const selected = await page.request.get(`${apiBase}/api/groups/selected`)
      expect((await selected.json()).groupId).toBe(personal.id)
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })

  test("a group the person cannot see cannot be selected, and the server keeps their current one", async ({ browser, request }) => {
    const user = "e2e_picker_refused@example.com"
    await cleanup(request, user)
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      await signUp(request, user)
      const page = await context.newPage()
      await signIn(page, user)
      const personal = await personalGroup(page)

      const refused = await page.request.put(`${apiBase}/api/groups/selected`, {
        headers,
        data: { groupId: crypto.randomUUID() },
      })
      expect(refused.status()).toBe(404)
      const selected = await page.request.get(`${apiBase}/api/groups/selected`)
      expect((await selected.json()).groupId).toBe(personal.id)
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })
})
