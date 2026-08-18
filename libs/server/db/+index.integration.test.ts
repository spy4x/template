import { expect } from "@std/expect"
import { PublicAPICacheModel } from "@shared/cache"
import { DbServiceBase, postgres, sql } from "./+index.ts"

interface TransactionRow extends postgres.Row {
  id: number
  value: string
}

interface CountRow extends postgres.Row {
  count: number
}

class TransactionTestDb extends DbServiceBase {
  constructor(
    private tableName: string,
    private cache: PublicAPICacheModel<TransactionRow>,
  ) {
    super()
  }

  get rows() {
    return this.buildMethods<TransactionRow, { value: string }, { value: string }>(
      this.tableName,
      this.cache,
    )
  }
}

Deno.test("transaction-bound repository rolls back writes and cache effects", async () => {
  const tableName = `transaction_test_${crypto.randomUUID().replaceAll("-", "")}`
  const cachedIds: number[] = []
  const cache: PublicAPICacheModel<TransactionRow> = {
    key: (id) => `row_${id}`,
    ttl: 60,
    get: () => Promise.resolve(null),
    set: (id) => {
      cachedIds.push(id)
      return Promise.resolve()
    },
    delete: () => Promise.resolve(),
    wrap: (_id, fn) => fn(),
    wrapMany: (_prefix, fn) => fn(),
  }
  const db = new TransactionTestDb(tableName, cache)

  try {
    await sql`CREATE TABLE ${sql(tableName)} (id SERIAL PRIMARY KEY, value TEXT NOT NULL)`

    await expect(
      db.begin(async (transaction) => {
        await transaction.rows.createOne({ data: { value: "must roll back" } })
        throw new Error("rollback")
      }),
    ).rejects.toThrow("rollback")

    const rows = await sql<CountRow[]>`SELECT COUNT(*)::int AS count FROM ${sql(tableName)}`
    expect(rows[0].count).toBe(0)
    expect(cachedIds).toEqual([])
  } finally {
    await sql`DROP TABLE IF EXISTS ${sql(tableName)}`
    await db.shutdown()
  }
})
