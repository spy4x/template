import { expect, test } from "@playwright/test"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }

test.describe("profile over the socket", () => {
  test("a name saved in one tab appears in a second tab without a reload", async ({ context, request }) => {
    const username = "e2e_profile_two_tabs_user"
    const password = "Passw0rd!"

    const cleanup = async ({ soft = false } = {}) => {
      const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
        data: { username },
      })
      ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
    }

    await cleanup()
    try {
      const signUp = await request.post(`${apiBase}/api/auth/password/sign-up`, {
        headers,
        data: { username, password },
      })
      expect(signUp.ok()).toBe(true)

      // Two pages of one context hold the same session cookie, as two tabs of one person do.
      const first = await context.newPage()
      const framesSent: string[] = []
      first.on("websocket", (socket) => {
        socket.on("framesent", (frame) => framesSent.push(String(frame.payload)))
      })
      const profileWrites: string[] = []
      first.on("request", (req) => {
        if (req.method() === "PATCH" && new URL(req.url()).pathname === "/api/users/me") {
          profileWrites.push(req.url())
        }
      })
      await first.goto("/sign-in")
      await first.locator("[data-e2e=auth-form-login]").fill(username)
      await first.locator("[data-e2e=auth-form-password]").fill(password)
      await first.locator("[data-e2e=auth-form-submit]").click()
      await first.waitForURL("/")
      await first.getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Profile" }).click()
      await expect(first.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible()

      const second = await context.newPage()
      await second.goto("/")
      await second.getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Profile" }).click()
      await expect(second.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible()
      await expect(second.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
      await expect(first.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")

      await first.locator("[data-e2e=profile-first-name]").fill("Ada")
      await first.locator("[data-e2e=profile-last-name]").fill("Lovelace")
      await first.locator("[data-e2e=profile-save]").click()
      await first.locator("[data-e2e=profile-saved]").getByText("Saved", { exact: true }).waitFor()

      // The second tab was neither reloaded nor touched: the server's hint made it read again.
      await expect(second.locator("[data-e2e=profile-first-name]")).toHaveValue("Ada")
      await expect(second.locator("[data-e2e=profile-last-name]")).toHaveValue("Lovelace")

      // The save went over the socket, as a command with an idempotency key, not over REST.
      const command = framesSent.map((payload) => JSON.parse(payload)).find(
        (frame) => frame.kind === "client.command" && frame.name === "profile.update",
      )
      expect(command?.idempotencyKey).toBeTruthy()
      expect(command?.payload).toEqual({ firstName: "Ada", lastName: "Lovelace" })
      expect(profileWrites).toEqual([])
    } finally {
      await cleanup({ soft: true })
    }
  })
})
