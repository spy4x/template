import { expect, test } from "@playwright/test"

const apiBase = "http://app.localhost"

test.describe("auth profile ws push flow", () => {
  test("sign-up sign-in profile ws sign-out", async ({ page, request }) => {
    const username = "e2e_auth_profile_user"
    const password = "Passw0rd!"
    const firstName = "John"
    const lastName = "Doe"

    const cleanup = async () => {
      try {
        await request.post(`${apiBase}/api/test/cleanup-user`, {
          data: { username },
        })
      } catch (_error) {
        // ignore
      }
    }

    await cleanup()
    try {
      // The API refuses a mutation without the headers a browser sends from the app's own page.
      const signUp = await request.post(`${apiBase}/api/auth/password/sign-up`, {
        headers: { origin: apiBase, "sec-fetch-site": "same-origin" },
        data: { username, password },
      })
      expect(signUp.ok()).toBe(true)

      await page.goto("/sign-in")
      await page.locator("[data-e2e=signin-username]").fill(username)
      await page.locator("[data-e2e=signin-password]").fill(password)
      await page.locator("[data-e2e=signin-submit]").click()

      await page.waitForURL("/")
      await page.locator("[data-e2e=ws-status]", { hasText: "open" }).waitFor()

      // The signed-in layout: the skip link is the first thing Tab reaches, and the navigation
      // marks the page you are on as the current one.
      await page.keyboard.press("Tab")
      await expect(page.locator("[data-e2e=shell-skip-link]")).toBeFocused()
      const nav = page.getByRole("navigation", { name: "Main navigation" })
      await expect(nav.getByRole("link", { name: "Profile" })).toHaveAttribute(
        "aria-current",
        "page",
      )

      // Nav links go through the router: a click keeps the page instead of reloading it, and a
      // Ctrl-click (Cmd on macOS) is left to the browser, which opens the link in a new tab.
      await page.evaluate(() => Object.assign(globalThis, { e2ePageMarker: true }))
      await nav.getByRole("link", { name: "Profile" }).click()
      await page.locator("[data-e2e=ws-status]", { hasText: "open" }).waitFor()
      expect(await page.evaluate(() => "e2ePageMarker" in globalThis)).toBe(true)
      const newTab = page.context().waitForEvent("page", { timeout: 5_000 })
      await nav.getByRole("link", { name: "Profile" }).click({ modifiers: ["ControlOrMeta"] })
      await (await newTab).close()

      await page.locator("[data-e2e=profile-first-name]").fill(firstName)
      await page.locator("[data-e2e=profile-last-name]").fill(lastName)
      await page.locator("[data-e2e=profile-save]").click()
      await page.locator("[data-e2e=profile-saved]").waitFor()

      await page.locator("[data-e2e=shell-user-menu-button]").click()
      await page.getByRole("menuitem", { name: "Sign out" }).click()
      await page.locator("[data-e2e=signin-required]").waitFor()

      const me = await page.request.get("/api/auth/me")
      expect(me.status()).toBe(401)
    } finally {
      await cleanup()
    }
  })

  test("push endpoints require auth", async ({ request }) => {
    const devices = await request.get(`${apiBase}/api/push/devices`)
    expect(devices.status()).toBe(401)

    const publicKey = await request.get(`${apiBase}/api/push/public-key`)
    expect(publicKey.status()).toBe(401)
  })
})
