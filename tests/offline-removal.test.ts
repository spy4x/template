/// <reference lib="deno.ns" />
/**
 * Keeps `docs/offline.md`'s removal steps true. A product deletes the offline layer by following
 * them, so every file outside `apps/spa/src/offline/` that imports the folder must be named there,
 * and so must every file that imports the shared offline-shell cache into the service worker.
 * Only the composition root, `apps/spa/src/modules.ts`, may import the folder (ADR 003).
 */

import { expect } from "@std/expect"
import { walk } from "@std/fs/walk"
import { fromFileUrl, relative } from "@std/path"

const ROOT = fromFileUrl(new URL("../", import.meta.url))

/** SPA files, outside the offline folder, that import `offline/` or the shared shell cache. */
async function filesUsingTheLayer(): Promise<string[]> {
  const found: string[] = []
  const entries = walk(`${ROOT}apps/spa`, {
    includeDirs: false,
    exts: [".ts", ".tsx", ".js"],
    skip: [/[\\/](node_modules|dist)[\\/]/, /[\\/]src[\\/]offline[\\/]/],
  })
  for await (const entry of entries) {
    const source = await Deno.readTextFile(entry.path)
    if (/from "(\.\.?\/)+offline\/|@spy4x\/platform\/browser\/offline-shell/.test(source)) {
      found.push(relative(ROOT, entry.path))
    }
  }
  return found.sort()
}

Deno.test("docs/offline.md names every file that uses the offline layer", async () => {
  const docs = await Deno.readTextFile(`${ROOT}docs/offline.md`)
  const removal = docs.slice(docs.indexOf("## Removing the layer"))
  const users = await filesUsingTheLayer()
  // An empty walk would pass silently, so require the files the layer cannot lose.
  expect(users).toContain("apps/spa/src/modules.ts")
  expect(users).toContain("apps/spa/src/sw.ts")
  const unnamed = users.filter((file) => !removal.includes(`\`${file}\``))
  expect(unnamed).toEqual([])
})

Deno.test("only the composition root imports the offline folder", async () => {
  const importers: string[] = []
  const entries = walk(`${ROOT}apps/spa`, {
    includeDirs: false,
    exts: [".ts", ".tsx", ".js"],
    skip: [/[\\/](node_modules|dist)[\\/]/, /[\\/]src[\\/]offline[\\/]/],
  })
  for await (const entry of entries) {
    const source = await Deno.readTextFile(entry.path)
    if (/(from|import\()\s*"(\.\.?\/)+offline\//.test(source)) {
      importers.push(relative(ROOT, entry.path))
    }
  }
  expect(importers).toEqual(["apps/spa/src/modules.ts"])
})
