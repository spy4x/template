import type { Context, MiddlewareHandler } from "hono"
import type { APIContext } from "../_types.ts"
import { SESSION_ID_COOKIE_NAME } from "../services/auth/types.ts"

export function createSameOriginMutationGuard(
  reject: (context: Context<APIContext>) => Response,
): MiddlewareHandler<APIContext> {
  return async (c, next) => {
    const cookie = c.req.header("cookie") || ""
    const origin = c.req.header("origin")
    const fetchSite = c.req.header("sec-fetch-site")
    const requestOrigin = new URL(c.req.url).origin
    const hasSessionCookie = cookie.split(";").some((part) =>
      part.trim().startsWith(`${SESSION_ID_COOKIE_NAME}=`)
    )

    if (!hasSessionCookie || origin !== requestOrigin || fetchSite !== "same-origin") {
      return reject(c)
    }
    return await next()
  }
}
