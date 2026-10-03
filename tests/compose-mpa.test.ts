/// <reference lib="deno.ns" />
/**
 * Holds the optional `mpa` service in `infra/compose/compose.shared.yml` to what the README's
 * "SPA or MPA" section promises: it exists only under the `mpa` profile, so the default deploy
 * stays the SPA alone, and when it runs it takes `MPA_DOMAIN`, or else `DOMAIN` except `/api` and
 * `/ws`, ahead of the SPA's router (spy4x/template#122).
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"
import { parse } from "@std/yaml"

const COMPOSE = fromFileUrl(new URL("../infra/compose/compose.shared.yml", import.meta.url))

interface ComposeService {
  profiles?: string[]
  labels?: string[]
  environment?: string[]
}

const COMPOSE_PROD = fromFileUrl(new URL("../infra/compose/compose.prod.yml", import.meta.url))

async function services(file = COMPOSE): Promise<Record<string, ComposeService>> {
  const compose = parse(await Deno.readTextFile(file)) as {
    services?: Record<string, ComposeService>
  }
  if (!compose.services) throw new Error(`${file} has no services`)
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

Deno.test("without MPA_DOMAIN the MPA takes the SPA's traffic but leaves /api and /ws to the API", async () => {
  const { mpa, spa } = await services()
  const rule = label(mpa, "traefik.http.routers.mpa-${PROJECT}.rule")
  expect(rule).toContain("Host(`${MPA_DOMAIN:-${DOMAIN}}`)")
  // Compose resolves the host to DOMAIN when MPA_DOMAIN is unset or empty: the SPA's own rule.
  expect(rule?.replace("${MPA_DOMAIN:-${DOMAIN}}", "${DOMAIN}"))
    .toBe(label(spa, "traefik.http.routers.spa-${PROJECT}.rule"))
  expect(rule).toContain("!PathPrefix(`/api`)")
  expect(rule).toContain("!PathPrefix(`/ws`)")
  // Traefik's default priority is the rule's length; the SPA's router has none set.
  expect(Number(label(mpa, "traefik.http.routers.mpa-${PROJECT}.priority"))).toBeGreaterThan(
    (rule ?? "").length,
  )
})

Deno.test("the MPA learns its own host, or it would refuse its own forms", async () => {
  const { mpa } = await services()
  expect(mpa?.environment).toContain("MPA_DOMAIN=${MPA_DOMAIN:-}")
})

Deno.test("in production the MPA is served over HTTPS on the port its image listens on", async () => {
  const { mpa } = await services(COMPOSE_PROD)
  const router = "traefik.http.routers.mpa-${PROJECT}"
  expect(label(mpa, `${router}.entrypoints`)).toBe("websecure")
  expect(label(mpa, `${router}.tls`)).toBe("true")
  expect(label(mpa, `${router}.tls.certresolver`)).toContain("TRAEFIK_CERT_RESOLVER")
  const shared = (await services()).mpa
  expect(label(shared, "traefik.http.services.mpa-${PROJECT}.loadbalancer.server.port")).toBe(
    "8080",
  )
})
