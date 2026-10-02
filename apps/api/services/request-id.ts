import { requestId } from "hono/request-id"
import { randomBase64Url } from "@spy4x/platform/tokens"

/**
 * The longest request id the API keeps: the same 128 characters a socket frame id may have, and
 * the width of `audit_events.request_id`. A longer `X-Request-Id` header is replaced by a
 * generated id instead of reaching the database.
 */
export const REQUEST_ID_MAX_LENGTH = 128

export function requestIdMiddleware() {
  return requestId({ generator: () => randomBase64Url(6), limitLength: REQUEST_ID_MAX_LENGTH })
}
