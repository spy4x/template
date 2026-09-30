import { App, staticFiles } from "fresh"
import { readMpaConfig } from "./config.ts"
import { pageMiddleware } from "./middleware.ts"
import type { State } from "./utils.ts"

export const app = new App<State>()

app.use(staticFiles())
app.use(pageMiddleware(readMpaConfig(Deno.env)))
app.fsRoutes()
