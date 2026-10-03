import { expect, test } from "@playwright/test"

// The public website is plain links and forms: a visitor needs no script to get through it.
test.use({ javaScriptEnabled: false })

test("a visitor without JavaScript goes from the home page to pricing, to sign-up and subscribes", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "The groundwork of a SaaS, already built.",
  )

  await page.getByRole("navigation", { name: "Main navigation" }).first()
    .getByRole("link", { name: "Pricing" }).click()
  await expect(page).toHaveURL("/pricing")
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pricing of the demo app")

  // Choosing a plan posts to the website, which sends the visitor to the app's sign-up.
  await page.getByRole("button", { name: "Try Pro in the demo" }).click()
  await expect(page).toHaveURL(/\/sign-up$/)

  // A fresh address each run: the per-address limit allows three confirm mails an hour.
  const email = `mpa-site-${crypto.randomUUID().slice(0, 8)}@example.com`
  await page.goto("/pricing")
  await page.locator("[data-e2e=footer-subscribe-email]").fill(email)
  await page.locator("[data-e2e=footer-subscribe-submit]").click()
  await expect(page).toHaveURL("/subscribe")
  await expect(page.locator("[data-e2e=subscribe-sent]")).toBeVisible()
})

test("robots.txt points crawlers at a sitemap that lists the pricing page", async ({ request, baseURL }) => {
  const robots = await request.get("/robots.txt")
  expect(robots.ok()).toBe(true)
  expect(await robots.text()).toContain(`Sitemap: ${new URL(baseURL!).origin}/sitemap.xml`)

  const sitemap = await request.get("/sitemap.xml")
  expect(sitemap.ok()).toBe(true)
  expect(await sitemap.text()).toContain(`<loc>${new URL(baseURL!).origin}/pricing</loc>`)
})
