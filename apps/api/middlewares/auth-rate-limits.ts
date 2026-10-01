import type { MiddlewareHandler } from "hono"
import {
  type Clock,
  createStoreLimiter,
  failOpenLimiter,
  type RateLimitStore,
} from "@spy4x/platform/rate-limit"
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
  /**
   * Builds the store one limiter keeps its budgets in. `name` is that limiter's own key prefix:
   * `ratelimit-strict`, `ratelimit-otp` or `ratelimit-normal`. Production passes
   * `createRedisRateLimitStore` over Valkey; tests pass an in-process store.
   */
  store: (name: string) => RateLimitStore
  /**
   * Told each time a store failure is let pass: the normal limit allowing a request, or a correct
   * one-time code whose slot could not be given back.
   */
  onStoreError: (error: unknown) => void
  /** Injected by tests. */
  clock?: Clock
}

/**
 * Build the auth rate limits over the stores `settings.store` builds. In production that is Valkey
 * through the atomic `createRedisRateLimitStore`, so every budget survives an API restart or
 * deploy, and any number of API instances share one exact budget per client. Compose runs Valkey
 * without persistence (`--save ""`), so restarting Valkey itself still empties every budget. Compose
 * also runs Valkey with `--maxmemory-policy allkeys-lru`, so under memory pressure a budget may be
 * evicted like any cached key; a budget under attack is touched on every attempt and is the last to
 * go, and the Postgres failure counter still bounds one-time-code guesses.
 *
 * When Valkey fails, the strict and one-time-code limits refuse the request (the error reaches
 * Hono's error handler, which answers 500): they stand between a guesser and a password or a
 * six-digit code, and letting guesses through unseen is the attack they exist to stop. The normal
 * limit lets the request through and reports the error through `settings.onStoreError`, so sign-out
 * and `/me` keep working while Valkey is down, as the rest of the signed-in API does. The normal
 * limit uses `failOpenLimiter` for that; the other two must never be wrapped in it. A correct
 * one-time code whose slot cannot be given back keeps its response (the session cookie included),
 * and the slot stays spent; that error is reported through `settings.onStoreError` too.
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
 * never refused. The failure counter in `services/totp-failures.ts` lives in Postgres and is what
 * limits guesses over days and years.
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
  const { windowMs, clock, store } = settings
  const strict = createStoreLimiter(store("ratelimit-strict"), {
    windowMs,
    limit: settings.strictLimit,
    clock,
  })
  const otp = createStoreLimiter(store("ratelimit-otp"), {
    windowMs: settings.otpWindowMs,
    limit: settings.otpLimit,
    clock,
  })
  const normal = failOpenLimiter(
    createStoreLimiter(store("ratelimit-normal"), { windowMs, limit: settings.limit, clock }),
    { limit: settings.limit, onError: settings.onStoreError },
  )
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
      onRefundError: (error) => settings.onStoreError(error),
    }),
    normal: createRateLimitMiddleware(normal, {
      remoteAddr,
      keyResolver: byUser,
      keyPrefix: "auth:",
    }),
  }
}
