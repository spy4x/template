import { expect } from "@std/expect"
import { buildMethods, CacheService, ICacheStorage } from "./+index.ts"

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

/**
 * Local fixture rather than a domain entity: this suite covers date revival for
 * any cached record whose keys end in "At", and platform must not depend on domain.
 */
type ExpiringRecord = {
  id: number
  createdAt: Date
  updatedAt: Date
  expiresAt: Date
}

Deno.test("cache revives dates for immediate session expiry checks", async () => {
  const cache = buildMethods<ExpiringRecord>(
    new CacheService(new MemoryCacheStorage()),
    "session",
    60,
  )
  const expiredAt = new Date(Date.now() - 1_000)

  await cache.set(1, {
    id: 1,
    expiresAt: expiredAt,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  const session = await cache.get(1)

  expect(session?.expiresAt).toBeInstanceOf(Date)
  expect(session?.expiresAt && session.expiresAt < new Date()).toBe(true)
})
