/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import {
  createTotpFailures,
  FIRST_LOCK_MS,
  FREE_FAILURES,
  QUIET_RESET_MS,
} from "../../apps/api/services/totp-failures.ts"
import { requireDbConnection } from "./db-connection.ts"

interface IdRow extends postgres.Row {
  id: number
}

/** Runs `body` on a fresh schema built from schema.sql, with a helper that opens more clients. */
async function withSchema(
  body: (open: () => postgres.Sql, sql: postgres.Sql) => Promise<void>,
): Promise<void> {
  const connection = requireDbConnection()
  const admin = postgres({ ...connection, max: 1 })
  const schema = `totp_test_${crypto.randomUUID().replaceAll("-", "")}`
  const clients: postgres.Sql[] = []
  const open = () => {
    const client = postgres({
      ...connection,
      max: 25,
      transform: postgres.camel,
      connection: { options: `-c search_path=${schema}` },
      onnotice: () => {},
    })
    clients.push(client)
    return client
  }
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    const first = open()
    await first.unsafe(await Deno.readTextFile("libs/server/db/schema.sql"))
    await body(open, first)
  } finally {
    for (const client of clients) await client.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
}

/** A user with a confirmed authenticator enrolment. */
async function insertEnrolledUser(sql: postgres.Sql): Promise<number> {
  const rows = await sql<IdRow[]>`
    WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id),
    profile AS (INSERT INTO users (id, mfa) SELECT id, 3 FROM auth_user RETURNING id)
    INSERT INTO user_totp (user_id, secret, confirmed_at) SELECT id, 'JBSWY3DPEHPK3PXP', now()
    FROM profile RETURNING user_id AS id
  `
  return rows[0].id
}

const T0 = 1_700_000_000_000
const HOUR = 60 * 60_000

Deno.test("totp failure counter survives an API restart", async () => {
  await withSchema(async (open, sql) => {
    const userId = await insertEnrolledUser(sql)
    const before = createTotpFailures({ sql, clock: () => T0 })
    for (let attempt = 0; attempt <= FREE_FAILURES; attempt++) {
      expect(await before.begin(userId)).toBe(0)
    }
    expect(await before.begin(userId)).toBe(FIRST_LOCK_MS)

    // A restart: a new connection pool and a new counter, nothing shared but the database.
    const restarted = createTotpFailures({ sql: open(), clock: () => T0 + 60_000 })
    expect(await restarted.begin(userId)).toBe(FIRST_LOCK_MS - 60_000)

    const later = createTotpFailures({ sql: open(), clock: () => T0 + FIRST_LOCK_MS })
    expect(await later.begin(userId)).toBe(0)
  })
})

Deno.test("totp failure counter lets only six of twenty parallel guesses run", async () => {
  await withSchema(async (_open, sql) => {
    const userId = await insertEnrolledUser(sql)
    const counter = createTotpFailures({ sql, clock: () => T0 })
    const waits = await Promise.all(Array.from({ length: 20 }, () => counter.begin(userId)))
    expect(waits.filter((wait) => wait === 0)).toHaveLength(FREE_FAILURES + 1)
  })
})

Deno.test("totp failure counter gives back exactly the slot a correct code took", async () => {
  await withSchema(async (_open, sql) => {
    const userId = await insertEnrolledUser(sql)
    const counter = createTotpFailures({ sql, clock: () => T0 })
    for (let attempt = 0; attempt < FREE_FAILURES; attempt++) await counter.begin(userId)
    await counter.refund(userId)
    // Four failures are left on the count, so one more is free and the next one locks.
    expect(await counter.begin(userId)).toBe(0)
    expect(await counter.begin(userId)).toBe(0)
    expect(await counter.begin(userId)).toBe(FIRST_LOCK_MS)
  })
})

Deno.test("totp failure counter starts again from 0 after seven quiet days", async () => {
  await withSchema(async (open, sql) => {
    const early = await insertEnrolledUser(sql)
    const late = await insertEnrolledUser(sql)
    for (const userId of [early, late]) {
      for (let attempt = 0; attempt <= FREE_FAILURES; attempt++) {
        await createTotpFailures({ sql, clock: () => T0 }).begin(userId)
      }
    }
    // One millisecond short of seven days: the seventh failure counts and doubles the lock.
    const almost = createTotpFailures({ sql: open(), clock: () => T0 + QUIET_RESET_MS - 1 })
    expect(await almost.begin(early)).toBe(0)
    expect(await almost.begin(early)).toBe(2 * FIRST_LOCK_MS)

    const after = createTotpFailures({ sql: open(), clock: () => T0 + QUIET_RESET_MS })
    for (let attempt = 0; attempt <= FREE_FAILURES; attempt++) {
      expect(await after.begin(late)).toBe(0)
    }
    expect(await after.begin(late)).toBe(FIRST_LOCK_MS)
  })
})

Deno.test("totp failure counter caps a guesser under 600 guesses in a year", async () => {
  const year = 365 * 24 * 60 * 60_000
  /** Guesses the counter lets through in a year when the guesser follows `nextTry`. */
  async function guessesInAYear(
    sql: postgres.Sql,
    userId: number,
    nextTry: (now: number, waitMs: number) => number,
  ): Promise<number> {
    let now = T0
    let guesses = 0
    const counter = createTotpFailures({ sql, clock: () => now })
    while (now < T0 + year) {
      const waitMs = await counter.begin(userId)
      if (waitMs === 0) guesses += 1
      now = nextTry(now, waitMs)
    }
    return guesses
  }
  await withSchema(async (_open, sql) => {
    // Tries again the moment the lock ends, and every hour while there is none.
    const eager = await insertEnrolledUser(sql)
    const eagerGuesses = await guessesInAYear(
      sql,
      eager,
      (now, waitMs) => now + Math.max(waitMs, HOUR),
    )
    expect(eagerGuesses).toBeLessThan(600)
    // Guesses hourly while allowed, and waits seven days when the lock is longer than an hour, so
    // the count starts again from 0 every time.
    const patient = await insertEnrolledUser(sql)
    const patientGuesses = await guessesInAYear(
      sql,
      patient,
      (now, waitMs) => now + (waitMs > HOUR ? QUIET_RESET_MS : HOUR),
    )
    expect(patientGuesses).toBeLessThan(600)
    // 3 valid codes out of 10^6 at any moment: 600 guesses is a chance of 0.18%.
  })
})

Deno.test("totp failure counter has nothing to count for a user without an enrolment", async () => {
  await withSchema(async (_open, sql) => {
    const counter = createTotpFailures({ sql, clock: () => T0 })
    for (let attempt = 0; attempt < 10; attempt++) expect(await counter.begin(424242)).toBe(0)
  })
})
