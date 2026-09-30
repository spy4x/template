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
  /** Strict limit per signed-in user, for password change. */
  strictByUser: MiddlewareHandler<APIContext>
  /**
   * Slow limit per signed-in user, for checking a six-digit one-time code: `/totp/check` and
   * `/totp/connect/finish` share one budget. Only failed checks (status 400 and above) spend it.
   */
  otpByUser: MiddlewareHandler<APIContext>
  /** Normal limit per signed-in user, else per client IP, for every other auth route. */
  normal: MiddlewareHandler<APIContext>
}

/** Limits per window, from `config.rateLimiter`. */
export interface AuthRateLimitSettings {
  windowMs: number
  strictLimit: number
  limit: number
  /** Window of the one-time-code limit, much longer than `windowMs`. */
  otpWindowMs: number
  /** One-time-code checks per `otpWindowMs`. */
  otpLimit: number
  /** Injected by tests. */
  clock?: Clock
}

/**
 * Build the auth rate limits over in-memory limiters, which is enough while the API runs as one
 * instance. A second instance needs a shared store, such as Valkey. A restart empties every budget.
 *
 * Shared budgets, on purpose: sign-in and sign-up from one IP spend one strict budget, since both
 * guess or probe passwords. `/totp/check` and `/totp/connect/finish` spend one user's one-time-code
 * budget, so switching routes buys no extra guesses. Every other auth route spends one normal
 * budget per user, else per IP. Each route mounts its limiter after its cross-site check, so a
 * refused cross-site request spends nobody's budget.
 *
 * The one-time-code limit is separate because a six-digit code is a small secret: one random guess
 * succeeds about once in 333,000 tries, so it needs far fewer attempts per day than a password.
 * Only wrong codes spend it (`skipSuccessful`), so a user who signs in six times in one window is
 * never refused. It forgets everything on restart; the failure counter in
 * `services/totp-failures.ts` does not, and is what limits guesses over days and years.
 *
 * Proxy assumption: the client IP comes from `X-Real-IP` because Traefik alone sits in front of the
 * API and overwrites that header on every request. The connection's own address, which
 * `deno serve` hands Hono as `env.remoteAddr`, is the fallback. `CF-Connecting-IP` and
 * `X-Forwarded-For` are not trusted: Traefik passes them through unchanged. Two setups break this.
 * Any container on the shared `proxy` network reaches the API directly and can forge `X-Real-IP`.
 * Behind Cloudflare's proxy, Traefik sets `X-Real-IP` to a Cloudflare address, so users share
 * budgets per Cloudflare edge instead of per client.
 */
export function createAuthRateLimits(settings: AuthRateLimitSettings): AuthRateLimits {
  const { windowMs, clock } = settings
  const strict = createMemoryRateLimiter({ windowMs, limit: settings.strictLimit, clock })
  const normal = createMemoryRateLimiter({ windowMs, limit: settings.limit, clock })
  const otp = createMemoryRateLimiter({
    windowMs: settings.otpWindowMs,
    limit: settings.otpLimit,
    clock,
  })
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
    otpByUser: createRateLimitMiddleware(otp, {
      remoteAddr,
      keyResolver: byUser,
      keyPrefix: "auth-otp:",
      // A correct code gives its slot back: only wrong codes run the budget out.
      skipSuccessful: true,
    }),
    normal: createRateLimitMiddleware(normal, {
      remoteAddr,
      keyResolver: byUser,
      keyPrefix: "auth:",
    }),
  }
}
