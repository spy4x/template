import { App, staticFiles } from "fresh"
import { readMpaConfig } from "./config.ts"
import { pageMiddleware, securityHeadersMiddleware } from "./middleware.ts"
import { createNewsletterStatus } from "./newsletter.ts"
import type { State } from "./utils.ts"

export const app = new App<State>()

const config = readMpaConfig(Deno.env)

app.use(await securityHeadersMiddleware(config))
app.use(staticFiles())
// Asked once before the first page, so that page already knows; then at most once a minute.
const newsletter = createNewsletterStatus({ apiUrl: config.apiUrl })
await newsletter.refresh()
app.use(pageMiddleware(config, globalThis.fetch, newsletter.isOn))
app.fsRoutes()
