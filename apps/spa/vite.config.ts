/// <reference lib="deno.ns" />
import { build, defineConfig } from "vite"
import { fromFileUrl } from "@std/path"
import deno from "@deno/vite-plugin"
import preact from "@preact/preset-vite"
import tailwindcss from "@tailwindcss/vite"
import { themeBootstrapScript } from "@spy4x/preact-signals/theme"
import {
  npmSpecifiers,
  preactThemeCss,
  requireComponentCss,
  serviceWorker,
} from "@spy4x/preact-theme/vite"

const SW_ENTRY = fromFileUrl(new URL("./src/sw.ts", import.meta.url))

/** The worker bundled as one classic script, the way `serviceWorker()` writes it for a build. */
async function bundleWorker(buildId: string): Promise<string> {
  const result = await build({
    configFile: false,
    publicDir: false,
    logLevel: "warn",
    plugins: [deno()],
    define: { __BUILD_ID__: JSON.stringify(buildId) },
    build: {
      write: false,
      lib: { entry: SW_ENTRY, formats: ["iife"], name: "sw", fileName: () => "sw.js" },
    },
  })
  const outputs = (Array.isArray(result) ? result : [result]) as Array<{
    output: Array<{ type: string; code?: string }>
  }>
  const chunk = outputs[0].output.find((file) => file.type === "chunk")
  if (!chunk?.code) throw new Error("the worker build produced no script")
  return chunk.code
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    npmSpecifiers({ readTextFile: Deno.readTextFile }),
    deno(),
    preact(),
    preactThemeCss(),
    tailwindcss(),
    requireComponentCss(),
    // A build writes `dist/sw.js`, named after a hash of the built files.
    serviceWorker({
      entry: SW_ENTRY,
      build,
      plugins: [deno()],
      readDir: Deno.readDir,
      readFile: Deno.readFile,
    }),
    {
      // The dev server has no `dist`, so it serves the same worker from memory at `/sw.js`. Without
      // it the e2e offline specs, which run against the dev server, would have no worker.
      name: "dev-service-worker",
      apply: "serve",
      configureServer(server) {
        let script: Promise<string> | undefined
        server.middlewares.use("/sw.js", (_request, response, next) => {
          script ??= bundleWorker("dev")
          script.then((code) => {
            response.setHeader("Content-Type", "text/javascript")
            response.setHeader("Cache-Control", "no-cache")
            response.end(code)
          }, next)
        })
      },
    },
    {
      // Paints the stored (or system) light/dark choice before the first frame, so a dark reader
      // never sees a light flash. `index.html` cannot call the library, so the build injects it.
      name: "theme-bootstrap",
      transformIndexHtml: () => [{
        tag: "script",
        children: themeBootstrapScript(),
        injectTo: "head-prepend" as const,
      }],
    },
  ],
  resolve: {
    // Vite, not the Deno plugin, must load libs/ui: the Deno plugin compiles JSX for React, so a
    // screen loaded through it fails at runtime with "React is not defined".
    alias: [{
      find: /^@ui\//,
      replacement: fromFileUrl(new URL("../../libs/ui/", import.meta.url)),
    }],
  },
  optimizeDeps: {
    // These come in through the Deno plugin's resolver, which the dev server's dependency scan
    // does not follow: tailwind-merge (through the JSR package @spy4x/preact-cn) and
    // arktype (through @spy4x/validation and its siblings). Found late, each triggers a re-bundle
    // that leaves a page that loaded meanwhile blank ("Outdated Optimize Dep"), so they are named
    // up front.
    include: ["tailwind-merge", "arktype"],
  },
  server: {
    host: "0.0.0.0",
    watch: {
      ignored: [
        "!../../libs/client/**",
        "!../../libs/domain/**",
        "!../../libs/platform/**",
        "!../../libs/ui/**",
      ],
    },
  },
})
