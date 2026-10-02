/// <reference lib="deno.ns" />
/**
 * The api and worker services in `infra/compose/compose.shared.yml` pass their environment by name
 * and have no `env_file`, so a variable a process reads reaches its container only when it is
 * listed there. This holds the billing variables (`docs/billing.md`, "Configuration") to both lists:
 * the worker reads the same billing setup to change a per-member subscription's quantity.
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"
import { parse } from "@std/yaml"

const COMPOSE = fromFileUrl(new URL("../infra/compose/compose.shared.yml", import.meta.url))

for (const service of ["api", "worker"]) {
  Deno.test(`the ${service} container receives every billing variable the setup reads`, async () => {
    const compose = parse(await Deno.readTextFile(COMPOSE)) as {
      services?: Record<string, { environment?: string[] }>
    }
    const environment = compose.services?.[service]?.environment
    if (!Array.isArray(environment)) throw new Error(`the ${service} service has no environment`)
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
}
