/// <reference lib="deno.ns" />
import {
  CacheService,
  type ICacheService,
  type ICacheStorage,
  reviveIsoDatesEndingInAt,
} from "@spy4x/platform/cache"
import {
  type RedisKvStore,
  RedisKvStoreClosedError,
  RedisKvStoreConnectionError,
} from "@spy4x/server/kv"

/** The subset of `RedisKvStore` `crashOnConnectionLoss` needs — narrow enough that a test can
 *  pass a plain object instead of a real, privately-constructed `RedisKvStore`. */
type CrashableStore = Pick<RedisKvStore, "get" | "set" | "del" | "reset">

/** `Deno.exit`'s shape, injectable so a test can observe a call without ending the test process. */
type ExitFn = (code: number) => never

/**
 * Wraps a `RedisKvStore` so a dead Valkey connection crashes the process instead of making
 * every cache call throw forever.
 *
 * The template's old kv client threw the same way `Deno.connect` throws on a closed socket,
 * which was an unhandled rejection that crashed the process - Docker's restart policy then
 * brought it back with a fresh connection. `RedisKvStore` instead turns a dead connection into
 * a catchable `RedisKvStoreConnectionError` on every later call, on purpose (so a caller that
 * wants to retry, or fail one request instead of the whole process, can). This app has no
 * reconnect logic and does not want one added here - that would be a local reimplementation of
 * behaviour the published package deliberately does not provide, which the ts-libs contract
 * forbids extracting back in. So this adapter restores the old crash-and-restart behaviour
 * explicitly: on `RedisKvStoreConnectionError` or `RedisKvStoreClosedError`, it logs one line
 * and exits the process, exactly like the old client's unhandled rejection did.
 *
 * `exit` defaults to `Deno.exit` and is only a parameter so `cache-service.test.ts` can assert
 * it is called (or not) without actually ending the test process.
 */
export function crashOnConnectionLoss(
  store: CrashableStore,
  exit: ExitFn = Deno.exit,
): ICacheStorage {
  const die = (error: unknown): never => {
    console.error(`Valkey connection is no longer usable, exiting so Docker restarts:`, error)
    return exit(1)
  }
  const guard = <T>(run: () => Promise<T>): Promise<T> =>
    run().catch((error: unknown) => {
      if (
        error instanceof RedisKvStoreConnectionError || error instanceof RedisKvStoreClosedError
      ) {
        die(error)
      }
      throw error
    })
  return {
    get: (key) => guard(() => store.get(key)),
    set: (key, value, ttlSec) => guard(() => store.set(key, value, ttlSec)),
    del: (key) => guard(() => store.del(key)),
    reset: () => guard(() => store.reset()),
  }
}

/**
 * Builds this app's `CacheService`, with the reviver that restores the template's old,
 * unconditional revival of every "*At"-suffixed cached string into a `Date`.
 *
 * Extracted so it can be exercised directly in a test without connecting to Valkey - see
 * `cache-service.test.ts`. Swapping `reviveIsoDatesEndingInAt` for a no-op reviver here would
 * keep every other check green while silently breaking session-expiry checks that compare a
 * cached `expiresAt` against `Date.now()`; the test guards exactly that.
 */
export function createCacheService(storage: ICacheStorage): ICacheService {
  return new CacheService(storage, { reviver: reviveIsoDatesEndingInAt })
}
