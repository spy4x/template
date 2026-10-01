import { expect, test } from "@playwright/test"
import { gotoApp } from "./fixtures/app.ts"

const apiBase = "http://app.localhost"
const STEP_SECONDS = 30
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

/** The one-time code (RFC 6238: SHA-1, six digits, 30-second steps) for `secret` at `step`. */
async function totpCode(secret: string, step: number): Promise<string> {
  let bits = ""
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    bits += BASE32.indexOf(char).toString(2).padStart(5, "0")
  }
  const key = new Uint8Array((bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)))
  const counter = new Uint8Array(8)
  new DataView(counter.buffer).setBigUint64(0, BigInt(step))
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  )
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, counter))
  const offset = hmac[hmac.length - 1] & 0x0f
  const value = new DataView(hmac.buffer).getUint32(offset) & 0x7fffffff
  return String(value % 1_000_000).padStart(6, "0")
}

const currentStep = () => Math.floor(Date.now() / 1000 / STEP_SECONDS)

test.describe("two-factor sign-in", () => {
  test("signs in with a one-time code after the password step", async ({ page, request }) => {
    const email = "e2e_two_factor_user@example.com"
    const password = "Passw0rd!"
    const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }

    // The route answers 200 also when the user does not exist yet; anything else fails the spec.
    // `soft` in `finally`: a failed cleanup is reported next to the spec's own error, not over it.
    const cleanup = async ({ soft = false } = {}) => {
      const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
        data: { login: email },
      })
      ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
    }

    await cleanup()
    try {
      const signUp = await page.request.post(`${apiBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      })
      expect(signUp.ok()).toBe(true)

      // Turn two-factor auth on through the profile screen and read the secret it shows.
      // Without an authenticator app the page offers Enable only, never Disable next to it.
      await gotoApp(page, "/", page.locator("[data-e2e=totp-start]"))
      await expect(page.locator("[data-e2e=totp-disable]")).toHaveCount(0)
      await page.locator("[data-e2e=totp-start]").click()
      const shown = await page.getByText(/^Secret: /).innerText()
      const secret = shown.replace("Secret: ", "").trim()
      const enrolStep = currentStep()
      await page.locator("[data-e2e=totp-connect-otp]").fill(await totpCode(secret, enrolStep))
      await page.locator("[data-e2e=totp-connect-finish]").click()
      await page.locator("[data-e2e=totp-connect-finish]").waitFor({ state: "detached" })
      // Once the app is connected the page offers Disable only.
      await expect(page.locator("[data-e2e=totp-disable]")).toBeVisible()
      await expect(page.locator("[data-e2e=totp-start]")).toHaveCount(0)

      await page.locator("[data-e2e=shell-user-menu-button]").click()
      await page.getByRole("menuitem", { name: "Sign out" }).click()
      await page.locator("[data-e2e=signin-required]").waitFor()

      // Password step: the app reloads onto the code screen, which must still ask for the code.
      await gotoApp(page, "/sign-in", page.locator("[data-e2e=auth-form-login]"))
      await page.locator("[data-e2e=auth-form-login]").fill(email)
      await page.locator("[data-e2e=auth-form-password]").fill(password)
      await page.locator("[data-e2e=auth-form-submit]").click()
      await page.waitForURL("**/totp")
      await page.goto("/")
      await expect(page.getByRole("heading", { level: 1, name: "Finish MFA" })).toBeVisible()
      await page.goto("/totp")
      await expect(page.locator("[data-e2e=auth-form-code]")).toBeVisible()
      await expect(page.getByRole("heading", { level: 1, name: "MFA not required" }))
        .toHaveCount(0)

      // A code for the step the enrolment used is refused as a replay, so use a later step. The
      // server accepts one step ahead.
      const step = Math.max(currentStep(), enrolStep + 1)
      await page.locator("[data-e2e=auth-form-code]").fill(await totpCode(secret, step))
      await page.locator("[data-e2e=auth-form-submit]").click()
      await page.waitForURL((url) => url.pathname === "/")

      await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible()
      const me = await page.request.get("/api/auth/me")
      expect(me.status()).toBe(200)
    } finally {
      await cleanup({ soft: true })
    }
  })
})
