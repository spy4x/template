/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { CommandBus } from "@spy4x/platform/cqrs"
import { GroupCreateCommand, GroupKind } from "@domain/groups"
import { createGroupCreateHandler } from "../../apps/api/features/groups/handlers.ts"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { UserMFAStatus } from "@domain/identity"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { createIdempotencyMiddleware } from "@server/idempotency/idempotency.ts"
import { PostgresIdempotencyStore } from "@server/idempotency/postgres-idempotency-store.ts"
import { requireDbConnection } from "./db-connection.ts"

interface IdRow extends postgres.Row {
  id: number
}

interface CountRow extends postgres.Row {
  count: number
}

interface SequenceRow extends postgres.Row {
  next: string
  outbox: number
}

/** Runs `body` on a fresh schema built from schema.sql. */
async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const connection = requireDbConnection()
  const admin = postgres({ ...connection, max: 1 })
  const schema = `idem_test_${crypto.randomUUID().replaceAll("-", "")}`
  const sql = postgres({
    ...connection,
    max: 25,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    await sql.unsafe(await Deno.readTextFile("libs/server/db/schema.sql"))
    await body(sql)
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
}

async function insertUser(sql: postgres.Sql): Promise<number> {
  const rows = await sql<IdRow[]>`
    WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
    INSERT INTO users (id) SELECT id FROM auth_user RETURNING id
  `
  return rows[0].id
}

function claim(userId: number, key = "key-1", requestHash = "hash-a") {
  return { userId, key, commandName: "GroupCreateCommand", requestHash }
}

Deno.test("idempotency keys in Postgres", async (t) => {
  await withSchema(async (sql) => {
    const store = new PostgresIdempotencyStore(sql)
    const userId = await insertUser(sql)
    const otherUserId = await insertUser(sql)

    await t.step("a finished run is answered from its stored result", async () => {
      expect(await store.begin(claim(userId, "finished"))).toEqual({ status: "claimed" })
      await store.complete(userId, "finished", { created: true, name: "Team" })

      expect(await store.begin(claim(userId, "finished"))).toEqual({
        status: "replay",
        result: { created: true, name: "Team" },
      })
    })

    await t.step("a result of null is still a stored result", async () => {
      await store.begin(claim(userId, "null-result"))
      await store.complete(userId, "null-result", undefined)

      expect(await store.begin(claim(userId, "null-result"))).toEqual({
        status: "replay",
        result: null,
      })
    })

    await t.step("twenty concurrent first sends produce one claim", async () => {
      const outcomes = await Promise.all(
        Array.from({ length: 20 }, () => store.begin(claim(userId, "race"))),
      )

      expect(outcomes.filter((outcome) => outcome.status === "claimed").length).toBe(1)
      expect(outcomes.filter((outcome) => outcome.status === "in_progress").length).toBe(19)
    })

    await t.step("the same key with other input is refused", async () => {
      await store.begin(claim(userId, "reused"))

      expect(await store.begin(claim(userId, "reused", "hash-b"))).toEqual({ status: "reused" })
    })

    await t.step("one user's key does not answer another user's", async () => {
      await store.begin(claim(userId, "shared-name"))
      await store.complete(userId, "shared-name", "mine")

      expect(await store.begin(claim(otherUserId, "shared-name"))).toEqual({ status: "claimed" })
    })

    await t.step("a released claim can be taken again", async () => {
      await store.begin(claim(userId, "released"))
      await store.release(userId, "released")

      expect(await store.begin(claim(userId, "released"))).toEqual({ status: "claimed" })
    })

    await t.step("a run that died is taken over by exactly one retry", async () => {
      await store.begin(claim(userId, "died"))
      await sql`
        UPDATE idempotency_keys SET updated_at = now() - interval '1 hour'
        WHERE user_id = ${userId} AND key = 'died'
      `

      const outcomes = await Promise.all(
        Array.from({ length: 10 }, () => store.begin(claim(userId, "died"))),
      )

      expect(outcomes.filter((outcome) => outcome.status === "claimed").length).toBe(1)
      expect(outcomes.filter((outcome) => outcome.status === "in_progress").length).toBe(9)
    })

    await t.step("a key older than seven days is forgotten at once and swept", async () => {
      await store.begin(claim(userId, "old"))
      await store.complete(userId, "old", "first")
      await store.begin(claim(userId, "recent"))
      await store.complete(userId, "recent", "kept")
      await sql`
        UPDATE idempotency_keys SET created_at = now() - interval '8 days'
        WHERE user_id = ${userId} AND key = 'old'
      `
      await sql`
        UPDATE idempotency_keys SET created_at = now() - interval '6 days'
        WHERE user_id = ${userId} AND key = 'recent'
      `
      // A second expired row that nothing reads, so only the sweep can remove it.
      await store.begin(claim(userId, "old-unread"))
      await sql`
        UPDATE idempotency_keys SET created_at = now() - interval '8 days'
        WHERE user_id = ${userId} AND key = 'old-unread'
      `

      expect(await store.begin(claim(userId, "old"))).toEqual({ status: "claimed" })
      expect(await store.sweep()).toBe(1)
      expect(await store.begin(claim(userId, "recent"))).toEqual({
        status: "replay",
        result: "kept",
      })
      const left = await sql<CountRow[]>`
        SELECT COUNT(*)::int AS count FROM idempotency_keys WHERE key = 'old-unread'
      `
      expect(left[0].count).toBe(0)
    })

    await t.step(
      "replaying a group create returns the first result and changes nothing",
      async () => {
        const repository = new PostgresGroupRepository(sql)
        const bus = new CommandBus()
        bus.use(createIdempotencyMiddleware({ store }))
        bus.register(GroupCreateCommand, createGroupCreateHandler(repository))
        const actor = {
          userId,
          userMfa: UserMFAStatus.NOT_CONFIGURED,
          sessionSecondFactor: SecondFactorStatus.NotRequired,
        }
        const send = (requestId: string) =>
          bus.execute(
            new GroupCreateCommand({
              actor,
              id: "0b1f3c58-7f55-4a5d-8f6e-6a3a5a9d1a01",
              kind: GroupKind.SHARED,
              name: "Replayed team",
              requestId,
              idempotencyKey: "create-team-1",
            }),
          )

        const first = await send("request-1")
        const replay = await send("request-2")

        // The repository alone would answer the second send `created: false`.
        expect(first.created).toBe(true)
        expect(replay.created).toBe(true)
        expect(replay.group.id).toBe(first.group.id)
        const stamped = await sql<SequenceRow[]>`
          SELECT
            (SELECT next_change_sequence::text FROM groups WHERE id = ${first.group.id}) AS next,
            (SELECT COUNT(*)::int FROM outbox_events WHERE aggregate_id = ${first.group.id}) AS outbox
        `
        expect(stamped[0]).toEqual({ next: "2", outbox: 1 })
      },
    )
  })
})
