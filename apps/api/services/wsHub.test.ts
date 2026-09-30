import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { buildAuthData } from "../_testing/fake-auth.ts"
import {
  API_URL,
  mountRoute,
  testSessionGuards,
  WEB_APP_URL,
} from "../_testing/mutation-requests.ts"
import { createProfileSocketRoute } from "./wsHub.ts"

function buildApp() {
  const upgrades: number[] = []
  const route = createProfileSocketRoute({
    auth: testSessionGuards(),
    expectedOrigin: WEB_APP_URL,
    upgrade: (_c, userId) => {
      upgrades.push(userId)
      return new Response(null, { status: 200 })
    },
  })
  return { app: mountRoute("/ws", route, buildAuthData({ user: { id: 7 } })), upgrades }
}

/** A signed-in browser's WebSocket handshake, with `origin` as its Origin header when given. */
function handshake(origin?: string): RequestInit {
  const headers: Record<string, string> = {
    upgrade: "websocket",
    connection: "Upgrade",
    cookie: "sessionIdToken=1:token",
  }
  if (origin !== undefined) headers.origin = origin
  return { headers }
}

describe("profile socket route", () => {
  it("refuses an upgrade from a foreign origin", async () => {
    const { app, upgrades } = buildApp()
    const response = await app.request(
      `${API_URL}/ws/profile`,
      handshake("https://attacker.example"),
    )
    expect(response.status).toBe(403)
    expect(upgrades).toEqual([])
  })

  it("refuses an upgrade from a sibling subdomain", async () => {
    const { app, upgrades } = buildApp()
    const response = await app.request(
      `${API_URL}/ws/profile`,
      handshake("https://grafana.example.com"),
    )
    expect(response.status).toBe(403)
    expect(upgrades).toEqual([])
  })

  it("refuses an upgrade without an Origin header", async () => {
    const { app, upgrades } = buildApp()
    const response = await app.request(`${API_URL}/ws/profile`, handshake())
    expect(response.status).toBe(403)
    expect(upgrades).toEqual([])
  })

  it("upgrades the signed-in user when Origin is the web app's origin", async () => {
    const { app, upgrades } = buildApp()
    const response = await app.request(`${API_URL}/ws/profile`, handshake(WEB_APP_URL))
    expect(response.status).toBe(200)
    expect(upgrades).toEqual([7])
  })
})
