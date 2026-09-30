/// <reference lib="deno.ns" />
/// <reference lib="deno.unstable" />
/**
 * Holds every module in `libs/ui` to the screen contract in `AGENTS.md`: no store, no router, no
 * app import, no `fetch` or page global. Walks the folder, so a new file is checked without being
 * listed anywhere. The rule itself lives in `libs/ui/boundary.ts`.
 */

import { expect } from "@std/expect"
import { walk } from "@std/fs/walk"
import { fromFileUrl, relative } from "@std/path"
import plugin from "../libs/ui/boundary.ts"

const ROOT = fromFileUrl(new URL("../", import.meta.url))

/** Every `.ts` and `.tsx` module in `libs/ui` but the tests, as absolute paths. */
async function uiModules(): Promise<string[]> {
  const files: string[] = []
  const entries = walk(`${ROOT}libs/ui`, {
    includeDirs: false,
    exts: [".ts", ".tsx"],
    skip: [/[\\/](node_modules|dist)[\\/]/, /\.test\.tsx?$/],
  })
  for await (const entry of entries) files.push(entry.path)
  return files.sort()
}

Deno.test("no module in libs/ui imports a store, router or app code or touches fetch or a page global", async () => {
  const files = await uiModules()
  // An empty walk would pass silently, so require a file the screens cannot lose.
  expect(files.map((file) => relative(ROOT, file))).toContain("libs/ui/auth-screen.tsx")
  const found: string[] = []
  for (const file of files) {
    const diagnostics = Deno.lint.runPlugin(plugin, file, await Deno.readTextFile(file))
    for (const diagnostic of diagnostics) {
      found.push(`${relative(ROOT, file)}: ${diagnostic.message}`)
    }
  }
  expect(found).toEqual([])
})
