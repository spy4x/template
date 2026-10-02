import type { Hono, MiddlewareHandler } from "hono"
import { contextStorage } from "hono/context-storage"
import { requestId } from "hono/request-id"
import { requestLog } from "@spy4x/server/request-log"
import { randomBase64Url } from "@spy4x/platform/tokens"
import type { APIContext } from "./_types.ts"

/**
 * The longest request id the API keeps: the same 128 characters a socket frame id may have, and
 * the width of `audit_events.request_id`. A longer `X-Request-Id` header is replaced by a
 * generated id instead of reaching the database.
 */
export const REQUEST_ID_MAX_LENGTH = 128

/** The middleware every API request passes first; `index.ts` and its test both call this. */
export function applyBaseMiddleware(
  app: Hono<APIContext>,
  { write, parseAuth }: { write: (...data: unknown[]) => void; parseAuth: MiddlewareHandler },
): void {
  app.use(
    contextStorage(),
    requestId({ generator: () => randomBase64Url(6), limitLength: REQUEST_ID_MAX_LENGTH }),
    requestLog({ write, skipPaths: ["/api/health"] }),
    parseAuth,
  )
}
