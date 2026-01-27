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
      const signUp = await request.post(`${apiBase}/api/auth/password/sign-up`, {
        data: { username, password },
      })
      expect(signUp.ok()).toBe(true)

      await page.goto("/sign-in")
      await page.locator("[data-e2e=signin-username]").fill(username)
      await page.locator("[data-e2e=signin-password]").fill(password)
      await page.locator("[data-e2e=signin-submit]").click()

      await page.waitForURL("/")
      await page.locator("[data-e2e=ws-status]", { hasText: "open" }).waitFor()

      await page.locator("[data-e2e=profile-first-name]").fill(firstName)
      await page.locator("[data-e2e=profile-last-name]").fill(lastName)
      await page.locator("[data-e2e=profile-save]").click()
      await page.locator("[data-e2e=profile-saved]").waitFor()

      await page.locator("[data-e2e=signout]").click()
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
