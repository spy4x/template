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

import { runGh } from "@api/services/github/cli.ts"

Deno.test("gh cli wrapper disabled", async () => {
  Deno.env.set("GH_CLI_ENABLED", "0")
  const result = await runGh(["version"])
  expect(result.ok).toEqual(false)
})
