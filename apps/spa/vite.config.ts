/// <reference lib="deno.ns" />
import { defineConfig, type DevEnvironment, type Environment, type Plugin } from "vite"
import { dirname } from "@std/path"
import deno from "@deno/vite-plugin"
import preact from "@preact/preset-vite"
import tailwindcss from "@tailwindcss/vite"
import { COMPONENT_CLASSES, PRESET_CSS, TOKENS_CSS } from "@spy4x/preact-theme"

/** The `@import` lines in `src/app.css` this plugin answers, and the text each one stands for. */
const THEME_STYLESHEETS: Record<string, string> = {
  "@spy4x/preact-theme/tokens.css": TOKENS_CSS,
  "@spy4x/preact-theme/preset.css": PRESET_CSS,
}

/**
 * Gives `src/app.css` the `@spy4x/preact-*` design system before Tailwind compiles it.
 *
 * JSR cannot publish a CSS file as an importable module, so `@spy4x/preact-theme` exports each
 * stylesheet's text instead, and the class names its components render as `COMPONENT_CLASSES` (its
 * README, "Install"). This replaces each theme `@import` line with that text and appends one
 * `@source inline(...)` line with the class names. Tailwind cannot scan the library's files: Deno
 * keeps them in its cache, and inside the Alpine image Tailwind's scanner reads none of them
 * (spy4x/preact-components#323). It runs before `@tailwindcss/vite`, which has to be listed after
 * it.
 */
function preactComponentsCss(): Plugin {
  return {
    name: "preact-components-css",
    enforce: "pre",
    transform(code, id) {
      // The dev server asks for a linked stylesheet as `app.css?direct`, so drop the query first.
      if (!id.split("?")[0].endsWith("/src/app.css")) return
      let css = code
      for (const [specifier, text] of Object.entries(THEME_STYLESHEETS)) {
        const line = `@import "${specifier}";`
        if (!css.includes(line)) throw new Error(`src/app.css must contain ${line}`)
        css = css.replace(line, () => text)
      }
      return `${css}\n@source inline("${COMPONENT_CLASSES}");\n`
    },
  }
}

/** Selectors only the library's components produce; the built CSS must contain every one. */
const REQUIRED_SELECTORS = [".lg\\:w-64", ".sr-only", ".focus\\:not-sr-only"]

/**
 * Fails the build when the CSS it wrote lacks the library's classes.
 *
 * Without them the signed-in layout renders unstyled, yet Tailwind still exits 0: that is how the
 * Alpine image once shipped without them. Checking a few selectors only `Shell` renders catches a
 * build where the library's class names never reached Tailwind.
 */
function requireComponentCss(): Plugin {
  return {
    name: "require-component-css",
    apply: "build",
    generateBundle(_options, bundle) {
      const css = Object.values(bundle)
        .filter((file) => file.type === "asset" && file.fileName.endsWith(".css"))
        .map((file) => file.type === "asset" ? String(file.source) : "")
        .join("\n")
      const missing = REQUIRED_SELECTORS.filter((selector) => !css.includes(selector))
      if (missing.length > 0) {
        this.error(`The built CSS lacks the library's classes: ${missing.join(", ")}`)
      }
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

/**
 * The version of npm package `name` that Vite resolved as `resolvedId`, read from the package's
 * own `package.json`. In the dev server `resolvedId` is Vite's pre-bundled copy under
 * `.vite/deps/`, which carries no version, so the original file comes from the dependency
 * optimizer's record of it (`key` is the import it was bundled for, such as `preact/hooks`).
 */
async function resolvedVersion(
  environment: Environment,
  name: string,
  key: string,
  resolvedId: string,
): Promise<string> {
  let file = resolvedId.split("?")[0]
  if (file.includes("/.vite/deps/")) {
    const metadata = (environment as DevEnvironment).depsOptimizer?.metadata
    const source = metadata?.optimized[key]?.src ?? metadata?.discovered[key]?.src
    if (!source) throw new Error(`Cannot find the source of Vite's pre-bundled ${key}`)
    file = source
  }
  for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
    let manifest: { name?: string; version?: string }
    try {
      manifest = JSON.parse(await Deno.readTextFile(`${dir}/package.json`))
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue
      throw error
    }
    if (manifest.name === name && manifest.version) return manifest.version
  }
  throw new Error(`Cannot find the package.json of ${name} above ${file}`)
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
      const actual = await resolvedVersion(this.environment, name, `${name}${subpath}`, resolved.id)
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
    requireComponentCss(),
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
