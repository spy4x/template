// Must be the first import: arktype requires its global config before any schema is built, and
// domain schemas are built as modules load, transitively, once `./app.tsx` is imported below.
import "@platform/helpers/arktype-config.ts"
import { render } from "preact"
import { App } from "./app.tsx"
import { getEnvVar } from "@client/vite/env.ts"

// Preact DevTools bridge import must be FIRST for correct detection
if (getEnvVar("ENV") === "dev") {
  import("preact/debug").then(() => console.log("Preact DevTools bridge loaded"))
}

if ("serviceWorker" in navigator) {
  globalThis.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined)
  })
}

render(<App />, document.getElementById("app") as HTMLElement)
