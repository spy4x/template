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
  webManifest,
} from "@spy4x/preact-theme/vite"

import { nginxSecurityHeaders } from "@client/vite/nginx-security-headers.ts"

const SW_ENTRY = fromFileUrl(new URL("./src/sw.ts", import.meta.url))
const BUILT_PAGE = fromFileUrl(new URL("./dist/index.html", import.meta.url))
const SECURITY_HEADERS = fromFileUrl(new URL("./security-headers.conf", import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    npmSpecifiers({ readTextFile: Deno.readTextFile }),
    deno(),
    preact(),
    preactThemeCss(),
    tailwindcss(),
    requireComponentCss(),
    // A build writes `dist/sw.js`, named after a hash of the built files. The dev server serves the
    // same worker from memory at `/sw.js`, so the offline e2e specs, which run against it, have one.
    serviceWorker({
      entry: SW_ENTRY,
      build,
      plugins: [deno()],
      readDir: Deno.readDir,
      readFile: Deno.readFile,
    }),
    webManifest({
      writeTextFile: Deno.writeTextFile,
      manifest: {
        name: `App Template`,
        short_name: `App`,
        theme_color: `#581c87`,
        background_color: `#F3F4F6`,
        icons: [
          {
            src: `/img/android/android-launchericon-192-192.png`,
            sizes: `192x192`,
            type: `image/png`,
          },
          {
            src: `/img/android/android-launchericon-512-512.png`,
            sizes: `512x512`,
            type: `image/png`,
          },
          {
            src: `/img/pwa/maskable-192.png`,
            sizes: `192x192`,
            type: `image/png`,
            purpose: `maskable`,
          },
          {
            src: `/img/pwa/maskable-512.png`,
            sizes: `512x512`,
            type: `image/png`,
            purpose: `maskable`,
          },
        ],
      },
    }),
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
    {
      // nginx serves the built page, so it sends the security headers. The policy holds the hash of
      // each inline block of the built `index.html`, so the file nginx includes is written from
      // that page after every build, next to `dist` (`nginx.conf` says where it goes). The hook
      // is the one that runs once the page is written and never after a failed build, whose own
      // error it would otherwise hide.
      name: "nginx-security-headers",
      apply: "build" as const,
      writeBundle: async () => {
        const page = await Deno.readTextFile(BUILT_PAGE)
        await Deno.writeTextFile(SECURITY_HEADERS, await nginxSecurityHeaders(page))
      },
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
