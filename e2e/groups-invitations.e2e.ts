import { type APIRequestContext, type Page } from "@playwright/test"
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

const settingsReady = (page: Page) => page.locator("[data-e2e=group-general-name]")

test.describe("group invitations", () => {
  test("an admin creates a link that a signed-out person follows, signs in and accepts with its role", async ({ page, browser, request }) => {
    const id = crypto.randomUUID().slice(0, 8)
    const owner = `e2e-invite-owner-${id}@example.com`
    const admin = `e2e-invite-admin-${id}@example.com`
    const invitee = `e2e-invite-guest-${id}@example.com`
    for (const email of [owner, admin, invitee]) await cleanup(request, email)
    let inviteePage: Page | null = null
    try {
      // The owner makes the group through the API; the admin is the one who invites.
      await signUp(request, owner)
      const groupId = crypto.randomUUID()
      const created = await request.post(`${apiBase}/api/groups`, {
        headers,
        data: { id: groupId, name: "Team" },
      })
      expect(created.status(), await created.text()).toBe(201)
      await signUp(request, admin)
      await signUp(request, invitee)
      const added = await request.post(`${apiBase}/api/test/add-member`, {
        data: { login: admin, groupId, role: 3 },
      })
      expect(added.status(), await added.text()).toBe(200)

      await signIn(page, admin, password)
      await gotoApp(page, `/groups/${groupId}`, settingsReady(page))
      const section = page.locator("[data-e2e=group-section-invitations]")
      // An admin invites at most editors.
      await expect(section.locator("[data-e2e=invitation-role] option")).toHaveText([
        "Viewer",
        "Editor",
      ])
      await section.locator("[data-e2e=invitation-role]").selectOption({ label: "Editor" })
      await section.locator("[data-e2e=invitation-uses]").fill("2")
      await section.locator("[data-e2e=invitation-create]").click()
      const link = await section.locator("[data-e2e=invitation-created] code").textContent()
      expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/)
      await expect(section.locator("[data-e2e=invitation]")).toHaveCount(1)
      const invitePath = new URL(link!).pathname

      const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
      inviteePage = await context.newPage()
      await gotoApp(inviteePage, invitePath, inviteePage.locator("[data-e2e=auth-form-login]"))
      await expect(inviteePage).toHaveURL(`/sign-in?${new URLSearchParams({ next: invitePath })}`)
      await inviteePage.locator("[data-e2e=auth-form-login]").fill(invitee)
      await inviteePage.locator("[data-e2e=auth-form-password]").fill(password)
      const card = inviteePage.locator("[data-e2e=invitation-card]")
      await gotoApp(inviteePage, invitePath, card, async () => {
        await inviteePage!.locator("[data-e2e=auth-form-submit]").click()
        await inviteePage!.waitForURL(invitePath)
      })
      await expect(card.locator("[data-e2e=invitation-group]")).toHaveText("Team")
      await expect(card).toContainText("Editor")

      await card.locator("[data-e2e=invitation-accept]").click()
      await expect(inviteePage).toHaveURL("/notes")
      await gotoApp(inviteePage, `/groups/${groupId}`, settingsReady(inviteePage))
      await expect(inviteePage.locator("[data-e2e=group-general-role]")).toHaveText("Editor")

      await gotoApp(page, `/groups/${groupId}`, settingsReady(page))
      await expect(page.locator("[data-e2e=group-member]")).toHaveCount(3)
      await expect(page.locator("[data-e2e=invitation]")).toContainText("used 1 of 2")
    } finally {
      await inviteePage?.context().close()
      for (const email of [owner, admin, invitee]) await cleanup(request, email, { soft: true })
    }
  })
})
