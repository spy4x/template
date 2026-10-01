/// <reference lib="deno.ns" />
/**
 * Holds `.dockerignore` to one rule: nothing under `infra/envs` or `infra/configs` enters a build
 * context. On the server those folders hold the env file and the Web Push private key, and every
 * image copies its whole context (`COPY . .`), so a gap here bakes secrets into an image layer.
 */

import { expect } from "@std/expect"
import { fromFileUrl, globToRegExp } from "@std/path"

const ROOT = fromFileUrl(new URL("../", import.meta.url))

/**
 * Whether `.dockerignore` content keeps `path` out of the build context. The last matching rule
 * wins, `!` re-includes, and a rule that matches a folder also matches everything inside it.
 */
export function isIgnored(dockerignore: string, path: string): boolean {
  const parts = path.split("/")
  const candidates = parts.map((_, i) => parts.slice(0, i + 1).join("/"))
  let ignored = false
  for (const raw of dockerignore.split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const negated = line.startsWith("!")
    const pattern = globToRegExp(negated ? line.slice(1) : line, { extended: true, globstar: true })
    if (candidates.some((candidate) => pattern.test(candidate))) ignored = !negated
  }
  return ignored
}

Deno.test("keeps the server's env files and key files out of every build context", async () => {
  const rules = await Deno.readTextFile(`${ROOT}.dockerignore`)
  for (
    const path of [
      "infra/envs/.env",
      "infra/envs/.env.prod",
      "infra/configs/vapid.json",
      "infra/configs/nested/secret.json",
    ]
  ) {
    expect({ path, ignored: isIgnored(rules, path) }).toEqual({ path, ignored: true })
  }
})

Deno.test("still sends what the images need", async () => {
  const rules = await Deno.readTextFile(`${ROOT}.dockerignore`)
  for (
    const path of [
      "apps/api/index.ts",
      "libs/ui/frame.tsx",
      "infra/scripts/db-migrate.ts",
      "deno.lock",
    ]
  ) {
    expect({ path, ignored: isIgnored(rules, path) }).toEqual({ path, ignored: false })
  }
})
