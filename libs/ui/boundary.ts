/// <reference lib="deno.ns" />
/// <reference lib="deno.unstable" />
/**
 * Keeps `libs/ui` a library of dumb screens: a lint rule that reports a file importing a store, a
 * router or an app's code, or reaching for `fetch`, `window` or another browser global. State and
 * transport belong to each app; see "Three layers" in the repository's `AGENTS.md`.
 *
 * `tests/ui-boundary.test.ts` runs it over every module here. It is not listed under `lint.plugins` in
 * `deno.json`: with a lint plugin in the workspace config, the `deno info` calls the SPA's Vite
 * plugin makes at startup stalled on the `node_modules` lock and the e2e run never started.
 */

/** Import sources a screen must not use: signals stores and the router. */
const FORBIDDEN_PACKAGES = [
  "@preact/signals",
  "@preact/signals-core",
  "@spy4x/preact-signals",
  "wouter-preact",
]

/** Import aliases that point into an app. */
const APP_ALIASES = ["@api/", "@spa/", "@mpa/", "@worker/"]

/** Globals that fetch, route or read the page: a screen gets all of this through props. */
const FORBIDDEN_GLOBALS = new Set([
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "window",
  "document",
  "location",
  "history",
  "navigator",
  "localStorage",
  "sessionStorage",
])

/** Why an import source is forbidden, or `null` when it is allowed. */
export function forbiddenImport(source: string, filename: string): string | null {
  const bare = source.replace(/^(jsr|npm):/, "")
  if (FORBIDDEN_PACKAGES.some((name) => bare === name || bare.startsWith(`${name}/`))) {
    return `"${source}" is a store or a router; take state as props, report through callbacks.`
  }
  if (APP_ALIASES.some((alias) => source.startsWith(alias))) {
    return `"${source}" is app code; libs/ui must not import from an app.`
  }
  if (source.startsWith(".")) {
    const resolved = new URL(source, `file://${filename.replaceAll("\\", "/")}`).pathname
    if (/\/apps\//.test(resolved)) {
      return `"${source}" is app code; libs/ui must not import from an app.`
    }
  }
  return null
}

/** Whether an identifier here names a variable, rather than a property or a key. */
function isReference(node: Deno.lint.Identifier): boolean {
  const parent = node.parent
  if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) {
    return false
  }
  if (parent.type === "Property" && parent.key === node && !parent.computed) return false
  if (
    (parent.type === "TSPropertySignature" || parent.type === "PropertyDefinition" ||
      parent.type === "MethodDefinition") && parent.key === node && !parent.computed
  ) return false
  if (parent.type === "JSXAttribute") return false
  return true
}

/** Whether an identifier is a property read off the global object, as in `globalThis.fetch`. */
function isGlobalProperty(node: Deno.lint.Identifier): boolean {
  const parent = node.parent
  return parent.type === "MemberExpression" && parent.property === node &&
    parent.object.type === "Identifier" &&
    (parent.object.name === "globalThis" || parent.object.name === "self")
}

const plugin: Deno.lint.Plugin = {
  name: "ui",
  rules: {
    "boundary": {
      create(context) {
        const checkSource = (node: Deno.lint.Node, source: string) => {
          const reason = forbiddenImport(source, context.filename)
          if (reason) context.report({ node, message: reason })
        }
        return {
          ImportDeclaration(node) {
            checkSource(node, node.source.value)
          },
          ExportNamedDeclaration(node) {
            if (node.source) checkSource(node, node.source.value)
          },
          ExportAllDeclaration(node) {
            checkSource(node, node.source.value)
          },
          ImportExpression(node) {
            if (node.source.type === "Literal" && typeof node.source.value === "string") {
              checkSource(node, node.source.value)
            }
          },
          Identifier(node) {
            if (!FORBIDDEN_GLOBALS.has(node.name)) return
            if (!isReference(node) && !isGlobalProperty(node)) return
            context.report({
              node,
              message: `"${node.name}" reaches outside the screen; take it through props instead.`,
            })
          },
        }
      },
    },
  },
}

export default plugin
