import { expect } from "@std/expect"
import type { ICacheStorage } from "@spy4x/platform/cache"
import { createCacheService } from "./cache-service.ts"

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
