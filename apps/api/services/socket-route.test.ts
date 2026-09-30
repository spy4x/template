import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { UserMFAStatus } from "@domain/identity"
import { buildAuthData } from "../_testing/fake-auth.ts"
import {
  API_URL,
  mountRoute,
  testSessionGuards,
  WEB_APP_URL,
} from "../_testing/mutation-requests.ts"
import { createSocketRoute } from "./socket-route.ts"
import type { AppAuthState } from "./sign-in.ts"

function buildApp(auth: AppAuthState | null = buildAuthData({ user: { id: 7 } })) {
  const upgrades: number[] = []
  const route = createSocketRoute({
    auth: testSessionGuards(),
    expectedOrigin: WEB_APP_URL,
    realtime: { attach: () => true },
    upgrade: (_c, state) => {
      upgrades.push(state.user.id)
      return new Response(null, { status: 200 })
    },
  })
  return { app: mountRoute("/ws", route, auth), upgrades }
}

/** A signed-in browser's WebSocket handshake, with `origin` as its Origin header when given. */
function handshake(origin?: string, extra: Record<string, string> = {}): RequestInit {
  const headers: Record<string, string> = {
    upgrade: "websocket",
    connection: "Upgrade",
    cookie: "sessionIdToken=1:token",
    ...extra,
  }
  if (origin !== undefined) headers.origin = origin
  return { headers }
}

describe("socket route", () => {
  it("refuses an upgrade from a foreign origin", async () => {
    const { app, upgrades } = buildApp()
    const response = await app.request(`${API_URL}/ws`, handshake("https://attacker.example"))
    expect(response.status).toBe(403)
    expect(upgrades).toEqual([])
  })

  it("refuses an upgrade from a sibling subdomain", async () => {
    const { app, upgrades } = buildApp()
    const response = await app.request(`${API_URL}/ws`, handshake("https://grafana.example.com"))
    expect(response.status).toBe(403)
    expect(upgrades).toEqual([])
  })

  it("refuses an upgrade without an Origin header", async () => {
    const { app, upgrades } = buildApp()
    const response = await app.request(`${API_URL}/ws`, handshake())
    expect(response.status).toBe(403)
    expect(upgrades).toEqual([])
  })

  it("upgrades the signed-in user when Origin is the web app's origin", async () => {
    const { app, upgrades } = buildApp()
    const response = await app.request(`${API_URL}/ws`, handshake(WEB_APP_URL))
    expect(response.status).toBe(200)
    expect(upgrades).toEqual([7])
  })

  it("refuses an upgrade without a session, whatever the Origin", async () => {
    const { app, upgrades } = buildApp(null)
    const response = await app.request(`${API_URL}/ws`, handshake(WEB_APP_URL))
    expect(response.status).toBe(401)
    expect(upgrades).toEqual([])
  })

  it("refuses an upgrade from a session that still owes its second factor", async () => {
    const { app, upgrades } = buildApp(
      buildAuthData({
        user: { id: 7, mfa: UserMFAStatus.CONFIGURED },
        session: { secondFactor: SecondFactorStatus.Pending },
      }),
    )
    const response = await app.request(`${API_URL}/ws`, handshake(WEB_APP_URL))
    expect(response.status).toBe(401)
    expect(upgrades).toEqual([])
  })

  it("asks a plain GET from the right origin to upgrade", async () => {
    const { app, upgrades } = buildApp()
    const response = await app.request(`${API_URL}/ws`, {
      headers: { origin: WEB_APP_URL, cookie: "sessionIdToken=1:token" },
    })
    expect(response.status).toBe(426)
    expect(upgrades).toEqual([])
  })
})
