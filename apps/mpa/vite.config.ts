/// <reference lib="deno.ns" />
import { fresh } from "@fresh/plugin-vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import { fromFileUrl } from "@std/path"
import { preactThemeCss, requireComponentCss } from "@spy4x/preact-theme/vite"

export default defineConfig({
  plugins: [
    fresh(),
    preactThemeCss({ stylesheet: "/apps/mpa/styles.css" }),
    tailwindcss(),
    // The client build carries the stylesheet; the server build has none to check.
    {
      ...requireComponentCss(),
      applyToEnvironment: (environment) => environment.name === "client",
    },
  ],
  resolve: {
    // As in the SPA: Vite, not the Deno loader, must load libs/ui, or its JSX compiles for React.
    alias: [{
      find: /^@ui\//,
      replacement: fromFileUrl(new URL("../../libs/ui/", import.meta.url)),
    }],
  },
})
