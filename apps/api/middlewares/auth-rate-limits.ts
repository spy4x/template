import type { MiddlewareHandler } from "hono"
import { type Clock, createMemoryRateLimiter } from "@spy4x/platform/rate-limit"
import {
  createRateLimitMiddleware,
  type RateLimitContext,
  userThenIp,
} from "@spy4x/platform/rate-limit/hono"
import type { APIContext } from "../_types.ts"
import type { AppAuthState } from "../services/sign-in.ts"

/** The rate limits the auth routes mount. Each one answers 429 with `Retry-After` when spent. */
export interface AuthRateLimits {
  /** Strict limit per client IP, for sign-in and sign-up, where no user is known yet. */
  strictByIp: MiddlewareHandler<APIContext>
  /** Strict limit per signed-in user, for one-time codes and password change. */
  strictByUser: MiddlewareHandler<APIContext>
  /** Normal limit per signed-in user, else per client IP, for every other auth route. */
  normal: MiddlewareHandler<APIContext>
}

/** Limits per window, from `config.rateLimiter`. */
export interface AuthRateLimitSettings {
  windowMs: number
  strictLimit: number
  limit: number
  /** Injected by tests. */
  clock?: Clock
}

/**
 * Build the auth rate limits over in-memory limiters, which is enough while the API runs as one
 * instance. A second instance needs a shared store, such as Valkey.
 *
 * The client IP comes from `X-Real-IP`, which Traefik rewrites on every request, and falls back to
 * the connection's own address, which `deno serve` hands Hono as `env.remoteAddr`. `CF-Connecting-IP`
 * and `X-Forwarded-For` are not trusted: Traefik passes them through unchanged.
 */
export function createAuthRateLimits(settings: AuthRateLimitSettings): AuthRateLimits {
  const { windowMs, clock } = settings
  const strict = createMemoryRateLimiter({ windowMs, limit: settings.strictLimit, clock })
  const normal = createMemoryRateLimiter({ windowMs, limit: settings.limit, clock })
  const remoteAddr = ({ env }: RateLimitContext<APIContext>) =>
    (env as { remoteAddr?: { hostname?: string } } | undefined)?.remoteAddr?.hostname
  const userId = (_: Request, context: RateLimitContext<APIContext>) =>
    (context.get?.("auth") as AppAuthState | null | undefined)?.user.id?.toString()
  const noUser = () => undefined
  const byIp = userThenIp<APIContext>(noUser, { trustedProxy: "x-real-ip" })
  const byUser = userThenIp<APIContext>(userId, { trustedProxy: "x-real-ip" })
  return {
    strictByIp: createRateLimitMiddleware(strict, {
      remoteAddr,
      keyResolver: byIp,
      keyPrefix: "auth-strict:",
    }),
    strictByUser: createRateLimitMiddleware(strict, {
      remoteAddr,
      keyResolver: byUser,
      keyPrefix: "auth-strict:",
    }),
    normal: createRateLimitMiddleware(normal, {
      remoteAddr,
      keyResolver: byUser,
      keyPrefix: "auth:",
    }),
  }
}
