/// <reference lib="deno.ns" />
import { defineConfig, type Plugin } from "vite"
import deno from "@deno/vite-plugin"
import preact from "@preact/preset-vite"
import tailwindcss from "@tailwindcss/vite"
import { PRESET_CSS, TOKENS_CSS } from "@spy4x/preact-theme"

/** The `@import` lines in `src/app.css` this plugin answers, and the text each one stands for. */
const THEME_STYLESHEETS: Record<string, string> = {
  "@spy4x/preact-theme/tokens.css": TOKENS_CSS,
  "@spy4x/preact-theme/preset.css": PRESET_CSS,
}

/** Modules whose class names Tailwind must see: every `@spy4x/preact-*` package on JSR. */
const LIBRARY_PREFIX = "https://jsr.io/@spy4x/preact-"

/**
 * Lists the on-disk copies Deno keeps of every `@spy4x/preact-*` module `entry` imports, directly
 * or through another package, so Tailwind can scan them for class names.
 *
 * Tailwind finds classes by scanning files, and a JSR package has no directory in the project to
 * point `@source` at: Deno stores each module under a hashed file name in its own cache. `deno info`
 * is how `@deno/vite-plugin` finds those files too.
 */
async function librarySourceFiles(entry: string): Promise<string[]> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["info", "--json", entry],
    stdout: "piped",
    stderr: "piped",
  }).output()
  if (!output.success) {
    throw new Error(`deno info ${entry} failed: ${new TextDecoder().decode(output.stderr)}`)
  }
  const graph = JSON.parse(new TextDecoder().decode(output.stdout)) as {
    modules: { specifier: string; local?: string }[]
  }
  return graph.modules
    .filter((module) => module.specifier.startsWith(LIBRARY_PREFIX) && module.local)
    .map((module) => module.local as string)
    .sort()
}

/**
 * Gives `src/app.css` the `@spy4x/preact-*` design system before Tailwind compiles it.
 *
 * JSR cannot publish a CSS file as an importable module, so `@spy4x/preact-theme` exports each
 * stylesheet's text instead (its README, "Install"). This replaces each theme `@import` line with
 * that text and adds one `@source` per library module the app imports, so the classes the library's
 * components render are emitted. It runs before `@tailwindcss/vite`, which has to be listed after
 * it.
 */
function preactComponentsCss(): Plugin {
  return {
    name: "preact-components-css",
    enforce: "pre",
    async transform(code, id) {
      if (!id.split("?")[0].endsWith("/src/app.css")) return
      let css = code
      for (const [specifier, text] of Object.entries(THEME_STYLESHEETS)) {
        const line = `@import "${specifier}";`
        if (!css.includes(line)) throw new Error(`src/app.css must contain ${line}`)
        css = css.replace(line, () => text)
      }
      const sources = await librarySourceFiles(new URL("./src/main.tsx", import.meta.url).href)
      if (sources.length === 0) {
        throw new Error("src/main.tsx imports no @spy4x/preact-* module; nothing to scan")
      }
      return `${css}\n${sources.map((path) => `@source "${path}";`).join("\n")}\n`
    },
  }
}

/** Thrown when a library module pins an npm package at a version the app does not have. */
export class NpmVersionMismatchError extends Error {
  override name = "NpmVersionMismatchError"
  constructor(specifier: string, resolvedVersion: string, importer: string | undefined) {
    super(
      `${specifier} (imported by ${
        importer ?? "unknown"
      }) resolved to version ${resolvedVersion}. ` +
        "Pin the same version in the root deno.jsonc, or use a library release pinned to the app's.",
    )
  }
}

/** The `version` of the package whose `node_modules/<name>/` directory holds `file`. */
async function installedVersion(name: string, file: string): Promise<string> {
  const marker = `/node_modules/${name}/`
  const at = file.lastIndexOf(marker)
  if (at === -1) throw new Error(`Cannot find the package directory of ${name} in ${file}`)
  const manifest = await Deno.readTextFile(`${file.slice(0, at + marker.length)}package.json`)
  return (JSON.parse(manifest) as { version: string }).version
}

/**
 * Resolves the `npm:` specifiers inside `@spy4x/preact-*` modules to the app's own copy of that
 * package, and refuses one whose pinned version differs from the app's.
 *
 * `@deno/vite-plugin` 1.0.6 turns `npm:@preact/signals@2.5.1` into an empty module id (it cuts a
 * scoped name at its first `@`) and drops the subpath of `npm:/preact@10.29.8/hooks`, so the build
 * fails. A page must load exactly one preact anyway, so each specifier resolves to the bare package
 * plus its subpath, and the build fails with {@link NpmVersionMismatchError} when the app's copy is
 * not the version the specifier names. Listed before `deno()` so it runs first.
 */
function npmSpecifiers(): Plugin {
  return {
    name: "npm-specifiers",
    enforce: "pre",
    async resolveId(id, importer) {
      const match = /^npm:\/?((?:@[^/@]+\/)?[^/@]+)(?:@([^/]+))?(\/.*)?$/.exec(id)
      if (!match) return
      const [, name, version, subpath = ""] = match
      const resolved = await this.resolve(`${name}${subpath}`, importer, { skipSelf: true })
      if (!resolved || version === undefined) return resolved
      const actual = await installedVersion(name, resolved.id.split("?")[0])
      if (actual !== version) throw new NpmVersionMismatchError(id, actual, importer)
      return resolved
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    npmSpecifiers(),
    deno(),
    preact(),
    preactComponentsCss(),
    tailwindcss(),
  ],
  server: {
    host: "0.0.0.0",
    watch: {
      ignored: [
        "!../../libs/client/**",
        "!../../libs/domain/**",
        "!../../libs/platform/**",
      ],
    },
  },
})
