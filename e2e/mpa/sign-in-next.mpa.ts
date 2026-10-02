import { type APIRequestContext, expect, type Page, test } from "@playwright/test"
import { currentStep, enrolTotp, totpCode } from "../fixtures/totp.ts"

const password = "Passw0rd!"

async function cleanup(request: APIRequestContext, email: string, soft = false): Promise<void> {
  const response = await request.post("/api/test/cleanup-user", { data: { login: email } })
  ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
}

/** Signs `email` up through `api` and writes one note into its group; returns the note's id. */
async function accountWithNote(api: APIRequestContext, base: string, email: string) {
  const headers = { origin: base, "sec-fetch-site": "same-origin" }
  const signUp = await api.post("/api/auth/password/sign-up", {
    headers,
    data: { email, password },
  })
  expect(signUp.ok(), await signUp.text()).toBe(true)
  const { groupId } = await (await api.get("/api/groups/selected")).json()
  const noteId = crypto.randomUUID()
  const note = await api.post(`/api/groups/${groupId}/notes`, {
    headers,
    data: { id: noteId, title: "Shared link", body: "" },
  })
  expect(note.status(), await note.text()).toBe(201)
  return noteId
}

/** Opens the note signed out, which lands on sign-in with the note as `next`, and signs in. */
async function signInFromNote(page: Page, noteId: string, email: string): Promise<void> {
  await page.goto(`/notes/${noteId}`)
  await expect(page).toHaveURL(`/sign-in?next=%2Fnotes%2F${noteId}`)
  await page.locator("[data-e2e=auth-form-login]").fill(email)
  await page.locator("[data-e2e=auth-form-password]").fill(password)
  await page.locator("[data-e2e=auth-form-submit]").click()
}

// Without a single script: `next` travels in the forms' hidden fields and the redirects.
test.use({ javaScriptEnabled: false })

test("a person without JavaScript opens a note signed out, signs in and lands on it", async ({ page, request, baseURL }) => {
  const email = `mpa-next-${crypto.randomUUID().slice(0, 8)}@example.com`
  await cleanup(request, email)
  try {
    const noteId = await accountWithNote(request, new URL(baseURL!).origin, email)

    await signInFromNote(page, noteId, email)
    await expect(page).toHaveURL(`/notes/${noteId}`)
    await expect(page.locator("[data-e2e=note-title]")).toHaveValue("Shared link")
  } finally {
    await cleanup(request, email, true)
  }
})

test("a person without JavaScript lands on the note after the one-time code", async ({ page, request, baseURL }) => {
  const email = `mpa-next-2fa-${crypto.randomUUID().slice(0, 8)}@example.com`
  await cleanup(request, email)
  try {
    const base = new URL(baseURL!).origin
    const noteId = await accountWithNote(request, base, email)
    const { secret, enrolStep } = await enrolTotp(request, base, email)

    await signInFromNote(page, noteId, email)
    await expect(page).toHaveURL(`/totp?next=%2Fnotes%2F${noteId}`)
    // A code for the step the enrolment used is refused as a replay, so use a later step.
    const step = Math.max(currentStep(), enrolStep + 1)
    await page.locator("[data-e2e=auth-form-code]").fill(await totpCode(secret, step))
    await page.locator("[data-e2e=auth-form-submit]").click()
    await expect(page).toHaveURL(`/notes/${noteId}`)
    await expect(page.locator("[data-e2e=note-title]")).toHaveValue("Shared link")
  } finally {
    await cleanup(request, email, true)
  }
})
