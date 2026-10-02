import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test"
import { BILLING_WEBHOOK_PATH, proWebhook } from "../fixtures/billing.ts"

const password = "Passw0rd!"

async function cleanup(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post("/api/test/cleanup-user", { data: { login: email } })
  expect.soft(response.status(), await response.text()).toBe(200)
}

/** A browser context of its own with no JavaScript. */
async function noScriptPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    javaScriptEnabled: false,
  })
  return await context.newPage()
}

test("without JavaScript, the owner creates a link that a signed-out person follows, signs in and accepts, and revokes another", async ({ browser, request }) => {
  const owner = `mpa-${crypto.randomUUID().slice(0, 8)}@example.com`
  const invitee = `mpa-${crypto.randomUUID().slice(0, 8)}@example.com`
  const pages: Page[] = []
  try {
    for (const email of [owner, invitee]) await cleanup(request, email)
    const ownerPage = await noScriptPage(browser)
    const inviteePage = await noScriptPage(browser)
    pages.push(ownerPage, inviteePage)
    await ownerPage.goto("/sign-up")
    await ownerPage.locator("[data-e2e=auth-form-login]").fill(owner)
    await ownerPage.locator("[data-e2e=auth-form-password]").fill(password)
    await ownerPage.locator("[data-e2e=auth-form-submit]").click()
    await expect(ownerPage).toHaveURL("/")
    // The invitee's account exists, but their browser is signed out when they follow the link.
    const origin = new URL(test.info().project.use.baseURL!).origin
    const signedUp = await request.post("/api/auth/password/sign-up", {
      headers: { origin, "sec-fetch-site": "same-origin" },
      data: { email: invitee, password },
    })
    expect(signedUp.ok(), await signedUp.text()).toBe(true)

    await ownerPage.goto("/groups")
    await ownerPage.locator("[data-e2e=group-name]").fill("Crew")
    await ownerPage.locator("[data-e2e=group-create]").click()
    const groups = await (await ownerPage.request.get("/api/groups")).json()
    const groupId = groups.groups.find((group: { name: string }) => group.name === "Crew").id

    // Inviting an editor is a paid feature: on the free plan an invitation adds viewers only.
    const upgraded = await request.post(BILLING_WEBHOOK_PATH, await proWebhook(groupId))
    expect(upgraded.status(), await upgraded.text()).toBe(200)

    await ownerPage.goto(`/groups/${groupId}`)
    const section = ownerPage.locator("[data-e2e=group-section-invitations]")
    await section.locator("[data-e2e=invitation-role]").selectOption({ label: "Editor" })
    // Pro is billed per member: the owner sees what one more member costs and must accept it.
    const seatPrice = section.locator("[data-e2e=seat-price]")
    await expect(seatPrice).toContainText(
      "with one more member the group pays €18.00 instead of €9.00",
    )
    await section.locator("[data-e2e=invitation-create]").click()
    await expect(seatPrice.locator("#invitation-seat-price-error")).toBeVisible()
    await section.locator("[data-e2e=invitation-role]").selectOption({ label: "Editor" })
    await section.locator("[data-e2e=seat-price-accept]").check()
    await section.locator("[data-e2e=invitation-create]").click()
    const link = await section.locator("[data-e2e=invitation-created] code").textContent()
    expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/)
    const invitePath = new URL(link!).pathname

    await inviteePage.goto(invitePath)
    await expect(inviteePage).toHaveURL(`/sign-in?${new URLSearchParams({ next: invitePath })}`)
    await inviteePage.locator("[data-e2e=auth-form-login]").fill(invitee)
    await inviteePage.locator("[data-e2e=auth-form-password]").fill(password)
    await inviteePage.locator("[data-e2e=auth-form-submit]").click()
    await expect(inviteePage).toHaveURL(invitePath)
    const card = inviteePage.locator("[data-e2e=invitation-card]")
    await expect(card.locator("[data-e2e=invitation-group]")).toHaveText("Crew")
    await card.locator("[data-e2e=invitation-accept]").click()
    await expect(inviteePage).toHaveURL("/notes")
    await inviteePage.goto(`/groups/${groupId}`)
    await expect(inviteePage.locator("[data-e2e=group-general-role]")).toHaveText("Editor")

    // The used link is gone from the pending list; a second one is revoked.
    await ownerPage.goto(`/groups/${groupId}`)
    await expect(ownerPage.locator("[data-e2e=group-member]")).toHaveCount(2)
    await expect(section.locator("[data-e2e=invitation]")).toHaveCount(0)
    await section.locator("[data-e2e=seat-price-accept]").check()
    await section.locator("[data-e2e=invitation-create]").click()
    await expect(section.locator("[data-e2e=invitation]")).toHaveCount(1)
    await section.locator("[data-e2e=invitation-revoke]").click()
    await expect(ownerPage).toHaveURL(`/groups/${groupId}`)
    await expect(section.locator("[data-e2e=invitation]")).toHaveCount(0)

    // A used-up link says so.
    await inviteePage.goto(invitePath)
    await expect(inviteePage.getByText("This invitation cannot be used")).toBeVisible()
  } finally {
    for (const page of pages) await page.context().close()
    for (const email of [owner, invitee]) await cleanup(request, email)
  }
})
