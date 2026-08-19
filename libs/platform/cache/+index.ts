import { validate, ValidationSchema } from "@platform/types"
const isoDatePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/

function parseCacheValue<T>(serialized: string): T {
  return JSON.parse(
    serialized,
    (key, value) =>
      key.endsWith("At") && typeof value === "string" && isoDatePattern.test(value)
        ? new Date(value)
        : value,
  )
}

export interface ICacheStorage {
  /** Returns the value of the key if it exists, otherwise null */
  get(key: string): Promise<null | string>

  /** Sets the value of the key with an expiration time in seconds */
  set(key: string, value: string, ttlSec: number): Promise<void>

  /** Deletes the key */
  del(key: string): Promise<void>

  /** Clears all keys in the storage */
  reset(): Promise<void>
}

export interface ICacheService {
  get<T>(key: string): Promise<null | T>
  set<T>(key: string, value: T, ttlMs: number): Promise<void>
  delete(key: string): Promise<void>
  wrap<T>(
    key: string,
    fn: () => Promise<T>,
    ttlMs: number,
    options?: {
      shouldSaveFalsy?: boolean
    },
  ): Promise<T>
  reset(): Promise<void>
}

export class CacheService implements ICacheService {
  constructor(private storage: ICacheStorage) {
  }

  public async get<T>(key: string): Promise<null | T> {
    const result = await this.storage.get(key)
    if (!result) {
      return null
    }
    return parseCacheValue<T>(result)
  }

  public set<T>(key: string, value: T, ttlSec: number): Promise<void> {
    return this.storage.set(key, JSON.stringify(value), ttlSec)
  }

  public async delete(key: string): Promise<void> {
    await this.storage.del(key)
  }

  public async wrap<T>(
    key: string,
    fn: () => Promise<T>,
    ttlSec: number,
    options = { shouldSaveFalsy: false },
  ): Promise<T> {
    const data = await this.storage.get(key)
    if (data) {
      return parseCacheValue<T>(data)
    }
    const value = await fn()
    if (value || options.shouldSaveFalsy) {
      await this.set(key, value, ttlSec)
    }
    return value
  }

  public async reset(): Promise<void> {
    await this.storage.reset()
  }
}

export type PublicAPICacheModel<T, K extends string | number = number> = {
  key: (id: K) => string
  /** Cache expiration time in seconds */
  ttl: number
  get: (id: K) => Promise<null | T>
  set: (id: K, item: T) => Promise<void>
  delete: (id: K) => Promise<void>
  wrap: (id: K, fn: () => Promise<T>) => Promise<T>
  wrapMany: (prefix: string, fn: () => Promise<T[]>) => Promise<T[]>
}

export const buildMethods = <T, K extends string | number = number>(
  cacheService: ICacheService,
  prefix: string,
  /** Cache expiration time in seconds */
  ttl: number,
  schema?: ValidationSchema,
): PublicAPICacheModel<T, K> => {
  const key = (id: K): string => `${prefix}_${id}`
  return {
    key,
    ttl,
    get: async (id: K): Promise<null | T> => {
      const result = await cacheService.get<T>(key(id))
      if (!result) {
        return null
      }
      if (schema) {
        const parseResult = validate(schema, result)
        if (parseResult.error) {
          throw parseResult.error.details
        }
        return parseResult.data as T
      }
      return result
    },
    set: async (id: K, item: T): Promise<void> => {
      return cacheService.set(key(id), item, ttl)
    },
    delete: async (id: K): Promise<void> => {
      return cacheService.delete(key(id))
    },
    wrap: async (id: K, fn: () => Promise<T>): Promise<T> => {
      const result = await cacheService.wrap<T>(key(id), fn, ttl)
      if (schema) {
        const parseResult = validate(schema, result)
        if (parseResult.error) {
          throw parseResult.error.details
        }
        return parseResult.data as T
      }
      return result
    },
    wrapMany: async (prfx: string, fn: () => Promise<T[]>): Promise<T[]> => {
      return cacheService.wrap<T[]>(`${prefix}_${prfx}`, fn, ttl)
    },
  }
}
