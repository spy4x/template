/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { DbServiceBase } from "@spy4x/server/db"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"

/**
 * Proves HANDOFF.md trap 5: `DbService.group` must be built fresh on every access, not
 * cached on the instance, because `DbServiceBase.begin()` derives its transactional clone
 * with `Object.create(this)` and rebinds `sql` on the clone - a repository built once and
 * reused would keep pointing at the pool client instead of the transaction handle, and a
 * write made through it inside `begin()` would commit outside the rollback it was supposed
 * to be part of.
 *
 * `tests/integration/db.integration.test.ts` covers the same `begin()`/cache-deferral
 * mechanics but never constructs a `group`-shaped repository, so it cannot catch a
 * regression here: a `db.group` implemented as `private readonly _group = new
 * PostgresGroupRepository(this.sql)` (built once, in the constructor, instead of per
 * access) passes that test, `deno task check` and `deno task test:integration` in full -
 * only this test and the e2e sign-up flow go red. See the PR body for the mutation and the
 * red/green run that demonstrates it.
 */
class TestDb extends DbServiceBase {
  /** Built per access on purpose - the property this test exists to guard. */
  get group(): PostgresGroupRepository {
    return new PostgresGroupRepository(this.sql)
  }
}

const REQUIRED_DB_ENV = ["DB_HOST", "DB_USER", "DB_PASS", "DB_NAME"]
const hasDatabase = REQUIRED_DB_ENV.every((name) => Boolean(Deno.env.get(name)))

interface IdRow extends postgres.Row {
  id: number
}

interface CountRow extends postgres.Row {
  count: number
}

const MIGRATIONS = [
  "2026_01_26_0001_init.sql",
  "2026_01_26_0002_auth_profiles_audit.sql",
  "2026_01_27_0001_drop_user_profiles.sql",
  "2026_08_18_0001_group_core.sql",
  "2026_08_18_0002_personal_group_backfill.sql",
]

Deno.test({
  name: "a repository built through db.group rolls back with its transaction",
  ignore: !hasDatabase,
  async fn() {
    const connection = {
      host: Deno.env.get("DB_HOST")!,
      port: Number(Deno.env.get("DB_PORT") || "5432"),
      user: Deno.env.get("DB_USER")!,
      pass: Deno.env.get("DB_PASS")!,
      db: Deno.env.get("DB_NAME")!,
    }
    const admin = postgres({ ...connection, max: 1 })
    const schema = `db_group_tx_test_${crypto.randomUUID().replace(/-/g, "")}`
    const sql = postgres({
      ...connection,
      max: 5,
      transform: postgres.camel,
      connection: { options: `-c search_path=${schema}` },
    })

    try {
      await admin`CREATE SCHEMA ${admin(schema)}`
      for (const migration of MIGRATIONS) {
        await sql.unsafe(await Deno.readTextFile(`libs/server/db/migrations/${migration}`))
      }

      const userId = (await sql<IdRow[]>`INSERT INTO users DEFAULT VALUES RETURNING id`)[0].id
      const groupId = crypto.randomUUID()
      const db = new TestDb({ sql })

      await expect(
        db.begin(async (tx) => {
          await tx.group.createPersonal({ id: groupId, name: "must roll back" }, userId)
          throw new Error("rollback")
        }),
      ).rejects.toThrow("rollback")

      const rows = await sql<CountRow[]>`
        SELECT COUNT(*)::int AS count FROM groups WHERE id = ${groupId}
      `
      expect(rows[0].count).toBe(0)
    } finally {
      await sql.end({ timeout: 5 })
      await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
      await admin.end({ timeout: 5 })
    }
  },
})
