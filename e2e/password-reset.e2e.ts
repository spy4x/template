import { type APIRequestContext, expect, type Page, test } from "@playwright/test"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const newPassword = "N3w-Passw0rd"

async function cleanup(request: APIRequestContext, email: string, soft = false): Promise<void> {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
}

/** The path and query of the reset link in the newest mail to `email`, once the worker sent it. */
async function resetLinkFor(request: APIRequestContext, email: string): Promise<string> {
  let text = ""
  await expect.poll(async () => {
    const response = await request.post(`${apiBase}/api/test/last-mail`, { data: { email } })
    if (!response.ok()) return response.status()
    text = ((await response.json()) as { text: string }).text
    return response.status()
  }, { timeout: 20_000, message: "the worker mails the reset link" }).toBe(200)
  const link = new URL(text.match(/https?:\/\/\S+/)![0])
  return link.pathname + link.search
}

async function signIn(page: Page, email: string, secret: string): Promise<void> {
  await page.goto("/sign-in")
  await page.locator("[data-e2e=auth-form-login]").fill(email)
  await page.locator("[data-e2e=auth-form-password]").fill(secret)
  await page.locator("[data-e2e=auth-form-submit]").click()
}

test("a forgotten password is reset through the mailed link, which works once", async ({ page, request }) => {
  // A fresh address each run: the per-address limit allows three requests an hour.
  const email = `e2e-reset-${crypto.randomUUID().slice(0, 8)}@example.com`
  await cleanup(request, email)
  try {
    const signUp = await request.post(`${apiBase}/api/auth/password/sign-up`, {
      headers,
      data: { email, password },
    })
    expect(signUp.ok(), await signUp.text()).toBe(true)

    await page.goto("/sign-in")
    await page.getByRole("link", { name: "Forgot your password?" }).click()
    await expect(page).toHaveURL("/forgot-password")
    await page.locator("[data-e2e=forgot-password-email]").fill(email.toUpperCase())
    await page.locator("[data-e2e=forgot-password-submit]").click()
    await expect(page.locator("[data-e2e=forgot-password-sent]")).toBeVisible()

    const link = await resetLinkFor(request, email)
    expect(link).toMatch(/^\/reset-password\?/)
    await page.goto(link)
    // The code is in the address, so the page's own requests must not carry it as the Referer.
    await expect(page.locator("meta[name=referrer]")).toHaveAttribute("content", "no-referrer")
    await page.locator("[data-e2e=reset-password-new]").fill(newPassword)
    await page.locator("[data-e2e=reset-password-submit]").click()
    await expect(page.locator("[data-e2e=reset-password-done]")).toBeVisible()

    // The link was spent: opening it again offers nothing but a refusal.
    await page.goto(link)
    await page.locator("[data-e2e=reset-password-new]").fill("Other-Passw0rd")
    await page.locator("[data-e2e=reset-password-submit]").click()
    await expect(page.getByText("This link is invalid, used or expired")).toBeVisible()

    await signIn(page, email, password)
    await expect(page.getByText("Invalid e-mail, username or password")).toBeVisible()
    await signIn(page, email, newPassword)
    await page.waitForURL("/")
  } finally {
    await cleanup(request, email, true)
  }
})

test("asking for a link answers the same for an address no account uses", async ({ page }) => {
  await page.goto("/forgot-password")
  await page.locator("[data-e2e=forgot-password-email]").fill(
    `e2e-nobody-${crypto.randomUUID().slice(0, 8)}@example.com`,
  )
  await page.locator("[data-e2e=forgot-password-submit]").click()
  await expect(page.locator("[data-e2e=forgot-password-sent]")).toContainText(
    "If an account uses this address",
  )
})
