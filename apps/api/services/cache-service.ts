/// <reference lib="deno.ns" />
import {
  CacheService,
  type ICacheService,
  type ICacheStorage,
  reviveIsoDatesEndingInAt,
} from "@spy4x/platform/cache"
import { log } from "./log.ts"

/**
 * Builds this app's `CacheService`, with the reviver that restores the template's old,
 * unconditional revival of every "*At"-suffixed cached string into a `Date`.
 *
 * Extracted so it can be exercised directly in a test without connecting to Valkey - see
 * `cache-service.test.ts`. Swapping `reviveIsoDatesEndingInAt` for a no-op reviver here would
 * keep every other check green while silently breaking session-expiry checks that compare a
 * cached `expiresAt` against `Date.now()`; the test guards exactly that.
 */
export function createCacheService(
  storage: ICacheStorage,
  onError: CacheErrorReporter = defaultReporter,
  retryMs?: number,
): ICacheService {
  return new CacheService(failOpen(storage, onError, retryMs), {
    reviver: reviveIsoDatesEndingInAt,
  })
}

/** Called with the operation and error whenever a cache operation fails. */
export type CacheErrorReporter = (
  operation: `get` | `set` | `del` | `reset`,
  error: unknown,
) => void

const defaultReporter: CacheErrorReporter = (operation, error) =>
  log(`cache ${operation} failed, treating the cache as untrusted`, error)

/** How long an untrusted cache waits before the next attempt to clear itself. */
const RECOVERY_INTERVAL_MS = 5_000

/**
 * Wraps `storage` so a Valkey outage never fails a request: while Valkey is down every read is a
 * miss (Postgres answers) and every write is skipped.
 *
 * A skipped write is the danger: the row changes in Postgres, and when Valkey returns with its old
 * data (a restart from a snapshot, a network break) the stale row would be served. So the first
 * failed operation marks the whole cache untrusted. While untrusted, `get` misses and `set` and
 * `del` do nothing, none of them touching Valkey. Trust returns only after a `reset()` succeeds,
 * which removes every key this storage holds; it is retried at most once per `retryMs`, on the
 * next operation, so no timer is left running.
 *
 * ts-libs' `CacheService.wrap` has no such mode; this stays local until it does.
 */
export function failOpen(
  storage: ICacheStorage,
  onError: CacheErrorReporter,
  retryMs = RECOVERY_INTERVAL_MS,
  now: () => number = Date.now,
): ICacheStorage {
  let trusted = true
  let nextAttemptAt = 0
  let recovery: Promise<void> | null = null

  const distrust = (operation: `get` | `set` | `del` | `reset`, error: unknown) => {
    trusted = false
    nextAttemptAt = now() + retryMs
    onError(operation, error)
  }

  /** Tries to clear the cache when untrusted and due; resolves when the attempt is over. */
  const tryRecover = async (): Promise<void> => {
    if (trusted || now() < nextAttemptAt) return
    recovery ??= storage.reset().then(
      () => {
        trusted = true
      },
      (error) => distrust(`reset`, error),
    ).finally(() => {
      recovery = null
    })
    await recovery
  }

  return {
    async get(key) {
      await tryRecover()
      if (!trusted) return null
      try {
        return await storage.get(key)
      } catch (error) {
        distrust(`get`, error)
        return null
      }
    },
    async set(key, value, ttlSec) {
      await tryRecover()
      if (!trusted) return
      try {
        await storage.set(key, value, ttlSec)
      } catch (error) {
        distrust(`set`, error)
      }
    },
    async del(key) {
      await tryRecover()
      if (!trusted) return
      try {
        await storage.del(key)
      } catch (error) {
        distrust(`del`, error)
      }
    },
    reset: () => storage.reset(),
  }
}
