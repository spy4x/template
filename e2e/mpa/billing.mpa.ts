import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test"
import { BILLING_WEBHOOK_PATH, stripeSignature, subscriptionEvent } from "../fixtures/billing.ts"

const password = "Passw0rd!"

async function cleanup(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post("/api/test/cleanup-user", { data: { login: email } })
  expect.soft(response.status(), await response.text()).toBe(200)
}

/** Signs up `email` in a browser context of its own, with no JavaScript, and returns its page. */
async function signedUp(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    javaScriptEnabled: false,
  })
  const page = await context.newPage()
  await page.goto("/sign-up")
  await page.locator("[data-e2e=auth-form-login]").fill(email)
  await page.locator("[data-e2e=auth-form-password]").fill(password)
  await page.locator("[data-e2e=auth-form-submit]").click()
  await expect(page).toHaveURL("/")
  return page
}

test("without JavaScript, the owner upgrades a group and opens the portal, and a viewer cannot pay", async ({ browser, request }) => {
  const owner = `mpa-${crypto.randomUUID().slice(0, 8)}@example.com`
  const viewer = `mpa-${crypto.randomUUID().slice(0, 8)}@example.com`
  const pages: Page[] = []
  try {
    for (const email of [owner, viewer]) await cleanup(request, email)
    const ownerPage = await signedUp(browser, owner)
    const viewerPage = await signedUp(browser, viewer)
    pages.push(ownerPage, viewerPage)

    await ownerPage.goto("/groups")
    await ownerPage.locator("[data-e2e=group-name]").fill("Band")
    await ownerPage.locator("[data-e2e=group-create]").click()
    const groups = await (await ownerPage.request.get("/api/groups")).json()
    const groupId = groups.groups.find((group: { name: string }) => group.name === "Band").id
    const added = await request.post("/api/test/add-member", {
      data: { login: viewer, groupId, role: 1 },
    })
    expect(added.status(), await added.text()).toBe(200)

    await ownerPage.goto(`/groups/${groupId}`)
    const plan = ownerPage.locator("[data-e2e=billing-plan]")
    await expect(plan).toHaveAttribute("data-plan", "free")
    await ownerPage.getByRole("link", { name: "See plans" }).click()
    await expect(ownerPage).toHaveURL(`/groups/${groupId}/pricing`)
    // The development provider's checkout sends the browser straight back to the group's settings.
    await ownerPage.getByRole("button", { name: "Choose Pro" }).click()
    await expect(ownerPage).toHaveURL(`/groups/${groupId}`)
    await expect(plan).toHaveAttribute("data-plan", "free")

    const body = subscriptionEvent({ reference: groupId })
    const delivered = await request.post(BILLING_WEBHOOK_PATH, {
      headers: {
        "content-type": "application/json",
        "stripe-signature": await stripeSignature(body),
      },
      data: body,
    })
    expect(delivered.status(), await delivered.text()).toBe(200)

    await ownerPage.reload()
    await expect(plan).toHaveAttribute("data-plan", "pro")
    await ownerPage.getByRole("button", { name: /manage/i }).click()
    await expect(ownerPage).toHaveURL(`/groups/${groupId}`)

    await viewerPage.goto(`/groups/${groupId}`)
    await expect(viewerPage.locator("[data-e2e=billing-plan]")).toHaveAttribute("data-plan", "pro")
    await expect(viewerPage.locator("[data-e2e=billing-owner-only]")).toBeVisible()
    await viewerPage.goto(`/groups/${groupId}/pricing`)
    await expect(viewerPage.locator("[data-e2e=pricing-owner-only]")).toBeVisible()
    await expect(viewerPage.getByRole("button", { name: "Choose Pro" })).toHaveCount(0)
  } finally {
    for (const page of pages) await page.context().close()
    for (const email of [owner, viewer]) await cleanup(request, email)
  }
})
