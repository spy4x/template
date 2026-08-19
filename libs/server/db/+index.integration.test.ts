import { expect } from "@std/expect"
import { PublicAPICacheModel } from "@shared/cache"
import { DbServiceBase, postgres } from "./+index.ts"

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
    testSql: postgres.Sql,
  ) {
    super()
    this.setSql(testSql)
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
  const testSql = postgres({
    host: Deno.env.get("DB_HOST"),
    port: Number(Deno.env.get("DB_PORT") || "5432"),
    user: Deno.env.get("DB_USER"),
    pass: Deno.env.get("DB_PASS"),
    db: Deno.env.get("DB_NAME"),
    max: 1,
    transform: postgres.camel,
    connection: {
      application_name: "app-db-transaction-integration-test",
    },
  })
  const db = new TransactionTestDb(tableName, cache, testSql)

  try {
    await testSql`
      CREATE TABLE ${testSql(tableName)} (id SERIAL PRIMARY KEY, value TEXT NOT NULL)
    `

    await expect(
      db.begin(async (transaction) => {
        await transaction.rows.createOne({ data: { value: "must roll back" } })
        throw new Error("rollback")
      }),
    ).rejects.toThrow("rollback")

    const rows = await testSql<CountRow[]>`
      SELECT COUNT(*)::int AS count FROM ${testSql(tableName)}
    `
    expect(rows[0].count).toBe(0)
    expect(cachedIds).toEqual([])
  } finally {
    try {
      await testSql`DROP TABLE IF EXISTS ${testSql(tableName)}`
    } finally {
      await db.shutdown()
    }
  }
})
