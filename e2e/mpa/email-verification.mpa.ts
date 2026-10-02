import { type APIRequestContext, expect, test } from "@playwright/test"

const password = "Passw0rd!"

async function cleanup(request: APIRequestContext, email: string, soft = false): Promise<void> {
  const response = await request.post("/api/test/cleanup-user", { data: { login: email } })
  ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
}

// The MPA's e-mail page is plain forms: the whole flow runs without a single script.
test.use({ javaScriptEnabled: false })

test("a person without JavaScript proves a new account's address with the mailed code", async ({ page, request }) => {
  // A fresh address each run: the per-address limit allows three code mails an hour.
  const email = `mpa-verify-${crypto.randomUUID().slice(0, 8)}@example.com`
  await cleanup(request, email)
  try {
    await page.goto("/sign-up")
    await page.locator("[data-e2e=auth-form-login]").fill(email)
    await page.locator("[data-e2e=auth-form-password]").fill(password)
    await page.locator("[data-e2e=auth-form-submit]").click()
    await expect(page).toHaveURL("/")

    const banner = page.locator("[data-e2e=email-banner]")
    await expect(banner).toContainText(email)
    await banner.getByRole("link", { name: "Enter the code" }).click()
    await expect(page).toHaveURL("/email")

    let text = ""
    await expect.poll(async () => {
      const response = await request.post("/api/test/last-mail", { data: { email } })
      if (response.ok()) text = ((await response.json()) as { text: string }).text
      return response.status()
    }, { timeout: 20_000, message: "the worker mails the code" }).toBe(200)
    // The mail is the request, the code, how long it is valid and what to do if unasked.
    const code = text.split("\n\n")[1].trim()

    await page.locator("[data-e2e=email-code]").fill("wrong-00")
    await page.locator("[data-e2e=email-verify]").click()
    await expect(page.getByText("This code is wrong or has expired. Ask for a new one."))
      .toBeVisible()

    await page.locator("[data-e2e=email-code]").fill(code)
    await page.locator("[data-e2e=email-verify]").click()
    await expect(page).toHaveURL("/email")
    await expect(page.locator("[data-e2e=email-current]")).toContainText("which is verified")
    await page.goto("/")
    await expect(page.locator("[data-e2e=profile-email-link]")).toBeVisible()
    await expect(banner).toHaveCount(0)
  } finally {
    await cleanup(request, email, true)
  }
})
