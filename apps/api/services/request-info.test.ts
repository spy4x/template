import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import { requestInfoFromContext } from "@spy4x/platform/request-info"

/**
 * Pins which header wins when this app calls `requestInfoFromContext(c, { trustedProxy: true })`
 * — every call site in apps/api (routes/{users,ws,pushNotification}.ts,
 * services/auth/+index.ts) passes this option to keep the template's old behaviour of trusting a
 * forwarding header.
 *
 * `trustedProxy: true` makes the package check `CF-Connecting-IP` before `X-Forwarded-For` and
 * `X-Real-IP`. This app's Traefik does not set `CF-Connecting-IP` itself — it only overwrites
 * `X-Forwarded-For`/`X-Real-IP` — so a client could otherwise pick the IP this app writes to
 * `auth_audits` simply by sending that header. `infra/compose/compose.shared.yml`'s
 * `strip-cf-ip-${PROJECT}` middleware removes it at the proxy before a request ever reaches this
 * app, so `ip` below always ends up as the `X-Forwarded-For` value in production.
 *
 * This test exercises the app's own call path, not the package directly, so flipping
 * `trustedProxy` at any of those call sites — or removing the proxy's strip, which the second
 * case stands in for — turns it red.
 */
function buildApp() {
  const app = new Hono()
  app.get("/whoami", (c) => {
    const info = requestInfoFromContext(c, { trustedProxy: true })
    return c.json({ ip: info.ip ?? null })
  })
  return app
}

describe("requestInfoFromContext, as called by this app", () => {
  it("prefers CF-Connecting-IP over X-Forwarded-For when both are present", async () => {
    // This is exactly why the header must be stripped at the proxy: an untrusted client sending
    // both headers gets the one *it* controls read first.
    const response = await buildApp().request("/whoami", {
      headers: {
        "cf-connecting-ip": "203.0.113.9",
        "x-forwarded-for": "198.51.100.1",
      },
    })
    expect(await response.json()).toEqual({ ip: "203.0.113.9" })
  })

  it("falls back to X-Forwarded-For once CF-Connecting-IP is stripped at the proxy", async () => {
    const response = await buildApp().request("/whoami", {
      headers: { "x-forwarded-for": "198.51.100.1" },
    })
    expect(await response.json()).toEqual({ ip: "198.51.100.1" })
  })
})
