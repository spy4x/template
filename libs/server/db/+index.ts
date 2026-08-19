import postgres from "postgres"
import { getEnvVar } from "@server/helpers/env.ts"
import { PublicAPICacheModel } from "@platform/cache"

export const sql = postgres({
  host: getEnvVar("DB_HOST"),
  user: getEnvVar("DB_USER"),
  pass: getEnvVar("DB_PASS"),
  db: getEnvVar("DB_NAME"),
  transform: postgres.camel,
  connection: {
    application_name: "app-backend",
  },
})

export type Transaction = postgres.TransactionSql
export { postgres }

// Uncomment for debugging queries
// sql.options.debug = (_, query, parameters) =>
// console.log(query, parameters.length ? parameters : "");

export class DbServiceBase {
  protected sql = sql
  private pendingCacheOperations: Array<() => Promise<void>> | null = null

  protected setSql(_sql: typeof sql | Transaction): void {
    this.sql = _sql
  }

  async isConnected(): Promise<boolean> {
    try {
      await this.sql`SELECT 1`
      return true
    } catch {
      return false
    }
  }

  async begin<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    const pendingCacheOperations: Array<() => Promise<void>> = []
    const result = await this.sql.begin(async (transaction: Transaction) => {
      const service: this = Object.create(this)
      service.setSql(transaction)
      service.pendingCacheOperations = pendingCacheOperations
      return await fn(service)
    })
    for (const operation of pendingCacheOperations) {
      await operation()
    }
    return result
  }

  async connect(): Promise<void> {
    await this.sql`SELECT 1`
  }

  async shutdown(): Promise<void> {
    await this.sql.end({ timeout: 5 })
  }

  /** Sanitizes object by removing inappropriate fields */
  sanitize<T>(obj: Partial<T>): Partial<T> {
    return Object.keys(obj).reduce<Partial<T>>((acc, key) => {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (obj[key as keyof Partial<T>] !== undefined) {
        acc[key as keyof Partial<T>] = obj[key as keyof Partial<T>]
      }
      // remove "updatedAt" field if it exists
      if (key === "updatedAt") {
        delete acc[key as keyof Partial<T>]
      }
      return acc
    }, {})
  }

  async findOne<T extends postgres.Row>(
    cache: PublicAPICacheModel<T>,
    id: number,
    command: postgres.PendingQuery<T[]>,
  ): Promise<null | T> {
    if (this.pendingCacheOperations) {
      return (await command)[0] ?? null
    }
    return cache.wrap(id, async () => (await command)[0])
  }

  async createOne<T extends postgres.Row>(
    cache: PublicAPICacheModel<T>,
    command: postgres.PendingQuery<T[]>,
  ): Promise<T> {
    const created = (await command)[0]
    if (created) {
      await this.setCache(cache, created.id, created)
    }
    return created
  }

  async updateOne<T extends postgres.Row>(
    cache: PublicAPICacheModel<T>,
    command: postgres.PendingQuery<T[]>,
  ): Promise<T> {
    const updated = (await command)[0]
    if (updated) {
      await this.setCache(cache, updated.id, updated)
    }
    return updated
  }

  async deleteOne<T extends postgres.Row>(
    cache: PublicAPICacheModel<T>,
    command: postgres.PendingQuery<T[]>,
  ): Promise<T> {
    const deleted = (await command)[0]
    if (deleted) {
      await this.deleteCache(cache, deleted.id)
    }
    return deleted
  }

  buildMethods<M extends postgres.Row, C extends Partial<unknown>, U extends Partial<unknown>>(
    table: string,
    cache: PublicAPICacheModel<M>,
  ) {
    return {
      findOne: async ({ id }: { id: number }) =>
        this.findOne<M>(
          cache,
          id,
          this.sql`SELECT * FROM ${this.sql(table)} WHERE id = ${id}`,
        ),
      findChanged: async (updatedAtGt: Date): Promise<M[]> => {
        return await this.sql<
          M[]
        >`SELECT * FROM ${
          this.sql(table)
        } WHERE updated_at > ${updatedAtGt} ORDER BY updated_at DESC`
      },
      createOne: async ({ data }: { data: C }) =>
        this.createOne<M>(
          cache,
          this.sql<M[]>`
              INSERT INTO ${this.sql(table)}
              ${this.sql(this.sanitize(data))}
              RETURNING *`,
        ),
      updateOne: async (params: {
        id: number
        data: U
      }) =>
        this.updateOne<M>(
          cache,
          this.sql<M[]>`
              UPDATE ${this.sql(table)}
              SET updated_at = NOW(), ${this.sql(this.sanitize(params.data))}
              WHERE id = ${params.id}
              RETURNING *`,
        ),
      deleteOne: async ({ id }: { id: number }) =>
        this.deleteOne<M>(
          cache,
          this.sql<M[]>`
              UPDATE ${this.sql(table)}
              SET updated_at = NOW(), deleted_at = NOW()
              WHERE id = ${id}
              RETURNING *`,
        ),
      undeleteOne: async ({ id }: { id: number }) =>
        this.updateOne<M>(
          cache,
          this.sql<M[]>`
              UPDATE ${this.sql(table)}
              SET updated_at = NOW(), deleted_at = NULL
              WHERE id = ${id}
              RETURNING *`,
        ),
    }
  }

  protected setCache<T extends postgres.Row>(
    cache: PublicAPICacheModel<T>,
    id: number,
    value: T,
  ): Promise<void> {
    return this.runCacheOperation(() => cache.set(id, value))
  }

  protected deleteCache<T extends postgres.Row>(
    cache: PublicAPICacheModel<T>,
    id: number,
  ): Promise<void> {
    return this.runCacheOperation(() => cache.delete(id))
  }

  private runCacheOperation(operation: () => Promise<void>): Promise<void> {
    if (this.pendingCacheOperations) {
      this.pendingCacheOperations.push(() => this.executeCacheOperation(operation))
      return Promise.resolve()
    }
    return this.executeCacheOperation(operation)
  }

  private async executeCacheOperation(operation: () => Promise<void>): Promise<void> {
    try {
      await operation()
    } catch (error) {
      console.error("Cache update failed", error)
    }
  }
}
