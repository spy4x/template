import type { Hono, MiddlewareHandler } from "hono"
import { HTTPException } from "hono/http-exception"
import { contextStorage } from "hono/context-storage"
import { requestId } from "hono/request-id"
import { requestLog } from "@spy4x/server/request-log"
import { randomBase64Url } from "@spy4x/platform/tokens"
import type { ReportContext } from "@platform/error-reporter.ts"
import type { APIContext } from "./_types.ts"

/**
 * The longest request id the API keeps: the same 128 characters a socket frame id may have, and
 * the width of `audit_events.request_id`. A longer `X-Request-Id` header is replaced by a
 * generated id instead of reaching the database.
 */
export const REQUEST_ID_MAX_LENGTH = 128

/**
 * The middleware every API request passes first; `index.ts` and its test both call this.
 *
 * It also answers an unhandled exception with a plain 500 and hands it to `reportError` with the
 * request id, the method and the path: never the query, a header or a body. A route that has its
 * own `onError` keeps it. An `HTTPException` below 500 is an answer, not a failure, and is not
 * reported.
 */
export function applyBaseMiddleware(
  app: Hono<APIContext>,
  { write, parseAuth, reportError }: {
    write: (...data: unknown[]) => void
    parseAuth: MiddlewareHandler
    reportError?: (error: unknown, context: ReportContext) => void
  },
): void {
  app.onError((error, c) => {
    if (error instanceof HTTPException && error.status < 500) return error.getResponse()
    write(`error: unhandled exception on ${c.req.method} ${c.req.path}`, error)
    try {
      reportError?.(error, {
        tags: { request_id: c.get("requestId") ?? "" },
        request: { method: c.req.method, path: c.req.path },
      })
    } catch {
      // Reporting never changes the answer.
    }
    return error instanceof HTTPException
      ? error.getResponse()
      : c.text("Internal Server Error", 500)
  })
  app.use(
    contextStorage(),
    requestId({ generator: () => randomBase64Url(6), limitLength: REQUEST_ID_MAX_LENGTH }),
    requestLog({ write, skipPaths: ["/api/health"] }),
    parseAuth,
  )
}
