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
        css = css.replace(line, text)
      }
      const sources = await librarySourceFiles(new URL("./src/main.tsx", import.meta.url).href)
      if (sources.length === 0) {
        throw new Error("src/main.tsx imports no @spy4x/preact-* module; nothing to scan")
      }
      return `${css}\n${sources.map((path) => `@source "${path}";`).join("\n")}\n`
    },
  }
}

/**
 * Resolves the `npm:` specifiers inside `@spy4x/preact-*` modules to the app's own copy of that
 * package.
 *
 * `@deno/vite-plugin` 1.0.6 turns `npm:@preact/signals@2.5.1` into an empty module id (it cuts a
 * scoped name at its first `@`) and drops the subpath of `npm:/preact@10.29.8/hooks`, so the build
 * fails. The library pins the same preact and signals versions as the root import map, and a page
 * must load exactly one preact anyway, so each specifier resolves to the bare package plus its
 * subpath. Listed before `deno()` so it runs first.
 */
function npmSpecifiers(): Plugin {
  return {
    name: "npm-specifiers",
    enforce: "pre",
    resolveId(id, importer) {
      const match = /^npm:\/?((?:@[^/@]+\/)?[^/@]+)(?:@[^/]+)?(\/.*)?$/.exec(id)
      if (!match) return
      return this.resolve(`${match[1]}${match[2] ?? ""}`, importer, { skipSelf: true })
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
