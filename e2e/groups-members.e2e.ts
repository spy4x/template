import { type APIRequestContext, type Browser, type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"

/** Removes `email`'s account; `soft` only records a failure, for the `finally` of a test. */
async function cleanup(request: APIRequestContext, email: string, { soft = false } = {}) {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
}

async function signUp(request: APIRequestContext, email: string) {
  const response = await request.post(`${apiBase}/api/auth/password/sign-up`, {
    headers,
    data: { email, password },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

/** A signed-in page in its own browser context, so two people use the app side by side. */
async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const page = await context.newPage()
  await signIn(page, email, password)
  await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
  return page
}

/** Creates a group as the person signed in on `page` and adds `member` to it with `role`. */
async function teamWith(
  page: Page,
  request: APIRequestContext,
  member: string,
  role: number,
): Promise<string> {
  const groupId = crypto.randomUUID()
  const created = await page.request.post(`${apiBase}/api/groups`, {
    headers,
    data: { id: groupId, name: "Team" },
  })
  expect(created.status(), await created.text()).toBe(201)
  const added = await request.post(`${apiBase}/api/test/add-member`, {
    data: { login: member, groupId, role },
  })
  expect(added.status(), await added.text()).toBe(200)
  return groupId
}

const settingsReady = (page: Page) => page.locator("[data-e2e=group-general-name]")

test.describe("group members", () => {
  test("the owner demotes and then removes a member, and the member's open page follows without a reload", async ({ page, browser, request }) => {
    const owner = "e2e_members_owner@example.com"
    const member = "e2e_members_member@example.com"
    await cleanup(request, owner)
    await cleanup(request, member)
    let memberPage: Page | null = null
    try {
      await signUp(request, owner)
      await signUp(request, member)
      await signIn(page, owner, password)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
      const groupId = await teamWith(page, request, member, 2)

      memberPage = await personPage(browser, member)
      await gotoApp(memberPage, `/groups/${groupId}`, settingsReady(memberPage))
      await expect(memberPage.locator("[data-e2e=group-general-role]")).toHaveText("Editor")
      // An editor reads the members but has no control over them.
      await expect(memberPage.locator("[data-e2e=group-member]")).toHaveCount(2)
      await expect(memberPage.locator("[data-e2e=group-member-role-select]")).toHaveCount(0)
      // Mark the page, so a reload would show as a missing mark.
      await memberPage.evaluate(() => Object.assign(globalThis, { notReloaded: true }))

      await gotoApp(page, `/groups/${groupId}`, settingsReady(page))
      const row = page.locator("[data-e2e=group-member]").filter({ hasText: member })
      await row.getByLabel(`Role of ${member}`).selectOption({ label: "Viewer" })
      await row.getByRole("button", { name: "Change role" }).click()
      await expect(row.locator("[data-e2e=group-member-role]")).toHaveText("Viewer")

      await expect(memberPage.locator("[data-e2e=group-general-role]")).toHaveText("Viewer")
      await expect(memberPage.locator(`[data-user-id] [data-e2e=group-member-role]`).last())
        .toHaveText("Viewer")

      await row.getByText(`Remove ${member}...`).click()
      await row.getByRole("button", { name: "Remove member" }).click()
      await expect(page.locator("[data-e2e=group-member]")).toHaveCount(1)

      await expect(memberPage.getByText("This group does not exist.")).toBeVisible()
      expect(await memberPage.evaluate(() => "notReloaded" in globalThis)).toBe(true)
      const refused = await memberPage.request.get(`${apiBase}/api/groups/${groupId}/members`)
      expect(refused.status()).toBe(404)
    } finally {
      await memberPage?.context().close()
      await cleanup(request, owner, { soft: true })
      await cleanup(request, member, { soft: true })
    }
  })

  test("a member leaves a group, and the owner has no way to leave it", async ({ page, browser, request }) => {
    const owner = "e2e_members_leave_owner@example.com"
    const member = "e2e_members_leave_member@example.com"
    await cleanup(request, owner)
    await cleanup(request, member)
    let memberPage: Page | null = null
    try {
      await signUp(request, owner)
      await signUp(request, member)
      await signIn(page, owner, password)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
      const groupId = await teamWith(page, request, member, 1)

      await gotoApp(page, `/groups/${groupId}`, settingsReady(page))
      await expect(page.locator("[data-e2e=group-leave-why]"))
        .toHaveText("You own this group, so you cannot leave it.")
      await expect(page.locator("[data-e2e=group-leave]")).toHaveCount(0)

      memberPage = await personPage(browser, member)
      await gotoApp(memberPage, `/groups/${groupId}`, settingsReady(memberPage))
      await memberPage.getByText("Leave this group...").click()
      await expect(memberPage.locator("[data-e2e=group-leave-confirmation]"))
        .toContainText('Leave "Team"?')
      await memberPage.getByRole("button", { name: "Leave group" }).click()
      await expect(memberPage).toHaveURL("/groups")
      await expect(memberPage.locator("[data-e2e=group-item-name]")).toHaveText(["Personal"])

      await expect(page.locator("[data-e2e=group-member]")).toHaveCount(1)
    } finally {
      await memberPage?.context().close()
      await cleanup(request, owner, { soft: true })
      await cleanup(request, member, { soft: true })
    }
  })

  test("the groups list shows each group's members as an avatar stack", async ({ page, request }) => {
    const owner = "e2e_members_stack_owner@example.com"
    const member = "e2e_members_stack_member@example.com"
    await cleanup(request, owner)
    await cleanup(request, member)
    try {
      await signUp(request, owner)
      await signUp(request, member)
      await signIn(page, owner, password)
      await teamWith(page, request, member, 1)

      const heading = page.getByRole("heading", { level: 1, name: "Groups" })
      await gotoApp(page, "/groups", heading)
      await expect(page.getByLabel("Members of Team (2)")).toBeVisible()
      await expect(page.getByLabel("Members of Personal (1)")).toBeVisible()
    } finally {
      await cleanup(request, owner, { soft: true })
      await cleanup(request, member, { soft: true })
    }
  })
})
