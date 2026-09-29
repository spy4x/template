/// <reference lib="deno.ns" />
import { defineConfig } from "vite"
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
