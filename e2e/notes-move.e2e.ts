import { type APIRequestContext, type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { signIn } from "./fixtures/app.ts"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"

const VIEWER = 1

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

async function signInOnline(page: Page, email: string): Promise<void> {
  await signIn(page, email, password)
  await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
}

async function openNotes(page: Page, groupName: string): Promise<void> {
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", {
    name: "Groups",
  }).click()
  await page.getByRole("button", { name: `Open notes in ${groupName}` }).click()
  await expect(page.getByRole("heading", { level: 1, name: `Notes in ${groupName}` }))
    .toBeVisible()
}

test.describe("moving notes to another group", () => {
  test("moves a note from its page and ticked notes from the list, and members of both groups see it live", async ({ browser, request }) => {
    const owner = "e2e_notes_move_owner@example.com"
    const inSource = "e2e_notes_move_source@example.com"
    const inTarget = "e2e_notes_move_target@example.com"
    const baseURL = test.info().project.use.baseURL
    const emails = [owner, inSource, inTarget]
    for (const email of emails) await cleanup(request, email)
    const contexts = await Promise.all(emails.map(() => browser.newContext({ baseURL })))
    try {
      for (const email of emails) await signUp(request, email)
      const [ownerPage, sourcePage, targetPage] = await Promise.all(
        contexts.map((context) => context.newPage()),
      )
      const framesSent: string[] = []
      ownerPage.on("websocket", (socket) => {
        socket.on("framesent", (frame) => framesSent.push(String(frame.payload)))
      })
      await signInOnline(ownerPage, owner)

      const groups = { Source: crypto.randomUUID(), Target: crypto.randomUUID() }
      for (const [name, id] of Object.entries(groups)) {
        const created = await ownerPage.request.post(`${apiBase}/api/groups`, {
          headers,
          data: { id, name },
        })
        expect(created.status(), await created.text()).toBe(201)
      }
      for (const [member, groupId] of [[inSource, groups.Source], [inTarget, groups.Target]]) {
        const added = await request.post(`${apiBase}/api/test/add-member`, {
          data: { login: member, groupId, role: VIEWER },
        })
        expect(added.status(), await added.text()).toBe(200)
      }
      for (const title of ["One", "Two", "Three"]) {
        const created = await ownerPage.request.post(
          `${apiBase}/api/groups/${groups.Source}/notes`,
          { headers, data: { id: crypto.randomUUID(), title, body: "" } },
        )
        expect(created.status(), await created.text()).toBe(201)
      }

      await signInOnline(sourcePage, inSource)
      await openNotes(sourcePage, "Source")
      await signInOnline(targetPage, inTarget)
      await openNotes(targetPage, "Target")
      const sourceTitles = sourcePage.locator("[data-e2e=note-item-title]")
      const targetTitles = targetPage.locator("[data-e2e=note-item-title]")
      await expect(sourceTitles).toHaveCount(3)
      await expect(targetPage.getByText("No notes yet.")).toBeVisible()

      await openNotes(ownerPage, "Source")
      const ownerTitles = ownerPage.locator("[data-e2e=note-item-title]")

      // One note, from its own page: the person lands on the list, which no longer has it.
      await ownerPage.getByRole("link", { name: "One", exact: true }).click()
      await ownerPage.locator("[data-e2e=note-move-to]").selectOption({ label: "Target" })
      await ownerPage.locator("[data-e2e=note-move]").click()
      await expect(ownerPage).toHaveURL("/notes")
      await expect(ownerTitles).toHaveCount(2)
      await expect(ownerPage.getByRole("link", { name: "One", exact: true })).toHaveCount(0)
      await expect(sourceTitles).toHaveCount(2, { timeout: 5_000 })
      await expect(targetTitles).toHaveText(["One"], { timeout: 5_000 })

      // The move went over the socket, as one command with an idempotency key.
      const single = framesSent.map((payload) => JSON.parse(payload)).find(
        (frame) => frame.kind === "client.command" && frame.name === "note.move",
      )
      expect(single?.idempotencyKey).toBeTruthy()
      expect(single?.payload.noteIds).toHaveLength(1)

      // Ticked notes, from the list: all of them or none.
      await ownerPage.getByLabel("Tick Two").check()
      await ownerPage.getByLabel("Tick Three").check()
      await ownerPage.locator("[data-e2e=notes-move-to]").selectOption({ label: "Target" })
      await ownerPage.locator("[data-e2e=notes-move-submit]").click()
      await expect(ownerPage.getByText("No notes yet.")).toBeVisible()
      await expect(targetTitles).toHaveCount(3, { timeout: 5_000 })
      await expect(sourcePage.getByText("No notes yet.")).toBeVisible({ timeout: 5_000 })

      // Nothing ticked: a message, and nothing moves.
      await ownerPage.getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Groups" }).click()
      await ownerPage.getByRole("button", { name: "Open notes in Target" }).click()
      await expect(ownerTitles).toHaveCount(3)
      await ownerPage.locator("[data-e2e=notes-move-submit]").click()
      await expect(ownerPage.getByText("Tick the notes you want to move.")).toBeVisible()
      await expect(ownerTitles).toHaveCount(3)
    } finally {
      for (const context of contexts) await context.close()
      for (const email of emails) await cleanup(request, email)
    }
  })
})
