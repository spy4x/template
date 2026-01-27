import { Hono } from "hono"
import { APIContext } from "../_types.ts"
import { isAuthenticated2FA } from "../middlewares/auth.ts"
import { wsHub } from "@api/services/wsHub.ts"
import { requestInfoFromContext } from "@api/services/request-info.ts"

export const wsRoute = new Hono<APIContext>()
  .use(isAuthenticated2FA)
  .get("/profile", (c) => {
    const auth = c.get("auth")
    if (!auth) {
      return c.json({ error: "Not authenticated" }, 401)
    }
    return wsHub.upgradeProfile(c, auth.user.id, requestInfoFromContext(c))
  })
