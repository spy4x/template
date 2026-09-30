/// <reference lib="deno.ns" />
/**
 * Keeps `docs/offline.md`'s removal steps true. A product deletes the offline layer by following
 * them, so every file outside `apps/spa/src/offline/` that imports the folder must be named there,
 * and the service worker's one `importScripts` line must be there too.
 */

import { expect } from "@std/expect"
import { walk } from "@std/fs/walk"
import { fromFileUrl, relative } from "@std/path"

const ROOT = fromFileUrl(new URL("../", import.meta.url))

/** Files of the SPA, outside the offline folder, whose source mentions `offline/` or the shell file. */
async function filesUsingTheLayer(): Promise<string[]> {
  const found: string[] = []
  const entries = walk(`${ROOT}apps/spa`, {
    includeDirs: false,
    exts: [".ts", ".tsx", ".js"],
    skip: [/[\\/](node_modules|dist)[\\/]/, /[\\/]src[\\/]offline[\\/]/, /offline-shell\.js$/],
  })
  for await (const entry of entries) {
    const source = await Deno.readTextFile(entry.path)
    if (/from "(\.\.?\/)+offline\/|importScripts\("\/offline-shell\.js"\)/.test(source)) {
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
  expect(users).toContain("apps/spa/src/app.tsx")
  expect(users).toContain("apps/spa/public/sw.js")
  const unnamed = users.filter((file) => !removal.includes(`\`${file}\``))
  expect(unnamed).toEqual([])
})
