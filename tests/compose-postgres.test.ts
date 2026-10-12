/// <reference lib="deno.ns" />
/**
 * Holds the Postgres version and its data directory. Development and production
 * (`infra/compose/compose.shared.yml`), CI (`.woodpecker/ci.yml`) and the local browser run
 * (`infra/scripts/e2e-local.sh`) must name the same Postgres 18 minor version, or a test passes on
 * one version and production runs another. The two documents that print the image must name it
 * too. The Postgres 18 image keeps its data under `/var/lib/postgresql`, in a host directory of
 * its own: mounted at the old path, or on the Postgres 16 directory, it would start empty or not
 * at all (docs/postgres-18-upgrade.md).
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"
import { parse } from "@std/yaml"
import { NEW_DATA_DIR, OLD_DATA_DIR } from "../infra/scripts/postgres-data.ts"

const ROOT = new URL("../", import.meta.url)
const read = (path: string) => Deno.readTextFile(fromFileUrl(new URL(path, ROOT)))

const COMPOSE = "infra/compose/compose.shared.yml"
/** Every file that names the Postgres image, and how many times it must. */
const IMAGE_PLACES = [
  COMPOSE,
  ".woodpecker/ci.yml",
  "infra/scripts/e2e-local.sh",
  "docs/handoff.md",
  "docs/woodpecker-ci-setup.md",
]

/** The tags of every `postgres:<tag>` image in `text`. Other images (`postgres-exporter`) are not matched. */
export function postgresTags(text: string): string[] {
  return [...text.matchAll(/(?<![\w-])postgres:([\w.-]+)/g)].map((match) => match[1])
}

/** `18.6` and `18.6-alpine` give `18.6`; a tag that is not an exact 18 minor gives `undefined`. */
export function pinnedMinor(tag: string): string | undefined {
  return /^(18\.\d+)(-alpine)?$/.exec(tag)?.[1]
}

async function dbService(): Promise<{ image?: string; volumes?: string[] }> {
  const compose = parse(await read(COMPOSE)) as {
    services?: Record<string, { image?: string; volumes?: string[] }>
  }
  const db = compose.services?.db
  if (!db) throw new Error(`${COMPOSE} has no db service`)
  return db
}

Deno.test("only an exact Postgres 18 minor counts as pinned", () => {
  expect(pinnedMinor("18.6")).toBe("18.6")
  expect(pinnedMinor("18.6-alpine")).toBe("18.6")
  for (const loose of ["18", "18-alpine", "latest", "16", "16.4", "17.2", "19.0", "18.x"]) {
    expect({ tag: loose, minor: pinnedMinor(loose) }).toEqual({ tag: loose, minor: undefined })
  }
})

Deno.test("the Compose database is pinned to a Postgres 18 minor version", async () => {
  const image = (await dbService()).image ?? ""
  expect(image.startsWith("postgres:")).toBe(true)
  expect({ image, minor: pinnedMinor(image.slice("postgres:".length)) }).not.toEqual({
    image,
    minor: undefined,
  })
})

Deno.test("Compose, CI, the local browser run and the docs name the same Postgres 18 minor", async () => {
  const minors: Record<string, (string | undefined)[]> = {}
  for (const place of IMAGE_PLACES) {
    const tags = postgresTags(await read(place))
    // A place that stops naming the image must leave this list, not pass unseen.
    expect({ place, images: tags.length > 0 }).toEqual({ place, images: true })
    minors[place] = tags.map(pinnedMinor)
  }
  const expected = pinnedMinor(postgresTags(await read(COMPOSE))[0])
  expect(expected).toBeDefined()
  for (const place of IMAGE_PLACES) {
    expect({ place, minors: minors[place] }).toEqual({
      place,
      minors: minors[place].map(() => expected),
    })
  }
})

Deno.test("Postgres 18 keeps its data under /var/lib/postgresql, in a directory of its own", async () => {
  const mounts = ((await dbService()).volumes ?? []).map((volume) => volume.split(":"))
  // Compose resolves the host path from infra/compose, the scripts from the root.
  const host = (dir: string) => dir.replace(/^\.\//, "../../")
  expect(mounts).toEqual([[host(NEW_DATA_DIR), "/var/lib/postgresql", "Z"]])
  expect(NEW_DATA_DIR).not.toBe(OLD_DATA_DIR)
})
