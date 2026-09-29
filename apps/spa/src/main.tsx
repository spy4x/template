// Preact DevTools bridge import must be FIRST for correct detection
if (getEnvVar("ENV") === "dev") {
  import("preact/debug").then(() => console.log("Preact DevTools bridge loaded"))
}
import { render } from "preact"
import { App } from "./app.tsx"
import { getEnvVar } from "@client/vite/env.ts"
import { createThemeStore } from "@spy4x/preact-signals/theme"

// Follows the system light/dark setting. `index.html` paints the stored choice before this runs.
createThemeStore().attach()

render(<App />, document.getElementById("app") as HTMLElement)
