import { expect, test } from "@playwright/test"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }

test.describe("group list and settings pages", () => {
  test("creates a group, opens its settings and reads its name and the person's role there", async ({ page, request }) => {
    const email = "e2e_groups_pages_user@example.com"
    const password = "Passw0rd!"
    const cleanup = async ({ soft = false } = {}) => {
      const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
        data: { login: email },
      })
      ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
    }

    await cleanup()
    try {
      const signUp = await request.post(`${apiBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      })
      expect(signUp.ok()).toBe(true)
      await page.goto("/sign-in")
      await page.locator("[data-e2e=auth-form-login]").fill(email)
      await page.locator("[data-e2e=auth-form-password]").fill(password)
      await page.locator("[data-e2e=auth-form-submit]").click()
      await page.waitForURL("/")
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")

      await page.getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Groups" }).click()
      await expect(page.getByRole("heading", { level: 1, name: "Groups" })).toBeVisible()
      await expect(page.locator("[data-e2e=group-item-name]")).toHaveCount(1)

      await page.locator("[data-e2e=group-name]").fill("Trip")
      await page.getByRole("button", { name: "New group" }).click()
      await expect(page.locator("[data-e2e=group-item-name]").filter({ hasText: "Trip" }))
        .toHaveCount(1)

      await page.getByRole("link", { name: "Settings of Trip" }).click()
      await expect(page).toHaveURL(/\/groups\/[0-9a-f-]{36}$/)
      await expect(page.getByRole("heading", { level: 1, name: "Trip" })).toBeVisible()
      await expect(page.getByRole("heading", { level: 2, name: "General" })).toBeVisible()
      await expect(page.locator("[data-e2e=group-general-name]")).toHaveText("Trip")
      await expect(page.locator("[data-e2e=group-general-role]")).toHaveText("Owner")

      await page.getByRole("link", { name: "Back to groups" }).click()
      await expect(page).toHaveURL("/groups")
      await page.getByRole("button", { name: "Open notes in Trip" }).click()
      await expect(page).toHaveURL("/notes")
    } finally {
      await cleanup({ soft: true })
    }
  })

  test("neither page scrolls sideways at 375 px", async ({ page, request }) => {
    const email = "e2e_groups_pages_narrow@example.com"
    const password = "Passw0rd!"
    const cleanup = async ({ soft = false } = {}) => {
      const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
        data: { login: email },
      })
      ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
    }

    await cleanup()
    try {
      const signUp = await request.post(`${apiBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      })
      expect(signUp.ok()).toBe(true)
      await page.setViewportSize({ width: 375, height: 812 })
      await page.goto("/sign-in")
      await page.locator("[data-e2e=auth-form-login]").fill(email)
      await page.locator("[data-e2e=auth-form-password]").fill(password)
      await page.locator("[data-e2e=auth-form-submit]").click()
      await page.waitForURL("/")
      const longName = "A group with a very long name that must wrap and never push the page wider"
      const created = await page.request.post(`${apiBase}/api/groups`, {
        headers,
        data: { id: crypto.randomUUID(), kind: 2, name: longName },
      })
      expect(created.status(), await created.text()).toBe(201)

      const overflow = () =>
        page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth
        )
      await page.goto("/groups")
      await expect(page.getByRole("heading", { level: 1, name: "Groups" })).toBeVisible()
      await expect(page.locator("[data-e2e=group-item-name]").filter({ hasText: "A group" }))
        .toBeVisible()
      expect(await overflow()).toBeLessThanOrEqual(0)

      await page.getByRole("link", { name: `Settings of ${longName}` }).click()
      await expect(page.getByRole("heading", { level: 2, name: "General" })).toBeVisible()
      expect(await overflow()).toBeLessThanOrEqual(0)
    } finally {
      await cleanup({ soft: true })
    }
  })
})
