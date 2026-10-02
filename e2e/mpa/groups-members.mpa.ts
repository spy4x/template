import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test"
import { BILLING_WEBHOOK_PATH, proWebhook } from "../fixtures/billing.ts"

const password = "Passw0rd!"

async function cleanup(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post("/api/test/cleanup-user", { data: { login: email } })
  expect.soft(response.status(), await response.text()).toBe(200)
}

/** Signs up `email` in a browser context of its own, with no JavaScript, and returns its page. */
async function signedUp(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    javaScriptEnabled: false,
  })
  const page = await context.newPage()
  await page.goto("/sign-up")
  await page.locator("[data-e2e=auth-form-login]").fill(email)
  await page.locator("[data-e2e=auth-form-password]").fill(password)
  await page.locator("[data-e2e=auth-form-submit]").click()
  await expect(page).toHaveURL("/")
  return page
}

test("without JavaScript, the owner changes a member's role and removes them, and a member leaves", async ({ browser, request }) => {
  const owner = `mpa-${crypto.randomUUID().slice(0, 8)}@example.com`
  const editor = `mpa-${crypto.randomUUID().slice(0, 8)}@example.com`
  const viewer = `mpa-${crypto.randomUUID().slice(0, 8)}@example.com`
  const pages: Page[] = []
  try {
    for (const email of [owner, editor, viewer]) await cleanup(request, email)
    const ownerPage = await signedUp(browser, owner)
    const editorPage = await signedUp(browser, editor)
    const viewerPage = await signedUp(browser, viewer)
    pages.push(ownerPage, editorPage, viewerPage)

    await ownerPage.goto("/groups")
    await ownerPage.locator("[data-e2e=group-name]").fill("Crew")
    await ownerPage.locator("[data-e2e=group-create]").click()
    const groups = await (await ownerPage.request.get("/api/groups")).json()
    const groupId = groups.groups.find((group: { name: string }) => group.name === "Crew").id
    for (const [login, role] of [[editor, 2], [viewer, 1]] as const) {
      const added = await request.post("/api/test/add-member", { data: { login, groupId, role } })
      expect(added.status(), await added.text()).toBe(200)
    }
    // Promoting a member is a paid feature: the free plan refuses it (plan-limits.mpa.ts).
    const upgraded = await request.post(BILLING_WEBHOOK_PATH, await proWebhook(groupId))
    expect(upgraded.status(), await upgraded.text()).toBe(200)

    await ownerPage.goto(`/groups/${groupId}`)
    await expect(ownerPage.locator("[data-e2e=group-member]")).toHaveCount(3)
    const editorRow = ownerPage.locator("[data-e2e=group-member]").filter({ hasText: editor })
    await editorRow.getByLabel(`Role of ${editor}`).selectOption({ label: "Admin" })
    await editorRow.getByRole("button", { name: "Change role" }).click()
    await expect(ownerPage).toHaveURL(`/groups/${groupId}`)
    await expect(editorRow.locator("[data-e2e=group-member-role]")).toHaveText("Admin")

    await editorRow.getByText(`Remove ${editor}...`).click()
    await editorRow.getByRole("button", { name: "Remove member" }).click()
    await expect(ownerPage).toHaveURL(`/groups/${groupId}`)
    await expect(ownerPage.locator("[data-e2e=group-member]")).toHaveCount(2)
    await editorPage.goto(`/groups/${groupId}`)
    await expect(editorPage.getByText("This group does not exist.")).toBeVisible()

    await viewerPage.goto(`/groups/${groupId}`)
    await expect(viewerPage.locator("[data-e2e=group-member-role-select]")).toHaveCount(0)
    await viewerPage.getByText("Leave this group...").click()
    await viewerPage.getByRole("button", { name: "Leave group" }).click()
    await expect(viewerPage).toHaveURL("/groups")
    await expect(viewerPage.locator("[data-e2e=group-item-name]")).toHaveText(["Personal"])

    await ownerPage.goto(`/groups/${groupId}`)
    await expect(ownerPage.locator("[data-e2e=group-member]")).toHaveCount(1)
    await expect(ownerPage.locator("[data-e2e=group-leave-why]"))
      .toHaveText("You own this group, so you cannot leave it.")
  } finally {
    for (const page of pages) await page.context().close()
    for (const email of [owner, editor, viewer]) await cleanup(request, email)
  }
})
