/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import type { ICacheStorage } from "@spy4x/platform/cache"
import { RedisKvStoreClosedError, RedisKvStoreConnectionError } from "@spy4x/server/kv"
import { crashOnConnectionLoss, createCacheService } from "./cache-service.ts"

class MemoryCacheStorage implements ICacheStorage {
  private values = new Map<string, string>()

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null)
  }

  set(key: string, value: string): Promise<void> {
    this.values.set(key, value)
    return Promise.resolve()
  }

  del(key: string): Promise<void> {
    this.values.delete(key)
    return Promise.resolve()
  }

  reset(): Promise<void> {
    this.values.clear()
    return Promise.resolve()
  }
}

Deno.test("cache service revives a cached expiresAt as a Date", async () => {
  const cache = createCacheService(new MemoryCacheStorage())
  const expiresAt = new Date(Date.now() + 60_000)

  await cache.set("session", { id: 1, expiresAt }, 60)
  const cached = await cache.get<{ id: number; expiresAt: Date }>("session")

  expect(cached?.expiresAt).toBeInstanceOf(Date)
  expect(cached?.expiresAt.getTime()).toBe(expiresAt.getTime())
})

/** A store whose every method rejects with `error`, for exercising `crashOnConnectionLoss`. */
function throwingStore(error: unknown) {
  const fail = () => Promise.reject(error)
  return { get: fail, set: fail, del: fail, reset: fail }
}

/** Records every `exit` call instead of ending the test process, and throws so the guard's
 *  `.catch` chain behaves the way a real `Deno.exit` (which never returns) would. */
function fakeExit(): { exit: (code: number) => never; calls: number[] } {
  const calls: number[] = []
  return {
    calls,
    exit: (code: number) => {
      calls.push(code)
      throw new Error(`exit(${code}) called`)
    },
  }
}

Deno.test("crashOnConnectionLoss exits on RedisKvStoreConnectionError", async () => {
  const { exit, calls } = fakeExit()
  const store = throwingStore(new RedisKvStoreConnectionError(new Error("boom")))
  const storage = crashOnConnectionLoss(store, exit)

  await expect(storage.get("key")).rejects.toThrow()

  expect(calls).toEqual([1])
})

Deno.test("crashOnConnectionLoss exits on RedisKvStoreClosedError", async () => {
  const { exit, calls } = fakeExit()
  const store = throwingStore(new RedisKvStoreClosedError())
  const storage = crashOnConnectionLoss(store, exit)

  await expect(storage.set("key", "value", 60)).rejects.toThrow()

  expect(calls).toEqual([1])
})

Deno.test("crashOnConnectionLoss rethrows any other error without exiting", async () => {
  const { exit, calls } = fakeExit()
  const store = throwingStore(new Error("plain storage error"))
  const storage = crashOnConnectionLoss(store, exit)

  await expect(storage.get("key")).rejects.toThrow("plain storage error")

  expect(calls).toEqual([])
})
