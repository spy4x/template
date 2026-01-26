import { expect } from "@std/expect"

Deno.env.set("ENV", "dev")
Deno.env.set("AUTH_COOKIE_SECRET", "x")
Deno.env.set("AUTH_PEPPER", "x")
Deno.env.set("AUTH_TOTP", "x")
Deno.env.set("DEV_EMAIL", "dev@example.com")
Deno.env.set("TIMEZONE", "UTC")
Deno.env.set("RATE_LIMITER_WINDOW_MS", "60000")
Deno.env.set("RATE_LIMITER_STRICT_LIMIT", "30")
Deno.env.set("RATE_LIMITER_LIMIT", "100")
Deno.env.set("DOMAIN", "app.localhost")
Deno.env.set("KV_HOSTNAME", "kv")
Deno.env.set("KV_PORT", "6379")

Deno.test("verifyWebhookSignature allows missing secret when not enforced", async () => {
  Deno.env.set("GH_WEBHOOK_SECRET", "")
  Deno.env.set("GH_WEBHOOK_ENFORCE", "0")
  const { verifyWebhookSignature } = await import("./verify.ts")
  const ok = await verifyWebhookSignature(undefined, "{}")
  expect(ok).toEqual(true)
})

Deno.test("verifyWebhookSignature validates hmac", async () => {
  Deno.env.set("GH_WEBHOOK_SECRET", "secret")
  Deno.env.set("GH_WEBHOOK_ENFORCE", "1")
  const { verifyWebhookSignature } = await import("./verify.ts")
  const body = JSON.stringify({ ok: true })
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode("secret"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(body))
  const digest = `sha256=${[...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("")}`
  const ok = await verifyWebhookSignature(digest, body)
  expect(ok).toEqual(true)
})
