import { type APIRequestContext, expect, test } from "@playwright/test"
import { BILLING_WEBHOOK_PATH, proWebhook } from "../fixtures/billing.ts"

const password = "Passw0rd!"
const FREE_NOTES = 10
const EDITOR = 2

async function cleanup(request: APIRequestContext, email: string, soft = false): Promise<void> {
  const response = await request.post("/api/test/cleanup-user", { data: { login: email } })
  ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
}

// The MPA draws the upgrade prompt from the API's 402 alone, with no script in the browser.
test.use({ javaScriptEnabled: false })

test("without JavaScript, a free group's owner at a cap is offered an upgrade, and Pro lifts it", async ({ page, request, baseURL }) => {
  const owner = `mpa-plan-${crypto.randomUUID().slice(0, 8)}@example.com`
  const member = `mpa-plan-${crypto.randomUUID().slice(0, 8)}@example.com`
  const headers = { origin: new URL(baseURL!).origin, "sec-fetch-site": "same-origin" }
  await cleanup(request, owner)
  await cleanup(request, member)
  try {
    const joined = await request.post("/api/auth/password/sign-up", {
      headers,
      data: { email: member, password },
    })
    expect(joined.ok(), await joined.text()).toBe(true)
    await page.goto("/sign-up")
    await page.locator("[data-e2e=auth-form-login]").fill(owner)
    await page.locator("[data-e2e=auth-form-password]").fill(password)
    await page.locator("[data-e2e=auth-form-submit]").click()
    await expect(page).toHaveURL("/")
    const { groupId } = await (await page.request.get("/api/groups/selected")).json()
    for (let index = 1; index <= FREE_NOTES; index++) {
      const note = await page.request.post(`/api/groups/${groupId}/notes`, {
        headers,
        data: { id: crypto.randomUUID(), title: `Note ${index}`, body: "" },
      })
      expect(note.status(), await note.text()).toBe(201)
    }

    await page.goto("/notes/new")
    await page.locator("[data-e2e=note-title]").fill("One too many")
    await page.locator("[data-e2e=note-save]").click()
    const noteRefusal = page.locator("[data-e2e=plan-refusal]")
    await expect(noteRefusal).toContainText(`up to ${FREE_NOTES} notes`)
    await expect(page.locator("[data-e2e=note-title]")).toHaveValue("One too many")
    await noteRefusal.getByRole("link", { name: "See plans" }).click()
    await expect(page).toHaveURL(`/groups/${groupId}/pricing`)

    const added = await request.post("/api/test/add-member", {
      data: { login: member, groupId, role: EDITOR },
    })
    expect(added.status(), await added.text()).toBe(200)
    await page.goto(`/groups/${groupId}`)
    const row = page.locator("[data-e2e=group-member]").filter({ hasText: member })
    await row.getByLabel(`Role of ${member}`).selectOption({ label: "Viewer" })
    await row.getByRole("button", { name: "Change role" }).click()
    await expect(row.locator("[data-e2e=plan-refusal]")).toContainText("needs a paid plan")
    await expect(row.locator("[data-e2e=group-member-role]")).toHaveText("Editor")

    const upgraded = await request.post(BILLING_WEBHOOK_PATH, await proWebhook(groupId))
    expect(upgraded.status(), await upgraded.text()).toBe(200)
    await page.goto(`/groups/${groupId}`)
    await row.getByLabel(`Role of ${member}`).selectOption({ label: "Viewer" })
    await row.getByRole("button", { name: "Change role" }).click()
    await expect(page).toHaveURL(`/groups/${groupId}`)
    await expect(row.locator("[data-e2e=group-member-role]")).toHaveText("Viewer")
  } finally {
    await cleanup(request, owner, true)
    await cleanup(request, member, true)
  }
})
