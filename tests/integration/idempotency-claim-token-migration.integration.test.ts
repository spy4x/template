/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { PostgresIdempotencyStore } from "@spy4x/server/idempotency"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { isUuid, uuidV7 } from "@spy4x/platform/universal/uuid"

const MIGRATIONS_DIR = "libs/server/db/migrations"
const MIGRATION = "2026_10_29_0001_idempotency_claim_token_text.sql"

/** A claim token as the store wrote it until 1.63.0: a UUID version 4. */
const OLD_TOKEN = "f47ac10b-58cc-4372-a567-0e02b2c3d479"

const claim = (userId: number, key: string) => ({
  userId,
  key,
  commandName: "group.create",
  requestHash: "a".repeat(64),
})

Deno.test("the claim token migration keeps old claims usable and lets the new store claim, complete and release", async () => {
  const connection = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...connection, max: 1 })
  const schema = `idem_migration_test_${uuidV7().replaceAll("-", "")}`
  const sql = postgres({
    ...connection,
    max: 1,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    const names = [...Deno.readDirSync(MIGRATIONS_DIR)].map((entry) => entry.name).sort()
    // A renamed or deleted migration must fail here, not pass by migrating nothing.
    expect(names).toContain(MIGRATION)
    for (const name of names.filter((name) => name < MIGRATION)) {
      await sql.unsafe(await Deno.readTextFile(`${MIGRATIONS_DIR}/${name}`))
    }
    const [{ id: userId }] = await sql<{ id: number }[]>`
      WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
      INSERT INTO users (id) SELECT id FROM auth_user RETURNING id
    `
    // What the API on 1.63.0 leaves behind: a claim in progress with a UUID token, and a finished
    // key whose token came from the column's default.
    await sql`
      INSERT INTO idempotency_keys (user_id, key, command_name, request_hash, claim_token, status)
      VALUES (${userId}, 'old-claim', 'group.create', ${"a".repeat(64)}, ${OLD_TOKEN}, 1)
    `
    await sql`
      INSERT INTO idempotency_keys (user_id, key, command_name, request_hash, status, result)
      VALUES (${userId}, 'old-done', 'group.create', ${"a".repeat(64)}, 2, '{"id":"kept"}')
    `

    await sql.unsafe(await Deno.readTextFile(`${MIGRATIONS_DIR}/${MIGRATION}`))

    const [column] = await sql<{ dataType: string; columnDefault: string | null }[]>`
      SELECT data_type AS "dataType", column_default AS "columnDefault"
      FROM information_schema.columns
      WHERE table_schema = ${schema} AND table_name = 'idempotency_keys'
        AND column_name = 'claim_token'
    `
    expect(column).toEqual({ dataType: "text", columnDefault: null })

    const store = new PostgresIdempotencyStore(sql)

    // The old rows: the finished one replays, the claimed one is completed with its old token.
    expect(await store.begin(claim(userId, "old-done"))).toEqual({
      status: "replay",
      result: { id: "kept" },
    })
    expect((await store.begin(claim(userId, "old-claim"))).status).toBe("in_progress")
    await store.complete(userId, "old-claim", OLD_TOKEN, { id: "finished" })
    expect(await store.begin(claim(userId, "old-claim"))).toEqual({
      status: "replay",
      result: { id: "finished" },
    })

    // A new claim: its token is random text, and complete stores the result.
    const first = await store.begin(claim(userId, "new-complete"))
    if (first.status !== "claimed") throw new Error(`expected a claim, got ${first.status}`)
    expect(isUuid(first.token)).toBe(false)
    await store.complete(userId, "new-complete", first.token, { id: "new" })
    expect(await store.begin(claim(userId, "new-complete"))).toEqual({
      status: "replay",
      result: { id: "new" },
    })

    // Release frees the key, so the next run claims it again.
    const second = await store.begin(claim(userId, "new-release"))
    if (second.status !== "claimed") throw new Error(`expected a claim, got ${second.status}`)
    expect((await store.begin(claim(userId, "new-release"))).status).toBe("in_progress")
    await store.release(userId, "new-release", second.token)
    expect((await store.begin(claim(userId, "new-release"))).status).toBe("claimed")
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
})
