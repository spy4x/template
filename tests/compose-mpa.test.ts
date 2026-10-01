/// <reference lib="deno.ns" />
/**
 * Holds the optional `mpa` service in `infra/compose/compose.shared.yml` to what the README's
 * "SPA or MPA" section promises: it exists only under the `mpa` profile, so the default deploy
 * stays the SPA alone, and when it runs it takes `DOMAIN` except `/api` and `/ws`, ahead of the
 * SPA's router (spy4x/template#122).
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"
import { parse } from "@std/yaml"

const COMPOSE = fromFileUrl(new URL("../infra/compose/compose.shared.yml", import.meta.url))

interface ComposeService {
  profiles?: string[]
  labels?: string[]
}

async function services(): Promise<Record<string, ComposeService>> {
  const compose = parse(await Deno.readTextFile(COMPOSE)) as {
    services?: Record<string, ComposeService>
  }
  if (!compose.services) throw new Error(`${COMPOSE} has no services`)
  return compose.services
}

function label(service: ComposeService | undefined, key: string): string | undefined {
  const prefix = `${key}=`
  return service?.labels?.find((entry) => entry.startsWith(prefix))?.slice(prefix.length)
}

Deno.test("the MPA is in the mpa profile only, and the SPA is in no profile", async () => {
  const all = await services()
  expect(all.mpa?.profiles).toEqual(["mpa"])
  expect(all.spa?.profiles, "the default deploy keeps serving the SPA").toBeUndefined()
})

Deno.test("the MPA takes the SPA's traffic but leaves /api and /ws to the API", async () => {
  const { mpa, spa } = await services()
  const rule = label(mpa, "traefik.http.routers.mpa-${PROJECT}.rule")
  expect(rule).toBe(label(spa, "traefik.http.routers.spa-${PROJECT}.rule"))
  expect(rule).toContain("!PathPrefix(`/api`)")
  expect(rule).toContain("!PathPrefix(`/ws`)")
  // Traefik's default priority is the rule's length; the SPA's router has none set.
  expect(Number(label(mpa, "traefik.http.routers.mpa-${PROJECT}.priority"))).toBeGreaterThan(
    (rule ?? "").length,
  )
})
