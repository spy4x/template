import type { Locator, Page, Request } from "@playwright/test"

/**
 * What Chromium reports for a request that was in flight when the host's network interfaces
 * changed. On a developer machine, any container that starts or stops (a veth link coming up)
 * triggers it, and the browser closes every open connection, including the ones carrying the
 * module scripts of a page that is loading. The app is not at fault, and no browser switch turns
 * the notification off, so a navigation that fails this way is made again.
 */
const NETWORK_CHANGED = "net::ERR_NETWORK_CHANGED"
const ATTEMPTS = 3

/**
 * Opens `url` and waits for `ready`, which proves the app booted. Only when a request failed with
 * the network-change error during the attempt is the page loaded again, up to three times; any
 * other failure, or the same failure on the last attempt, throws at once.
 */
export async function gotoApp(page: Page, url: string, ready: Locator): Promise<void> {
  let networkChanged = false
  const onFailed = (request: Request) => {
    if (request.failure()?.errorText === NETWORK_CHANGED) networkChanged = true
  }
  page.on("requestfailed", onFailed)
  try {
    for (let attempt = 1;; attempt++) {
      networkChanged = false
      try {
        await page.goto(url)
        await ready.waitFor()
        return
      } catch (error) {
        if (!networkChanged || attempt === ATTEMPTS) throw error
      }
    }
  } finally {
    page.off("requestfailed", onFailed)
  }
}

/** Signs `email` in through the form and waits until the app is on its home page. */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await gotoApp(page, "/sign-in", page.locator("[data-e2e=auth-form-login]"))
  await page.locator("[data-e2e=auth-form-login]").fill(email)
  await page.locator("[data-e2e=auth-form-password]").fill(password)
  await page.locator("[data-e2e=auth-form-submit]").click()
  await page.waitForURL("/")
}
