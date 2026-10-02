/// <reference lib="deno.ns" />
/**
 * The api service in `infra/compose/compose.shared.yml` passes its environment by name and has no
 * `env_file`, so a variable the API reads reaches the container only when it is listed there. This
 * holds the billing variables (`docs/billing.md`, "Configuration") to that list.
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"
import { parse } from "@std/yaml"

const COMPOSE = fromFileUrl(new URL("../infra/compose/compose.shared.yml", import.meta.url))

Deno.test("the api container receives every billing variable the API reads", async () => {
  const compose = parse(await Deno.readTextFile(COMPOSE)) as {
    services?: Record<string, { environment?: string[] }>
  }
  const environment = compose.services?.api?.environment
  if (!Array.isArray(environment)) throw new Error("the api service has no environment list")
  const names = environment.map((entry) => entry.split("=")[0])

  for (
    const name of [
      "BILLING_PROVIDER",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_PRICE_PRO",
      "BILLING_GRACE_DAYS",
      "BILLING_TRIAL_REQUIRES_CARD",
    ]
  ) {
    expect(names, name).toContain(name)
  }
})
