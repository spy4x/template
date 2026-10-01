import type { ConsoleMessage, Locator, Page, Request } from "@playwright/test"

/**
 * What Chromium reports for a request that was in flight when the host's network interfaces
 * changed. On a developer machine, any container that starts or stops (a veth link coming up)
 * triggers it, and the browser closes every open connection, including the ones carrying the
 * module scripts of a page that is loading. The app is not at fault, and no browser switch turns
 * the notification off, so a navigation that fails this way is made again.
 */
const NETWORK_CHANGED = "net::ERR_NETWORK_CHANGED"
const ATTEMPTS = 3
const MAX_LOGGED = 30

/**
 * Opens `url` and waits for `ready`, which proves the app booted. Only when a request to the
 * app's own origin failed with the network-change error during the attempt is the page loaded
 * again, up to three times. Any other failure, or the same failure on the last attempt, throws
 * at once, with the failed requests and the console of the last attempt added to the message so a
 * red run explains itself without a trace.
 */
export async function gotoApp(page: Page, url: string, ready: Locator): Promise<void> {
  let networkChanged = false
  let appOrigin = ""
  let failed: string[] = []
  let consoleLines: string[] = []
  const onRequest = (request: Request) => {
    if (!appOrigin && request.isNavigationRequest()) appOrigin = new URL(request.url()).origin
  }
  const onFailed = (request: Request) => {
    const errorText = request.failure()?.errorText
    failed.push(`${request.url()} ${errorText}`)
    if (errorText === NETWORK_CHANGED && new URL(request.url()).origin === appOrigin) {
      networkChanged = true
    }
  }
  const onConsole = (message: ConsoleMessage) => {
    consoleLines.push(`${message.type()}: ${message.text()}`)
  }
  page.on("request", onRequest)
  page.on("requestfailed", onFailed)
  page.on("console", onConsole)
  try {
    for (let attempt = 1;; attempt++) {
      networkChanged = false
      appOrigin = ""
      failed = []
      consoleLines = []
      try {
        await page.goto(url)
        await ready.waitFor()
        return
      } catch (error) {
        if (!networkChanged || attempt === ATTEMPTS) {
          if (error instanceof Error) {
            error.message += `\nAttempt ${attempt} of ${url}.` +
              `\nFailed requests (${failed.length}):\n${failed.slice(0, MAX_LOGGED).join("\n")}` +
              `\nConsole (${consoleLines.length}):\n${consoleLines.slice(0, MAX_LOGGED).join("\n")}`
          }
          throw error
        }
      }
    }
  } finally {
    page.off("request", onRequest)
    page.off("requestfailed", onFailed)
    page.off("console", onConsole)
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
