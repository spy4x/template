import { type APIRequestContext, type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"

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

/** A group of the signed-in person with one note in it. */
async function groupWithNote(page: Page, name: string, title: string, body: string) {
  const groupId = uuidV7()
  const noteId = uuidV7()
  const group = await page.request.post(`${apiBase}/api/groups`, {
    headers,
    data: { id: groupId, name },
  })
  expect(group.status(), await group.text()).toBe(201)
  const note = await page.request.post(`${apiBase}/api/groups/${groupId}/notes`, {
    headers,
    data: { id: noteId, title, body },
  })
  expect(note.status(), await note.text()).toBe(201)
  return { groupId, noteId }
}

/** Opens `groupId`'s notes, online, with the app and the group's notes saved on the device. */
async function openNotes(page: Page, groupId: string, title: string): Promise<void> {
  const selected = await page.request.put(`${apiBase}/api/groups/selected`, {
    headers,
    data: { groupId },
  })
  expect(selected.ok(), await selected.text()).toBe(true)
  await gotoApp(page, "/notes", page.locator("[data-e2e=shell-ws-status]"))
  await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  // One more load under the worker's control, so everything the page needs is cached.
  await gotoApp(page, page.url(), page.locator("[data-e2e=note-list]"))
  await expect(page.locator("[data-e2e=note-item-title]").filter({ hasText: title })).toHaveCount(1)
}

const palette = (page: Page) => page.locator("[data-e2e=search]")
const field = (page: Page) => palette(page).getByRole("combobox")
const result = (page: Page, label: string) =>
  palette(page).getByRole("option").filter({ hasText: label })

test.describe("search", () => {
  // Each spec signs up, loads the app twice so the service worker holds it, and one goes offline.
  test.describe.configure({ timeout: 60_000 })

  test("Ctrl+K opens the search, and picking a note of another group opens it in that group", async ({ browser, request }) => {
    const user = "e2e_search_online@example.com"
    await cleanup(request, user)
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      await signUp(request, user)
      const page = await context.newPage()
      await signIn(page, user, password)
      const roadmap = await groupWithNote(
        page,
        "Product team",
        "Quarterly roadmap",
        "Kickoff with the design team",
      )
      const garden = await groupWithNote(
        page,
        "Side project",
        "Garden notes",
        "Tomatoes by the fence",
      )
      await openNotes(page, roadmap.groupId, "Quarterly roadmap")

      await page.keyboard.press("Control+k")
      await expect(field(page)).toBeFocused()
      await field(page).fill("tomato")
      await expect(result(page, "Garden notes")).toContainText("Side project")
      await expect(palette(page).getByRole("group").first()).toContainText("Notes")
      await page.keyboard.press("Enter")

      await expect(page).toHaveURL(new RegExp(`/notes/${garden.noteId}$`))
      await expect(page.locator("[data-e2e=note-title]")).toHaveValue("Garden notes")
      await expect(page.locator("[data-e2e=group-picker]")).toContainText("Side project")
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })

  test("offline, the search looks through the notes on this device and says so", async ({ browser, request }) => {
    const user = "e2e_search_offline@example.com"
    await cleanup(request, user)
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      await signUp(request, user)
      const page = await context.newPage()
      await signIn(page, user, password)
      const { groupId } = await groupWithNote(page, "Field trip", "Packing list", "Rain jacket")
      await openNotes(page, groupId, "Packing list")

      await context.setOffline(true)
      await page.reload()
      await expect(page.locator("[data-e2e=shell-ws-status]")).not.toHaveText("Online")

      await page.locator("[data-e2e=search-open]").click()
      await field(page).fill("jacket")
      await expect(palette(page).getByRole("group").first()).toContainText("Notes on this device")
      await expect(result(page, "Packing list")).toBeVisible()

      await field(page).fill("snorkel")
      await expect(palette(page).getByRole("status")).toHaveText(
        "Nothing on this device matches “snorkel”. Search again when you are back online.",
      )
      await context.setOffline(false)
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })
})
