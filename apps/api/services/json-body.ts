import type { Context } from "hono"
import { readJsonBody } from "@spy4x/server/http/bounded-body"

/**
 * The largest JSON body any API route accepts. The largest real one, a push subscription, is well
 * under 1 KiB; the library's 5 MiB default is far more than any route needs.
 */
export const MAX_JSON_BODY_BYTES = 64 * 1024

/**
 * Read the request's JSON body, capped at {@link MAX_JSON_BODY_BYTES}. Throws Hono's
 * `HTTPException`: 413 when the body is too large, 408 when it stalls, 400 when it is not JSON.
 */
export function readApiJson(c: Context): Promise<unknown> {
  return readJsonBody(c, { maxBytes: MAX_JSON_BODY_BYTES })
}
