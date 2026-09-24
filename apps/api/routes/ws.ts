import { Hono } from "hono"
import { APIContext } from "../_types.ts"
import { isAuthenticated2FA } from "@api/services/auth.ts"
import { wsHub } from "@api/services/wsHub.ts"
import { requestInfoFromContext } from "@spy4x/platform/request-info"

export const wsRoute = new Hono<APIContext>()
  .use(isAuthenticated2FA)
  .get("/profile", (c) => {
    const auth = c.get("auth")
    if (!auth) {
      return c.json({ error: "Not authenticated" }, 401)
    }
    // trustedProxy: true keeps the old behaviour of trusting X-Forwarded-For / X-Real-IP — the
    // template's production compose runs behind Traefik, which overwrites these headers.
    return wsHub.upgradeProfile(c, auth.user.id, requestInfoFromContext(c, { trustedProxy: true }))
  })
