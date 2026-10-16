import type { APIRequestContext, BrowserContext, Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"

/**
 * Display preferences follow the person to every device (#163): a theme picked on the laptop paints
 * the phone dark, and a time zone saved on the laptop shows on the phone without a reload. The
 * laptop, now in another zone than the one picked, offers to switch back.
 */

const appBase = "http://app.localhost"
const headers = { origin: appBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"

async function cleanup(request: APIRequestContext, email: string) {
  const response = await request.post(`${appBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect.soft(response.status(), await response.text()).toBe(200)
}

/** Signs the person in on a device of its own and opens the profile page. */
async function openProfile(device: BrowserContext, email: string): Promise<Page> {
  const page = await device.newPage()
  await signIn(page, email, password)
  await page.getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Profile" }).click()
  await expect(page.locator("[data-e2e=preferences]")).toBeVisible()
  return page
}

test.describe("preferences across devices", () => {
  test("a theme and a time zone picked on one device show on the other", async ({ browser, request }) => {
    const email = `e2e-preferences-${uuidV7().slice(-8)}@example.com`
    let laptop: BrowserContext | null = null
    let phone: BrowserContext | null = null
    try {
      const signUp = await request.post(`${appBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      })
      expect(signUp.ok(), await signUp.text()).toBe(true)

      laptop = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "en-GB" })
      phone = await browser.newContext({ timezoneId: "Asia/Tokyo", locale: "en-GB" })
      const onLaptop = await openProfile(laptop, email)
      const onPhone = await openProfile(phone, email)
      await expect(onPhone.locator("[data-e2e=preferences-time-zone]")).toContainText(
        "Automatic: same as this device (Tokyo, Asia",
      )

      // The theme changes at once from its row's menu, here and on the other device.
      await onLaptop.getByRole("button", { name: "Change theme" }).click()
      await onLaptop.locator("[data-e2e=preferences-theme-dark]").click()
      await expect(onLaptop.locator("html")).toHaveClass(/\bdark\b/)
      await expect(onPhone.locator("html")).toHaveClass(/\bdark\b/)
      await expect(onPhone.locator("[data-e2e=preferences-theme]")).toContainText("Dark")

      // A zone saved in the dialog on the laptop shows on the phone without a reload.
      await onLaptop.locator("[data-e2e=preferences-change-timeZone]").click()
      const zone = onLaptop.getByRole("combobox", { name: "Time zone" })
      await expect(zone).toBeFocused()
      await zone.fill("Tokyo")
      await onLaptop.getByRole("option", { name: /^Tokyo, Asia/ }).click()
      await onLaptop.locator("[data-e2e=preferences-save]").click()
      await expect(onLaptop.locator("[data-e2e=preferences-dialog]")).toBeHidden()
      await expect(onPhone.locator("[data-e2e=preferences-time-zone]")).toContainText(
        "Tokyo, Asia · GMT+9",
      )
      await expect(onPhone.locator("[data-e2e=preferences-time-zone]")).not.toContainText(
        "Automatic",
      )

      // The laptop is in Berlin, not Tokyo: it offers to switch, and keeping Tokyo hides the offer.
      const other = onLaptop.locator("[data-e2e=preferences-other-zone]")
      await expect(other).toContainText("This device is on Berlin time")
      await onLaptop.locator("[data-e2e=preferences-keep-zone]").click()
      await expect(other).toBeHidden()
    } finally {
      await laptop?.close()
      await phone?.close()
      await cleanup(request, email)
    }
  })
})
