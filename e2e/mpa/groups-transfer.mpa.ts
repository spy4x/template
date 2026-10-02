import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test"

const password = "Passw0rd!"

async function cleanup(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post("/api/test/cleanup-user", { data: { login: email } })
  expect.soft(response.status(), await response.text()).toBe(200)
}

/** A browser context of its own with no JavaScript, signed up as `email`. */
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

test("without JavaScript, the owner hands the group to a member after a wrong password is refused, and stays as an admin", async ({ browser, request }) => {
  const owner = `mpa-${crypto.randomUUID().slice(0, 8)}@example.com`
  const member = `mpa-${crypto.randomUUID().slice(0, 8)}@example.com`
  const pages: Page[] = []
  try {
    for (const email of [owner, member]) await cleanup(request, email)
    const ownerPage = await signedUp(browser, owner)
    const memberPage = await signedUp(browser, member)
    pages.push(ownerPage, memberPage)

    await ownerPage.goto("/groups")
    await ownerPage.locator("[data-e2e=group-name]").fill("Crew")
    await ownerPage.locator("[data-e2e=group-create]").click()
    const groups = await (await ownerPage.request.get("/api/groups")).json()
    const groupId = groups.groups.find((group: { name: string }) => group.name === "Crew").id
    const added = await request.post("/api/test/add-member", {
      data: { login: member, groupId, role: 2 },
    })
    expect(added.status(), await added.text()).toBe(200)

    await ownerPage.goto(`/groups/${groupId}`)
    const section = ownerPage.locator("[data-e2e=group-section-transfer]")
    await section.getByText("Transfer ownership...").click()
    await section.locator("[data-e2e=group-transfer-member]").selectOption({ label: member })
    await section.locator("[data-e2e=group-transfer-name]").fill("Crew")
    await section.locator("[data-e2e=group-transfer-password]").fill("wrong-password")
    await section.locator("[data-e2e=group-transfer]").click()
    await expect(section).toContainText("The password is incorrect")
    // The page comes back with the choice and the name kept, and the password empty.
    await expect(section.locator("[data-e2e=group-transfer-name]")).toHaveValue("Crew")
    await expect(section.locator("[data-e2e=group-transfer-password]")).toHaveValue("")
    await expect(ownerPage.locator("[data-e2e=group-general-role]")).toHaveText("Owner")

    await section.locator("[data-e2e=group-transfer-password]").fill(password)
    await section.locator("[data-e2e=group-transfer]").click()
    await expect(ownerPage).toHaveURL(`/groups/${groupId}`)
    await expect(ownerPage.locator("[data-e2e=group-general-role]")).toHaveText("Admin")
    await expect(section).toHaveCount(0)

    await memberPage.goto(`/groups/${groupId}`)
    await expect(memberPage.locator("[data-e2e=group-general-role]")).toHaveText("Owner")
  } finally {
    for (const page of pages) await page.context().close()
    for (const email of [owner, member]) await cleanup(request, email)
  }
})
