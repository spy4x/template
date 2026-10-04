/// <reference lib="deno.ns" />
/**
 * The api and worker services in `infra/compose/compose.shared.yml` pass their environment by name
 * and have no `env_file`, so a variable a process reads reaches its container only when it is
 * listed there. This holds the billing variables (`docs/billing.md`, "Configuration") to both lists:
 * the worker reads the same billing setup to change a per-member subscription's quantity. Only the
 * API verifies webhooks, so only the API container receives the webhook signing secret. Both
 * receive the subscriber secrets: the worker signs the links the API checks.
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"
import { parse } from "@std/yaml"

const COMPOSE = fromFileUrl(new URL("../infra/compose/compose.shared.yml", import.meta.url))

/** The billing variables both processes read (`readBillingSetup` in `libs/server/billing`). */
const SHARED = [
  "BILLING_PROVIDER",
  "STRIPE_SECRET_KEY",
  "STRIPE_PRICE_PRO",
  "BILLING_GRACE_DAYS",
  "BILLING_TRIAL_REQUIRES_CARD",
]

async function environmentOf(service: string): Promise<string[]> {
  const compose = parse(await Deno.readTextFile(COMPOSE)) as {
    services?: Record<string, { environment?: string[] }>
  }
  const environment = compose.services?.[service]?.environment
  if (!Array.isArray(environment)) throw new Error(`the ${service} service has no environment`)
  return environment.map((entry) => entry.split("=")[0])
}

Deno.test("the api container receives every billing variable, the webhook secret included", async () => {
  const names = await environmentOf("api")

  for (const name of [...SHARED, "STRIPE_WEBHOOK_SECRET"]) expect(names, name).toContain(name)
})

Deno.test("the worker container receives the billing variables but not the webhook secret", async () => {
  const names = await environmentOf("worker")

  for (const name of SHARED) expect(names, name).toContain(name)
  expect(names).not.toContain("STRIPE_WEBHOOK_SECRET")
})

// Without the secret in its container, a worker that asked for webhooks would refuse to start.
Deno.test("the worker reads the billing setup without webhooks", async () => {
  const worker = await Deno.readTextFile(new URL("../apps/worker/+main.ts", import.meta.url))
  expect(worker).toMatch(/webhooks: false,/)
})

for (const service of ["api", "worker"]) {
  Deno.test(`the ${service} container receives both subscriber secrets`, async () => {
    const names = await environmentOf(service)

    expect(names).toContain("SUBSCRIBERS_SECRET")
    expect(names).toContain("SUBSCRIBERS_PREVIOUS_SECRETS")
  })
}

Deno.test("the api container receives the error tracker's DSN", async () => {
  expect(await environmentOf("api")).toContain("ERROR_REPORT_DSN")
})
