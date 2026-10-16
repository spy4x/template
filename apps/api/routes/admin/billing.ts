import { Hono } from "hono"
import type { APIContext } from "../../_types.ts"
import type { AdminApiModule } from "./module.ts"

/** The `billing` module of the operator area: registered, with no routes yet (#424). */
export const billingAdminModule: AdminApiModule = {
  id: `billing`,
  routes: () => new Hono<APIContext>(),
}
