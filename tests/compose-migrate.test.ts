/// <reference lib="deno.ns" />
/**
 * Holds `infra/compose/compose.shared.yml` to the deploy's migration order: the one-shot `migrate`
 * service applies pending migrations, and every other service built from the API's Dockerfile
 * (the API, the worker) starts only after it exits with 0. Without that order a deploy with a new
 * migration serves traffic on the old schema (spy4x/template#113).
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"
import { parse } from "@std/yaml"

const COMPOSE = fromFileUrl(new URL("../infra/compose/compose.shared.yml", import.meta.url))
const APP_DOCKERFILE = "apps/api/dockerfile"

interface ComposeService {
  build?: { dockerfile?: string }
  command?: string[]
  restart?: string
  depends_on?: Record<string, { condition?: string }>
}

async function services(): Promise<Record<string, ComposeService>> {
  const compose = parse(await Deno.readTextFile(COMPOSE)) as {
    services?: Record<string, ComposeService>
  }
  if (!compose.services) throw new Error(`${COMPOSE} has no services`)
  return compose.services
}

Deno.test("the migrate service applies migrations once, after the database is healthy", async () => {
  const migrate = (await services()).migrate
  expect(migrate?.command).toEqual(["deno", "task", "db:migrate"])
  expect(migrate?.restart).toBe("no")
  expect(migrate?.depends_on?.db?.condition).toBe("service_healthy")
})

Deno.test("every app service starts only after the migrations succeed", async () => {
  const apps = Object.entries(await services()).filter(([name, service]) =>
    name !== "migrate" && service.build?.dockerfile === APP_DOCKERFILE
  )
  expect(apps.map(([name]) => name).sort()).toEqual(["api", "worker"])
  for (const [name, service] of apps) {
    expect({ name, condition: service.depends_on?.migrate?.condition }).toEqual({
      name,
      condition: "service_completed_successfully",
    })
  }
})
