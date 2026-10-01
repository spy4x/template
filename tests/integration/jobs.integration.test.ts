/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import {
  ensureScheduledOutboxEvent,
  OutboxProcessor,
  PostgresOutboxRepository,
  scheduleOutboxEvent,
} from "@spy4x/server/outbox"
import {
  JOB_AGGREGATE,
  JOB_AGGREGATE_ID,
  JobPublisher,
  OUTBOX_CLEANUP_JOB,
  removeProcessedOutboxEvents,
} from "@server/jobs/jobs.ts"
import { requireDbConnection } from "./db-connection.ts"

const JOB = {
  eventKind: OUTBOX_CLEANUP_JOB,
  aggregateType: JOB_AGGREGATE,
  aggregateId: JOB_AGGREGATE_ID,
}

/** Runs `body` on a fresh schema built from schema.sql. */
async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const connection = requireDbConnection()
  const admin = postgres({ ...connection, max: 1 })
  const schema = `jobs_test_${crypto.randomUUID().replaceAll("-", "")}`
  const sql = postgres({
    ...connection,
    max: 5,
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

/**
 * Moves every stored time `minutes` into the past. The claim reads the database clock, so this is
 * what the clock reaching those times looks like.
 */
async function advanceClock(sql: postgres.Sql, minutes: number): Promise<void> {
  await sql`
    UPDATE outbox_events
    SET available_at = available_at - make_interval(mins => ${minutes}),
        processed_at = processed_at - make_interval(mins => ${minutes})
  `
}

Deno.test("delayed and repeating jobs in Postgres", async (t) => {
  await withSchema(async (sql) => {
    await t.step("a job scheduled for later runs at its time and not before", async () => {
      const ran: string[] = []
      const processor = new OutboxProcessor(
        new PostgresOutboxRepository(sql),
        new JobPublisher({ [OUTBOX_CLEANUP_JOB]: () => Promise.resolve(void ran.push("ran")) }, {
          publish: () => Promise.resolve(),
        }),
      )
      await scheduleOutboxEvent(sql, JOB, { inMs: 60 * 60_000 })

      expect((await processor.drainOnce()).claimed).toBe(0)
      await advanceClock(sql, 30)
      expect((await processor.drainOnce()).claimed).toBe(0)
      expect(ran).toEqual([])

      await advanceClock(sql, 31)
      expect((await processor.drainOnce()).published).toBe(1)
      expect(ran).toEqual(["ran"])
    })

    await sql`DELETE FROM outbox_events`

    await t.step("a failing job backs off, then stops with its error stored", async () => {
      const processor = new OutboxProcessor(
        new PostgresOutboxRepository(sql),
        new JobPublisher({ [OUTBOX_CLEANUP_JOB]: () => Promise.reject(new TypeError("down")) }, {
          publish: () => Promise.resolve(),
        }),
        { maxAttempts: 3, baseRetryDelayMs: 60_000 },
      )
      await scheduleOutboxEvent(sql, JOB, { inMs: 0 })

      const waits: number[] = []
      for (let attempt = 1; attempt <= 3; attempt++) {
        expect((await processor.drainOnce()).failed).toBe(1)
        const [row] = await sql<{ minutes: number }[]>`
          SELECT round(extract(epoch FROM available_at - now()) / 60)::int AS minutes
          FROM outbox_events
        `
        waits.push(row.minutes)
        await advanceClock(sql, row.minutes + 1)
      }
      expect(waits).toEqual([1, 2, 4])

      expect((await processor.drainOnce()).claimed).toBe(0)
      const [row] = await sql<{ lastErrorCode: string; processedAt: Date | null }[]>`
        SELECT last_error_code, processed_at FROM outbox_events
      `
      expect(row).toEqual({ lastErrorCode: "TypeError", processedAt: null })
    })

    await sql`DELETE FROM outbox_events`

    await t.step(
      "the nightly cleanup repeats itself and removes only old processed rows",
      async () => {
        const group = await sql<{ id: string; userId: number }[]>`
        WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id),
        u AS (INSERT INTO users (id) SELECT id FROM auth_user RETURNING id)
        SELECT u.id AS user_id, gen_random_uuid() AS id FROM u
      `
        const { id: groupId, userId } = group[0]
        await sql`
        INSERT INTO groups (id, kind, name, owner_user_id, created_by_user_id)
        VALUES (${groupId}, 2, 'jobs fixture', ${userId}, ${userId})
      `
        const insertChange = (version: number, processed: string | null) =>
          sql`
          INSERT INTO outbox_events (
            id, event_kind, aggregate_type, aggregate_id, aggregate_version, group_id,
            actor_user_id, processed_at
          ) VALUES (
            ${crypto.randomUUID()}, 'group.created', 'group', ${groupId}, ${version}, ${groupId},
            ${userId}, ${processed === null ? null : sql`now() - ${processed}::interval`}
          )
        `
        await insertChange(1, "8 days") // old and processed: removed
        await insertChange(2, "1 day") // recent and processed: kept
        await insertChange(3, null) // not processed: kept

        expect(await ensureScheduledOutboxEvent(sql, JOB, { inMs: 0 })).not.toBeNull()
        expect(await ensureScheduledOutboxEvent(sql, JOB, { inMs: 0 })).toBeNull()

        const processor = new OutboxProcessor(
          new PostgresOutboxRepository(sql),
          new JobPublisher(
            { [OUTBOX_CLEANUP_JOB]: async () => void await removeProcessedOutboxEvents(sql) },
            { publish: () => Promise.resolve() },
          ),
          { repeatEveryMs: { [OUTBOX_CLEANUP_JOB]: 24 * 60 * 60_000 } },
        )
        // The group rows are claimed too and handed to the stand-in fallback.
        await processor.drainOnce()

        const versions = await sql<{ version: string }[]>`
        SELECT aggregate_version::text AS version FROM outbox_events
        WHERE aggregate_type = 'group' ORDER BY aggregate_version
      `
        expect(versions.map((row) => row.version)).toEqual(["2", "3"])

        const [next] = await sql<{ hours: number; count: number }[]>`
        SELECT round(extract(epoch FROM available_at - now()) / 3600)::int AS hours,
          (SELECT count(*)::int FROM outbox_events WHERE event_kind = ${OUTBOX_CLEANUP_JOB}) AS count
        FROM outbox_events WHERE event_kind = ${OUTBOX_CLEANUP_JOB} AND processed_at IS NULL
      `
        expect(next).toEqual({ hours: 24, count: 2 })
      },
    )
  })
})
