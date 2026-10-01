import { type APIRequestContext, expect, type Page, test } from "@playwright/test"

const password = "Passw0rd!"

async function cleanup(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post("/api/test/cleanup-user", { data: { login: email } })
  expect.soft(response.status(), await response.text()).toBe(200)
}

async function submitCredentials(page: Page, email: string): Promise<void> {
  await page.locator("[data-e2e=auth-form-login]").fill(email)
  await page.locator("[data-e2e=auth-form-password]").fill(password)
  await page.locator("[data-e2e=auth-form-submit]").click()
}

// The point of the MPA: every page and action works without a single script.
test.use({ javaScriptEnabled: false })

test("a person without JavaScript signs up, signs out, signs in, picks a group and manages its notes", async ({ page, request }) => {
  await page.goto("data:text/html,<title>before</title><script>document.title = 'ran'</script>")
  await expect(page, "the browser runs no script").toHaveTitle("before")

  const email = `mpa-${crypto.randomUUID().slice(0, 8)}@example.com`
  await cleanup(request, email)
  try {
    await page.goto("/sign-up")
    await submitCredentials(page, email)
    await expect(page).toHaveURL("/")
    await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible()

    await page.locator("[data-e2e=signout]").click()
    await expect(page).toHaveURL("/sign-in")
    await page.goto("/groups")
    await expect(page, "a signed-out visitor is sent to sign in").toHaveURL("/sign-in")

    await submitCredentials(page, email)
    await expect(page).toHaveURL("/")

    await page.getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Groups" }).click()
    await expect(page.getByRole("button", { name: "Open notes in Personal" })).toBeVisible()
    await page.locator("[data-e2e=group-name]").fill("Trip")
    await page.locator("[data-e2e=group-create]").click()
    await expect(page).toHaveURL("/groups")
    await page.getByRole("link", { name: "Settings of Trip" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Trip" })).toBeVisible()
    await expect(page.locator("[data-e2e=group-general-role]")).toHaveText("Owner")

    // Rename, delete and restore are plain forms: each one posts and the server redirects.
    await page.getByLabel("New name").fill("Trip 2027")
    await page.getByRole("button", { name: "Rename" }).click()
    await expect(page.locator("[data-e2e=group-general-name]")).toHaveText("Trip 2027")
    await page.getByText("Delete this group...").click()
    await page.getByRole("button", { name: "Delete group" }).click()
    await expect(page).toHaveURL("/groups")
    await expect(page.locator("[data-e2e=deleted-group-name]")).toHaveText(["Trip 2027"])
    await page.getByRole("button", { name: "Restore Trip 2027" }).click()
    await expect(page).toHaveURL("/groups")
    await expect(page.locator("[data-e2e=deleted-group-list]")).toHaveCount(0)
    await page.getByRole("link", { name: "Settings of Trip 2027" }).click()
    await page.getByLabel("New name").fill("Trip")
    await page.getByRole("button", { name: "Rename" }).click()
    await expect(page.locator("[data-e2e=group-general-name]")).toHaveText("Trip")
    await page.getByRole("link", { name: "Back to groups" }).click()
    await expect(page).toHaveURL("/groups")
    await page.getByRole("button", { name: "Open notes in Trip" }).click()
    await expect(page).toHaveURL("/notes")
    await expect(page.getByRole("heading", { level: 1, name: "Notes in Trip" })).toBeVisible()
    await expect(page.getByText("No notes yet.")).toBeVisible()

    // Create: the list links to a page of its own, whose form posts and lands on the note's page.
    await page.locator("[data-e2e=note-new]").click()
    await expect(page).toHaveURL("/notes/new")
    await expect(page.getByRole("heading", { level: 1, name: "New note" })).toBeVisible()
    await page.locator("[data-e2e=note-title]").fill("Packing")
    await page.locator("[data-e2e=note-body]").fill("Tent and stove")
    await page.locator("[data-e2e=note-save]").click()
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/)
    await expect(page.getByRole("heading", { level: 1, name: "Edit note" })).toBeVisible()
    await expect(page.locator("[data-e2e=note-title]")).toHaveValue("Packing")
    const notePath = new URL(page.url()).pathname

    await page.locator("[data-e2e=note-back]").click()
    await expect(page).toHaveURL("/notes")
    const list = page.locator("[data-e2e=note-list]")
    await expect(list.locator("[data-e2e=note-item-title]")).toHaveText(["Packing"])
    await expect(list.locator("[data-e2e=note-item-body]")).toHaveText(["Tent and stove"])

    // Edit: save returns to the list.
    await page.getByRole("link", { name: "Packing" }).click()
    await expect(page).toHaveURL(notePath)
    await page.locator("[data-e2e=note-title]").fill("Packing list")
    await page.locator("[data-e2e=note-save]").click()
    await expect(page).toHaveURL("/notes")
    await expect(list.locator("[data-e2e=note-item-title]")).toHaveText(["Packing list"])

    // Delete asks on a page of its own; keeping the note leaves it.
    await page.getByRole("link", { name: "Packing list" }).click()
    await page.locator("[data-e2e=note-delete]").click()
    await expect(page).toHaveURL(`${notePath}/delete`)
    await expect(page.getByRole("heading", { level: 1, name: "Delete this note?" })).toBeVisible()
    await page.getByRole("link", { name: "Keep it" }).click()
    await expect(page).toHaveURL(notePath)
    await page.locator("[data-e2e=note-delete]").click()
    await page.locator("[data-e2e=note-delete-confirm]").click()
    await expect(page).toHaveURL("/notes")
    await expect(page.getByText("No notes yet.")).toBeVisible()

    // A note that is gone is "not found", not an error page.
    await page.goto(notePath)
    await expect(page.getByRole("heading", { level: 1, name: "Note not found" })).toBeVisible()

    // The side menu's picker is a form: pick the personal group and press Switch.
    await page.locator("#sidebar-group-picker").selectOption({ label: "Personal · Owner" })
    await page.locator("form[action='/groups/select']:visible [data-e2e=group-picker-submit]")
      .click()
    await expect(page).toHaveURL("/notes")
    await expect(page.getByRole("heading", { level: 1, name: "Notes in Personal" }))
      .toBeVisible()
  } finally {
    await cleanup(request, email)
  }
})

test("a viewer without JavaScript reads a note as text, with no form and no way to add one", async ({ browser, request }) => {
  const owner = `mpa-${crypto.randomUUID().slice(0, 8)}@example.com`
  const viewer = `mpa-${crypto.randomUUID().slice(0, 8)}@example.com`
  const baseURL = test.info().project.use.baseURL
  const ownerContext = await browser.newContext({ baseURL, javaScriptEnabled: false })
  const viewerContext = await browser.newContext({ baseURL, javaScriptEnabled: false })
  try {
    for (const username of [owner, viewer]) await cleanup(request, username)
    const ownerPage = await ownerContext.newPage()
    await ownerPage.goto("/sign-up")
    await submitCredentials(ownerPage, owner)
    await expect(ownerPage).toHaveURL("/")
    await ownerPage.goto("/groups")
    await ownerPage.locator("[data-e2e=group-name]").fill("Read only")
    await ownerPage.locator("[data-e2e=group-create]").click()
    await ownerPage.getByRole("button", { name: "Open notes in Read only" }).click()
    await ownerPage.locator("[data-e2e=note-new]").click()
    await ownerPage.locator("[data-e2e=note-title]").fill("Owner's note")
    await ownerPage.locator("[data-e2e=note-body]").fill("Only the owner writes")
    await ownerPage.locator("[data-e2e=note-save]").click()
    await expect(ownerPage).toHaveURL(/\/notes\/[0-9a-f-]{36}$/)
    const notePath = new URL(ownerPage.url()).pathname

    const groups = await (await ownerPage.request.get("/api/groups")).json()
    const groupId = groups.groups.find((group: { name: string }) => group.name === "Read only").id
    const viewerPage = await viewerContext.newPage()
    await viewerPage.goto("/sign-up")
    await submitCredentials(viewerPage, viewer)
    await expect(viewerPage).toHaveURL("/")
    const added = await request.post("/api/test/add-member", {
      data: { login: viewer, groupId, role: 1 },
    })
    expect(added.status(), await added.text()).toBe(200)

    await viewerPage.goto("/groups")
    await viewerPage.getByRole("button", { name: "Open notes in Read only" }).click()
    await expect(viewerPage.locator("[data-e2e=note-new]")).toHaveCount(0)
    await viewerPage.getByRole("link", { name: "Owner's note" }).click()
    await expect(viewerPage).toHaveURL(notePath)
    await expect(viewerPage.locator("[data-e2e=note-read-only]")).toBeVisible()
    await expect(viewerPage.locator("[data-e2e=note-read-body]")).toHaveText(
      "Only the owner writes",
    )
    await expect(
      viewerPage.locator(
        "form[action^='/notes'], [data-e2e=note-save], [data-e2e=note-delete]",
      ),
    )
      .toHaveCount(0)

    await viewerPage.goto("/notes/new")
    await expect(viewerPage.getByText("Only an editor can add notes to this group.")).toBeVisible()
    await expect(viewerPage.locator("[data-e2e=note-save]")).toHaveCount(0)
  } finally {
    await ownerContext.close()
    await viewerContext.close()
    for (const username of [owner, viewer]) await cleanup(request, username)
  }
})

test("a form another site posts to an action is refused, sign-out included", async ({ request }) => {
  for (const action of ["/sign-out", "/sign-in", "/groups"]) {
    const response = await request.post(action, {
      headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
      form: { login: "someone@example.com", password },
    })
    expect(response.status(), action).toBe(403)
  }
})
