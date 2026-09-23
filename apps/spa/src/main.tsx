// Preact DevTools bridge import must be FIRST for correct detection
if (getEnvVar("ENV") === "dev") {
  import("preact/debug").then(() => console.log("Preact DevTools bridge loaded"))
}
import { render } from "preact"
import { App } from "./app.tsx"
import { getEnvVar } from "@client/vite/env.ts"

if ("serviceWorker" in navigator) {
  globalThis.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined)
  })
}

render(<App />, document.getElementById("app") as HTMLElement)
