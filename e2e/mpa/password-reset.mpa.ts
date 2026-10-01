import { type APIRequestContext, expect, test } from "@playwright/test"

const password = "Passw0rd!"

async function cleanup(request: APIRequestContext, email: string, soft = false): Promise<void> {
  const response = await request.post("/api/test/cleanup-user", { data: { login: email } })
  ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
}

// The MPA's reset pages are plain forms: the whole flow runs without a single script.
test.use({ javaScriptEnabled: false })

test("a person without JavaScript resets a forgotten password through the mailed link", async ({ page, request }) => {
  // A fresh address each run: the per-address limit allows three requests an hour.
  const email = `mpa-reset-${crypto.randomUUID().slice(0, 8)}@example.com`
  await cleanup(request, email)
  try {
    await page.goto("/sign-up")
    await page.locator("[data-e2e=auth-form-login]").fill(email)
    await page.locator("[data-e2e=auth-form-password]").fill(password)
    await page.locator("[data-e2e=auth-form-submit]").click()
    await expect(page).toHaveURL("/")
    await page.locator("[data-e2e=signout]").click()
    await expect(page).toHaveURL("/sign-in")

    await page.getByRole("link", { name: "Forgot your password?" }).click()
    await expect(page).toHaveURL("/forgot-password")
    await page.locator("[data-e2e=forgot-password-email]").fill(email)
    await page.locator("[data-e2e=forgot-password-submit]").click()
    await expect(page.locator("[data-e2e=forgot-password-sent]")).toBeVisible()

    let text = ""
    await expect.poll(async () => {
      const response = await request.post("/api/test/last-mail", { data: { email } })
      if (response.ok()) text = ((await response.json()) as { text: string }).text
      return response.status()
    }, { timeout: 20_000, message: "the worker mails the reset link" }).toBe(200)
    const link = new URL(text.match(/https?:\/\/\S+/)![0])

    await page.goto(link.pathname + link.search)
    await page.locator("[data-e2e=reset-password-new]").fill("N3w-Passw0rd")
    await page.locator("[data-e2e=reset-password-submit]").click()
    await expect(page.locator("[data-e2e=reset-password-done]")).toBeVisible()

    await page.goto("/sign-in")
    await page.locator("[data-e2e=auth-form-login]").fill(email)
    await page.locator("[data-e2e=auth-form-password]").fill("N3w-Passw0rd")
    await page.locator("[data-e2e=auth-form-submit]").click()
    await expect(page).toHaveURL("/")
  } finally {
    await cleanup(request, email, true)
  }
})
