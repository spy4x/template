import type { MiddlewareHandler } from "hono"
import { isBoundToUser, REALTIME_USER_HEADER } from "@spy4x/realtime/operations"
import type { APIContext } from "../_types.ts"

/**
 * Refuses a read whose page names another user than the session's (ADR 003). A cookie can change
 * under a running page: another tab signs out and someone else signs in. The page sends the id of
 * the user it was started for in `X-Realtime-User`, as it does with every call, and a read as
 * anyone else answers 401 `unauthorized`, which signs that page out.
 *
 * A request with no such header is let through: the header is the page's claim, and a caller that
 * claims nothing (a page built before this check, a script) reads as its own session, as before.
 * It runs after the route's authentication, so a request with no session never reaches it.
 */
export const requireBoundUser: MiddlewareHandler<APIContext> = async (c, next) => {
  const claimed = c.req.header(REALTIME_USER_HEADER)
  const auth = c.get("auth")
  if (claimed !== undefined && auth && !isBoundToUser(claimed, auth.user.id)) {
    return c.json(
      { error: { code: "unauthorized", message: "The session belongs to another user" } },
      401,
    )
  }
  return await next()
}
