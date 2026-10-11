/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import type postgres from "postgres"
import { sha256Hex } from "@spy4x/platform/tokens"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { API_TOKEN_PURGE_GRACE_DAYS, ApiTokenAccess } from "@domain/api-tokens"
import {
  API_TOKENS_PURGED_EVENT,
  purgeExpiredApiTokens,
} from "@server/api-tokens/purge-expired-api-tokens.ts"
import { OUTBOX_CLEANUP_JOB } from "@server/jobs/jobs.ts"
import { createOutboxProcessor, scheduleNightlyJobs } from "@server/jobs/wiring.ts"
import { team, withSchema } from "./group-team.ts"

/**
 * The worker's purge of expired personal API tokens (#293) against a real Postgres. Needs the
 * `DB_*` values (recipe in docs/handoff.md); `withSchema` fails when they are missing rather than
 * skipping.
 */

interface AuditRow {
  actorUserId: number | null
  groupId: string | null
  details: Record<string, unknown>
}

/** Every purge audit row, oldest first. */
async function purgeAudits(sql: postgres.Sql): Promise<AuditRow[]> {
  return await sql<AuditRow[]>`
    SELECT actor_user_id, group_id, details FROM audit_events
    WHERE event_kind = ${API_TOKENS_PURGED_EVENT} ORDER BY id
  `
}

/** The names of the tokens left in the table, sorted. */
async function names(sql: postgres.Sql): Promise<string[]> {
  return (await sql<{ name: string }[]>`SELECT name FROM api_tokens ORDER BY name`)
    .map((row) => row.name)
}

/**
 * Writes one token per entry for the team's owner. A number is how many days ago the token
 * expired, by the database clock (negative: it expires that far ahead); `null` never expires.
 */
async function seed(sql: postgres.Sql, tokens: Record<string, number | null>): Promise<string[]> {
  const { groupId, owner } = await team(sql)
  const hashes: string[] = []
  for (const [name, expiredDaysAgo] of Object.entries(tokens)) {
    const hash = await sha256Hex(`${name}-${uuidV7()}`)
    hashes.push(hash)
    await sql`
      INSERT INTO api_tokens (id, user_id, group_id, name, token_hash, access, expires_at)
      VALUES (${uuidV7()}, ${owner}, ${groupId}, ${name}, ${hash}, ${ApiTokenAccess.READ},
        now() - make_interval(days => ${expiredDaysAgo}::int))
    `
  }
  return hashes
}

Deno.test("purge: a token expired longer ago than the grace period is deleted, others stay", async () => {
  await withSchema(async (sql) => {
    await seed(sql, {
      "long-expired": API_TOKEN_PURGE_GRACE_DAYS + 1,
      "just-expired": API_TOKEN_PURGE_GRACE_DAYS - 1,
      "live": -30,
      "never-expires": null,
    })

    expect(await purgeExpiredApiTokens(sql)).toBe(1)

    expect(await names(sql)).toEqual(["just-expired", "live", "never-expires"])
  })
})

Deno.test("purge: one audit row per run that deleted tokens, with the count and the cutoff", async () => {
  await withSchema(async (sql) => {
    const hashes = await seed(sql, {
      "old-a": API_TOKEN_PURGE_GRACE_DAYS + 1,
      "old-b": API_TOKEN_PURGE_GRACE_DAYS + 200,
      "live": -30,
    })
    const before = Date.now()

    expect(await purgeExpiredApiTokens(sql)).toBe(2)

    const audits = await purgeAudits(sql)
    expect(audits.length).toBe(1)
    expect(audits[0].actorUserId).toBeNull()
    expect(audits[0].groupId).toBeNull()
    expect(Object.keys(audits[0].details).sort()).toEqual(["count", "cutoff"])
    expect(audits[0].details.count).toBe(2)
    const cutoff = Date.parse(String(audits[0].details.cutoff))
    const expected = before - API_TOKEN_PURGE_GRACE_DAYS * 24 * 60 * 60_000
    // The database's clock and this process's may differ a little; a wrong grace is days off.
    expect(Math.abs(cutoff - expected)).toBeLessThan(5 * 60_000)
    const stored = JSON.stringify(audits[0])
    for (const hash of hashes) expect(stored).not.toContain(hash)
    expect(stored).not.toContain("old-a")
  })
})

Deno.test("purge: a run that finds nothing to delete writes no audit row", async () => {
  await withSchema(async (sql) => {
    await seed(sql, { "just-expired": API_TOKEN_PURGE_GRACE_DAYS - 1, "live": -30 })

    expect(await purgeExpiredApiTokens(sql)).toBe(0)

    expect(await purgeAudits(sql)).toEqual([])
    expect(await names(sql)).toEqual(["just-expired", "live"])
  })
})

Deno.test("purge: when the audit row cannot be written, no token is deleted", async () => {
  await withSchema(async (sql) => {
    await seed(sql, { "long-expired": API_TOKEN_PURGE_GRACE_DAYS + 1 })
    await sql`
      CREATE FUNCTION refuse_audit_row() RETURNS trigger LANGUAGE plpgsql
      AS $$ BEGIN RAISE EXCEPTION 'no audit rows in this test'; END $$
    `
    await sql`
      CREATE TRIGGER refuse_audit_row BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION refuse_audit_row()
    `

    await expect(purgeExpiredApiTokens(sql)).rejects.toThrow("no audit rows in this test")

    expect(await names(sql)).toEqual(["long-expired"])
  })
})

Deno.test("purge: the worker's nightly cleanup deletes long-expired tokens and audits it once", async () => {
  await withSchema(async (sql) => {
    await seed(sql, {
      "long-expired": API_TOKEN_PURGE_GRACE_DAYS + 1,
      "just-expired": API_TOKEN_PURGE_GRACE_DAYS - 1,
      "live": -30,
    })
    const processor = createOutboxProcessor(sql, {
      store: {} as never,
      sender: { send: () => Promise.reject(new Error("no mail in this test")) },
      brand: { webAppUrl: "http://app.localhost" },
      log: () => {},
    })

    await scheduleNightlyJobs(sql)
    await sql`
      UPDATE outbox_events SET available_at = now() - interval '1 second'
      WHERE event_kind = ${OUTBOX_CLEANUP_JOB} AND processed_at IS NULL
    `
    expect((await processor.drainOnce()).failed).toBe(0)

    expect(await names(sql)).toEqual(["just-expired", "live"])
    const audits = await purgeAudits(sql)
    expect(audits.length).toBe(1)
    expect(audits[0].details.count).toBe(1)
  })
})
