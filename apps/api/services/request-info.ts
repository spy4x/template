import { Context } from "hono"
import type { RequestInfo } from "@platform/types"
import { APIContext } from "../_types.ts"

export function requestInfoFromContext(c: Context<APIContext>): RequestInfo {
  const forwardedFor = c.req.header("x-forwarded-for")
  const ip = forwardedFor
    ? forwardedFor.split(",")[0]?.trim()
    : c.req.header("x-real-ip") || undefined
  return {
    requestId: c.get("requestId"),
    ip,
    userAgent: c.req.header("user-agent") || undefined,
  }
}
