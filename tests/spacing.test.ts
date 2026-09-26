/// <reference lib="deno.ns" />
/**
 * Holds every spacing class in `apps/` and `libs/` to the scale `@spy4x/preact-theme/spacing`
 * owns: padding, margin, gap, `space-x/y` and scroll spacing use only its steps, never an
 * arbitrary value. The library's `docs/spacing.md` says which step goes where.
 */

import { findOffScaleSpacing } from "@spy4x/preact-theme/spacing"
import { expect } from "@std/expect"
import { walk } from "@std/fs/walk"
import { fromFileUrl, relative } from "@std/path"

const ROOT = fromFileUrl(new URL("../", import.meta.url))

/** Source directories to check. */
const SOURCE_DIRS = ["apps", "libs"]

/**
 * Build output and caches, which hold compiled classes rather than source, and test files, which
 * spell out classes to assert on.
 */
const SKIP = [/[\\/](node_modules|dist|build|\.vite|_fresh)[\\/]/, /\.test\.tsx?$/]

/** Every source file under {@link SOURCE_DIRS}, relative to the repository root. */
async function sourceFiles(): Promise<string[]> {
  const files: string[] = []
  for (const dir of SOURCE_DIRS) {
    const entries = walk(`${ROOT}${dir}`, {
      includeDirs: false,
      exts: [".ts", ".tsx", ".css", ".html"],
      skip: SKIP,
    })
    for await (const entry of entries) files.push(relative(ROOT, entry.path))
  }
  return files.sort()
}

Deno.test("every spacing class in apps/ and libs/ is on the scale", async () => {
  const files = await sourceFiles()
  // An empty walk would pass silently, so require a file the SPA cannot lose.
  expect(files).toContain("apps/spa/src/app.tsx")
  const found: string[] = []
  for (const file of files) {
    for (const v of findOffScaleSpacing(await Deno.readTextFile(`${ROOT}${file}`))) {
      found.push(`${file}:${v.line}:${v.column} ${v.className} — ${v.reason}`)
    }
  }
  expect(found).toEqual([])
})
