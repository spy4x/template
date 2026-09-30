/// <reference lib="deno.ns" />
import { defineConfig } from "vite"
import { fromFileUrl } from "@std/path"
import deno from "@deno/vite-plugin"
import preact from "@preact/preset-vite"
import tailwindcss from "@tailwindcss/vite"
import { themeBootstrapScript } from "@spy4x/preact-signals/theme"
import { npmSpecifiers, preactThemeCss, requireComponentCss } from "@spy4x/preact-theme/vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    npmSpecifiers({ readTextFile: Deno.readTextFile }),
    deno(),
    preact(),
    preactThemeCss(),
    tailwindcss(),
    requireComponentCss(),
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
