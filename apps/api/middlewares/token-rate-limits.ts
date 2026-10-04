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
import type { TokenApiContext } from "../routes/token-api.ts"

/** The limits of the token API (`routes/token-api.ts`). Each answers 429 with `Retry-After`. */
export interface TokenRateLimits {
  /**
   * Refused requests per client IP, spent before the token is checked: guessing tokens, or using a
   * revoked one, runs out of budget. A request that succeeds gives its slot back, so a client that
   * runs several tokens from one address is held only by each token's own budget.
   */
  failuresByIp: MiddlewareHandler<TokenApiContext>
  /** Requests per token, whatever the address: each token has a budget of its own. */
  byToken: MiddlewareHandler<TokenApiContext>
}

/** Limits per window, from `config.rateLimiter`. */
export interface TokenRateLimitSettings {
  windowMs: number
  /** Requests per window, for each budget: the normal signed-in limit. */
  limit: number
  /**
   * Builds the store of one limiter; `name` is its key prefix, `ratelimit-api-token` or
   * `ratelimit-api-token-ip`. See `AuthRateLimitSettings.store`.
   */
  store: (name: string) => RateLimitStore
  /** Told each time a store failure is let pass. */
  onStoreError: (error: unknown) => void
  /** Injected by tests. */
  clock?: Clock
}

/**
 * Builds the token API's limits. Both fail open when the store fails, as the normal auth limit
 * does: a token is 128 random bits, so the IP budget slows guessing but is not what stops it, and
 * the API keeps answering while Valkey is down. The client IP is read as the auth limits read it:
 * `X-Real-IP` from Traefik, else the connection's address.
 */
export function createTokenRateLimits(settings: TokenRateLimitSettings): TokenRateLimits {
  const { windowMs, limit, clock, store, onStoreError } = settings
  const failOpen = (name: string) =>
    failOpenLimiter(createStoreLimiter(store(name), { windowMs, limit, clock }), {
      limit,
      onError: onStoreError,
    })
  const remoteAddr = ({ env }: RateLimitContext<TokenApiContext>) =>
    (env as { remoteAddr?: { hostname?: string } } | undefined)?.remoteAddr?.hostname
  const tokenId = (_: Request, context: RateLimitContext<TokenApiContext>) =>
    (context.get?.("apiToken") as { id?: string } | undefined)?.id
  return {
    failuresByIp: createRateLimitMiddleware(failOpen(`ratelimit-api-token-ip`), {
      remoteAddr,
      keyResolver: userThenIp<TokenApiContext>(() => undefined, { trustedProxy: `x-real-ip` }),
      keyPrefix: `api-token-ip:`,
      skipSuccessful: true,
      onRefundError: onStoreError,
    }),
    byToken: createRateLimitMiddleware(failOpen(`ratelimit-api-token`), {
      remoteAddr,
      keyResolver: userThenIp<TokenApiContext>(tokenId, { trustedProxy: `x-real-ip` }),
      keyPrefix: `api-token:`,
    }),
  }
}
