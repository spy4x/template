import { Context, Next } from "hono"
import { createMiddleware } from "hono/factory"
import { APIContext } from "../_types.ts"
import { SessionMFAStatus, UserMFAStatus, UserRole } from "@domain/identity"
export type AuthResolver = (
  context: Context<APIContext>,
) => Promise<APIContext["Variables"]["auth"] | null>

export const createParseAuth = (resolveAuth: AuthResolver) =>
  createMiddleware<APIContext>(async (c, next) => {
    const authData = await resolveAuth(c)
    c.set("auth", authData!)
    return next()
  })

export const isAuthenticated1FA = createMiddleware<APIContext>(
  async (c: Context, next: Next) => {
    const auth = c.get("auth")
    if (!auth) {
      return c.json({ error: "Not authenticated" }, 401)
    }
    return next()
  },
)

export const isAuthenticated2FA = createMiddleware<APIContext>(
  async (c: Context, next: Next) => {
    const auth = c.get("auth")
    if (!auth) {
      return c.json({ error: "Not authenticated" }, 401)
    }
    if (
      auth.user.mfa === UserMFAStatus.CONFIGURED &&
      auth.session.mfa !== SessionMFAStatus.COMPLETED
    ) {
      return c.json({ error: "Need to pass 2FA" }, 401)
    }
    return next()
  },
)

export const isRole = (...roles: UserRole[]) => {
  return createMiddleware<APIContext>(async (c: Context, next: Next) => {
    const authData = c.get("auth")
    if (!authData) {
      return c.json({ error: "Not authenticated" }, 401)
    }
    if (!roles.includes(authData.user.role)) {
      return c.json({ error: "Not authorized" }, 403)
    }
    return next()
  })
}
