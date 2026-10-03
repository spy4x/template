import { type APIRequestContext, expect, type Page, test } from "@playwright/test"

const password = "Passw0rd!"

async function cleanup(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post("/api/test/cleanup-user", { data: { login: email } })
  expect.soft(response.status(), await response.text()).toBe(200)
}

async function addNote(page: Page, title: string): Promise<void> {
  await page.locator("[data-e2e=note-new]").click()
  await page.locator("[data-e2e=note-title]").fill(title)
  await page.locator("[data-e2e=note-save]").click()
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/)
  await page.locator("[data-e2e=note-back]").click()
  await expect(page).toHaveURL("/notes")
}

// The point of the MPA: every page and action works without a single script.
test.use({ javaScriptEnabled: false })

test("a person without JavaScript moves a note from its page and ticked notes from the list", async ({ page, request }) => {
  const email = `mpa-${crypto.randomUUID().slice(0, 8)}@example.com`
  await cleanup(request, email)
  try {
    await page.goto("/sign-up")
    await page.locator("[data-e2e=auth-form-login]").fill(email)
    await page.locator("[data-e2e=auth-form-password]").fill(password)
    await page.locator("[data-e2e=auth-form-submit]").click()
    await expect(page).toHaveURL("/")

    await page.goto("/groups")
    await page.locator("[data-e2e=group-name]").fill("Target")
    await page.locator("[data-e2e=group-create]").click()
    await expect(page).toHaveURL("/groups")
    await page.getByRole("button", { name: "Open notes in Personal" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Notes in Personal" })).toBeVisible()
    for (const title of ["One", "Two", "Three"]) await addNote(page, title)
    const titles = page.locator("[data-e2e=note-item-title]")
    await expect(titles).toHaveCount(3)

    // One note, from its page: the person returns to the list, which no longer has it.
    await page.getByRole("link", { name: "One", exact: true }).click()
    await page.locator("[data-e2e=note-move-to]").selectOption({ label: "Target" })
    await page.locator("[data-e2e=note-move]").click()
    await expect(page).toHaveURL("/notes")
    await expect(titles).toHaveCount(2)
    await expect(page.getByRole("link", { name: "One", exact: true })).toHaveCount(0)

    // Nothing ticked: the page says so and moves nothing.
    await page.locator("[data-e2e=notes-move-submit]").click()
    await expect(page.getByText("Tick the notes you want to move.")).toBeVisible()
    await expect(titles).toHaveCount(2)

    // Ticked notes, from the list.
    await page.getByLabel("Tick Two").check()
    await page.getByLabel("Tick Three").check()
    await page.locator("[data-e2e=notes-move-to]").selectOption({ label: "Target" })
    await page.locator("[data-e2e=notes-move-submit]").click()
    await expect(page).toHaveURL("/notes")
    await expect(page.getByText("No notes yet.")).toBeVisible()

    await page.goto("/groups")
    await page.getByRole("button", { name: "Open notes in Target" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Notes in Target" })).toBeVisible()
    await expect(titles).toHaveCount(3)
  } finally {
    await cleanup(request, email)
  }
})
