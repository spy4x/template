import { type APIRequestContext, expect, type Page, test } from "@playwright/test"

const password = "Passw0rd!"

async function cleanup(request: APIRequestContext, username: string): Promise<void> {
  const response = await request.post("/api/test/cleanup-user", { data: { username } })
  expect.soft(response.status(), await response.text()).toBe(200)
}

async function submitCredentials(page: Page, username: string): Promise<void> {
  await page.locator("[data-e2e=auth-form-login]").fill(username)
  await page.locator("[data-e2e=auth-form-password]").fill(password)
  await page.locator("[data-e2e=auth-form-submit]").click()
}

// The point of the MPA: every page and action works without a single script.
test.use({ javaScriptEnabled: false })

test("a person without JavaScript signs up, signs out, signs in, picks a group and manages its notes", async ({ page, request }) => {
  await page.goto("data:text/html,<title>before</title><script>document.title = 'ran'</script>")
  await expect(page, "the browser runs no script").toHaveTitle("before")

  const username = `mpa-${crypto.randomUUID().slice(0, 8)}`
  await cleanup(request, username)
  try {
    await page.goto("/sign-up")
    await submitCredentials(page, username)
    await expect(page).toHaveURL("/")
    await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible()

    await page.locator("[data-e2e=signout]").click()
    await expect(page).toHaveURL("/sign-in")
    await page.goto("/groups")
    await expect(page, "a signed-out visitor is sent to sign in").toHaveURL("/sign-in")

    await submitCredentials(page, username)
    await expect(page).toHaveURL("/")

    await page.getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Groups" }).click()
    await expect(page.getByRole("button", { name: "Open notes in Personal" })).toBeVisible()
    await page.locator("[data-e2e=group-name]").fill("Trip")
    await page.locator("[data-e2e=group-create]").click()
    await expect(page).toHaveURL("/groups")
    await page.getByRole("button", { name: "Open notes in Trip" }).click()
    await expect(page).toHaveURL("/notes")
    await expect(page.getByRole("heading", { level: 1, name: "Notes in Trip" })).toBeVisible()
    await expect(page.getByText("No notes yet.")).toBeVisible()

    await page.locator("[data-e2e=note-new-title]").fill("Packing")
    await page.locator("[data-e2e=note-new-body]").fill("Tent and stove")
    await page.locator("[data-e2e=note-create]").click()
    const list = page.locator("[data-e2e=note-list]")
    await expect(list.locator("[data-e2e=note-item-title]")).toHaveText(["Packing"])
    await expect(list.locator("[data-e2e=note-item-body]")).toHaveText(["Tent and stove"])

    await page.getByRole("link", { name: "Edit Packing" }).click()
    await page.locator("[data-e2e=note-edit-title]").fill("Packing list")
    await page.locator("[data-e2e=note-save]").click()
    await expect(page.getByRole("heading", { level: 1, name: "Notes in Trip" })).toBeVisible()
    await expect(list.locator("[data-e2e=note-item-title]")).toHaveText(["Packing list"])

    await page.getByRole("button", { name: "Delete Packing list" }).click()
    await expect(page.getByText("No notes yet.")).toBeVisible()

    // The side menu's picker is a form: pick the personal group and press Switch.
    await page.locator("#sidebar-group-picker").selectOption({ label: "Personal · Owner" })
    await page.locator("form[action='/groups/select']:visible [data-e2e=group-picker-submit]")
      .click()
    await expect(page).toHaveURL("/notes")
    await expect(page.getByRole("heading", { level: 1, name: "Notes in Personal" }))
      .toBeVisible()
  } finally {
    await cleanup(request, username)
  }
})

test("a form another site posts to an action is refused, sign-out included", async ({ request }) => {
  for (const action of ["/sign-out", "/sign-in", "/groups"]) {
    const response = await request.post(action, {
      headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
      form: { username: "someone", password },
    })
    expect(response.status(), action).toBe(403)
  }
})
