import { type APIRequestContext, type Browser, expect, test as base } from "@playwright/test"
import { gotoApp, signIn } from "./app.ts"

const WARM_USER = "e2e_warm_up_user@example.com"
const WARM_PASSWORD = "Passw0rd!"

/**
 * Loads every screen of the signed-in app once, so Vite's dev server has compiled the modules
 * before the first spec needs them. On a cold dev server the first load of a route takes longer
 * than the 10 s navigation timeout when the machine is busy, and whichever spec ran first failed
 * with `page.goto: Timeout 10000ms exceeded`.
 */
async function warmUp(browser: Browser, api: APIRequestContext, baseURL: string) {
  const headers = { origin: new URL(baseURL).origin, "sec-fetch-site": "same-origin" }
  const context = await browser.newContext({ baseURL })
  try {
    const cleanup = () => api.post("/api/test/cleanup-user", { data: { login: WARM_USER } })
    await cleanup()
    const signUp = await api.post("/api/auth/password/sign-up", {
      headers,
      data: { email: WARM_USER, password: WARM_PASSWORD },
    })
    if (!signUp.ok()) throw new Error(`warm-up sign-up failed: ${signUp.status()}`)
    try {
      const page = await context.newPage()
      await signIn(page, WARM_USER, WARM_PASSWORD)
      const status = page.locator("[data-e2e=shell-ws-status]")
      await gotoApp(page, "/groups", status)
      const groups = await (await context.request.get("/api/groups?limit=100")).json()
      const groupId = groups.groups?.[0]?.id
      if (groupId) await gotoApp(page, `/groups/${groupId}/notes`, status)
      await page.waitForLoadState("networkidle")
    } finally {
      await cleanup()
    }
  } finally {
    await context.close()
  }
}

/**
 * `test` with one automatic worker fixture that warms the dev server before the first spec. The
 * specs that need the full stack import it from here; `url-filters` serves its own fixture and
 * keeps the plain one.
 */
export const test = base.extend<object, { warmDevServer: void }>({
  warmDevServer: [async ({ browser, playwright }, use, workerInfo) => {
    const baseURL = String(workerInfo.project.use.baseURL)
    // Its own request context: one shared with the browser context would hold the session cookie
    // and the sign-in page would redirect.
    const api = await playwright.request.newContext({ baseURL })
    try {
      await warmUp(browser, api, baseURL)
    } finally {
      await api.dispose()
    }
    await use()
  }, { scope: "worker", auto: true, timeout: 120_000 }],
})

export { expect }
