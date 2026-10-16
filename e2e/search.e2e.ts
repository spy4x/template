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

/** Opens `groupId`'s notes online; the page saves them on the device as it lists them. */
async function openNotes(page: Page, groupId: string, title: string): Promise<void> {
  const selected = await page.request.put(`${apiBase}/api/groups/selected`, {
    headers,
    data: { groupId },
  })
  expect(selected.ok(), await selected.text()).toBe(true)
  await gotoApp(page, "/notes", page.locator("[data-e2e=shell-ws-status]"))
  await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
  await expect(page.locator("[data-e2e=note-item-title]").filter({ hasText: title })).toHaveCount(1)
}

const palette = (page: Page) => page.locator("[data-e2e=search]")
const field = (page: Page) => palette(page).getByRole("combobox")
const result = (page: Page, label: string) =>
  palette(page).getByRole("option").filter({ hasText: label })

test.describe("search", () => {
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
})
