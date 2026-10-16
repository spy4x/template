/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import {
  ADMIN_AUDIT_EXPORTED_KIND,
  ADMIN_AUDIT_NO_FILTER,
  ADMIN_JOB_RETRIED_KIND,
  type AdminAuditFilter,
  AuthAuditEventType,
  UserRole,
} from "@domain/identity"
import { type AdminAuditPageKey, listAdminAudit } from "@server/auth/admin-audit.ts"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { applyMigrations } from "./migrations.ts"

/**
 * The operator area's audit log (#429) against a real Postgres with every migration applied: both
 * tables as one list, its keyset pages across entries written in the same microsecond, each
 * filter, and that a group entry's details never leave the database.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `admin_audit_test_${uuidV7().replaceAll("-", "")}`
  const sql = postgres({
    ...settings,
    max: 4,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    await applyMigrations(sql)
    await body(sql)
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
}

async function person(
  sql: postgres.Sql,
  first: string,
  email: string,
  role = UserRole.VIEWER,
): Promise<number> {
  const [{ id }] = await sql<{ id: number }[]>`
    WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
    INSERT INTO users (id, first_name, last_name, role)
    SELECT id, ${first}, 'Test', ${role} FROM auth_user RETURNING id
  `
  await sql`
    INSERT INTO auth_keys (user_id, method, subject, email) VALUES (${id}, 'password', ${email}, ${email})
  `
  return id
}

// One instant shared by three entries in both tables, so the page key's tie-breaks are exercised.
const T1 = "2026-10-10T10:00:00.123456Z"
const T2 = "2026-10-12T10:00:00.000001Z"
const T3 = "2026-10-14T10:00:00Z"

/** Ada and Bob sign in at T1, Ada adds a note then; the operator blocks Ada, then retries a job. */
async function seed(sql: postgres.Sql) {
  const ada = await person(sql, "Ada", "ada@example.com")
  const bob = await person(sql, "Bob", "bob@example.com")
  const op = await person(sql, "Grace", "grace@example.com", UserRole.OPERATOR)
  const groupId = uuidV7()
  await sql`INSERT INTO groups (id, name, owner_user_id) VALUES (${groupId}, 'Family', ${ada})`
  await sql`
    INSERT INTO auth_audits (user_id, event_type, identifier, ip, user_agent, created_at) VALUES
      (${ada}, ${AuthAuditEventType.SIGNED_IN}, 'ada@example.com', '192.0.2.10', 'Firefox', ${T1}),
      (${bob}, ${AuthAuditEventType.SIGNED_IN}, 'bob@example.com', '198.51.100.7', 'Safari', ${T1}),
      (${ada}, ${AuthAuditEventType.USER_BLOCKED}, ${`operator:${op}`}, '203.0.113.5', 'Edge', ${T2})
  `
  await sql`
    INSERT INTO audit_events (event_kind, actor_user_id, group_id, created_at, details) VALUES
      ('note.created', ${ada}, ${groupId}, ${T1}, ${sql.json({ title: "Secret title" })})
  `
  await sql`
    INSERT INTO audit_events (event_kind, actor_user_id, entity_type, entity_id, created_at, details)
    VALUES (${ADMIN_JOB_RETRIED_KIND}, ${op}, 'job', ${uuidV7()}, ${T3},
      ${sql.json({ kind: "mail.password_reset" })})
  `
  return { ada, bob, op, groupId }
}

const filter = (part: Partial<AdminAuditFilter>): AdminAuditFilter => ({
  ...ADMIN_AUDIT_NO_FILTER,
  ...part,
})

/** Every entry, walking pages of `size` from the newest. */
async function walk(sql: postgres.Sql, size: number, where = ADMIN_AUDIT_NO_FILTER) {
  const keys: string[] = []
  let after: AdminAuditPageKey | null = null
  for (let page = 0; page < 20; page++) {
    const result = await listAdminAudit(sql, where, size, after)
    keys.push(...result.entries.map((entry) => entry.key))
    if (!result.next) return keys
    after = result.next
  }
  throw new Error("the pages never ended")
}

Deno.test("audit log: merges both tables newest first, and at one instant activity first", async () => {
  await withSchema(async (sql) => {
    const { ada, op, groupId } = await seed(sql)
    const { entries, next } = await listAdminAudit(sql, ADMIN_AUDIT_NO_FILTER, 50, null)

    expect(next).toBeNull()
    expect(entries.map((entry) => entry.event)).toEqual([
      `activity:${ADMIN_JOB_RETRIED_KIND}`,
      `account:${AuthAuditEventType.USER_BLOCKED}`,
      "activity:note.created",
      `account:${AuthAuditEventType.SIGNED_IN}`,
      `account:${AuthAuditEventType.SIGNED_IN}`,
    ])
    const [retried, blocked, note] = entries
    expect(retried).toMatchObject({
      byOperator: true,
      jobKind: "mail.password_reset",
      actor: { id: op, name: "Grace Test", email: "grace@example.com" },
    })
    expect(blocked).toMatchObject({
      byOperator: true,
      identifier: null,
      ip: "203.0.113.5",
      person: { id: ada, name: "Ada Test" },
      actor: { id: op, name: "Grace Test" },
    })
    expect(note).toMatchObject({
      group: { id: groupId, name: "Family" },
      actor: { id: ada },
      identifier: null,
      jobKind: null,
    })
  })
})

Deno.test("audit log: never sends a group entry's details, which can quote a note", async () => {
  await withSchema(async (sql) => {
    await seed(sql)
    const { entries } = await listAdminAudit(sql, ADMIN_AUDIT_NO_FILTER, 50, null)

    expect(JSON.stringify(entries)).not.toContain("Secret title")
  })
})

Deno.test("audit log: pages of any size list every entry once, ties included", async () => {
  await withSchema(async (sql) => {
    await seed(sql)
    const all = await walk(sql, 50)

    expect(all).toHaveLength(5)
    for (const size of [1, 2, 3]) expect(await walk(sql, size)).toEqual(all)
  })
})

Deno.test("audit log: filters by event", async () => {
  await withSchema(async (sql) => {
    await seed(sql)
    const signIns = await listAdminAudit(
      sql,
      filter({ event: `account:${AuthAuditEventType.SIGNED_IN}` }),
      50,
      null,
    )
    const notes = await listAdminAudit(sql, filter({ event: "activity:note.created" }), 50, null)

    expect(signIns.entries.map((entry) => entry.identifier)).toEqual([
      "bob@example.com",
      "ada@example.com",
    ])
    expect(notes.entries.map((entry) => entry.event)).toEqual(["activity:note.created"])
  })
})

Deno.test("audit log: filters by person, by id or by name, as subject or as actor", async () => {
  await withSchema(async (sql) => {
    const { ada, op } = await seed(sql)
    const byName = await walk(sql, 50, filter({ person: "ada" }))
    const byId = await walk(sql, 50, filter({ person: String(ada) }))
    const operator = await listAdminAudit(sql, filter({ person: "grace" }), 50, null)

    expect(byName).toEqual(byId)
    expect(byName).toHaveLength(3)
    expect(operator.entries.every((entry) => entry.actor?.id === op)).toBe(true)
    expect(operator.entries).toHaveLength(2)
  })
})

Deno.test("audit log: filters by operator, finding only what that operator did", async () => {
  await withSchema(async (sql) => {
    const { op, bob } = await seed(sql)
    const theirs = await listAdminAudit(sql, filter({ operator: op }), 50, null)
    const nobody = await listAdminAudit(sql, filter({ operator: bob }), 50, null)

    expect(theirs.entries.map((entry) => entry.event)).toEqual([
      `activity:${ADMIN_JOB_RETRIED_KIND}`,
      `account:${AuthAuditEventType.USER_BLOCKED}`,
    ])
    expect(nobody.entries).toEqual([])
  })
})

Deno.test("audit log: filters by the start of an IP address, which group entries lack", async () => {
  await withSchema(async (sql) => {
    await seed(sql)
    const { entries } = await listAdminAudit(sql, filter({ ip: "192.0.2." }), 50, null)

    expect(entries.map((entry) => entry.ip)).toEqual(["192.0.2.10"])
  })
})

Deno.test("audit log: filters by UTC days, both ends included", async () => {
  await withSchema(async (sql) => {
    await seed(sql)
    const day = await walk(sql, 50, filter({ from: "2026-10-12", to: "2026-10-12" }))
    const from = await walk(sql, 50, filter({ from: "2026-10-12" }))
    const to = await walk(sql, 50, filter({ to: "2026-10-10" }))

    expect(day).toHaveLength(1)
    expect(from).toHaveLength(2)
    expect(to).toHaveLength(3)
  })
})

Deno.test("audit log: lists the operators for the filter, and records an export", async () => {
  await withSchema(async (sql) => {
    const { op } = await seed(sql)
    const db = new AppDbBase({ sql })

    expect(await db.adminAudit.operators()).toEqual([
      { id: op, name: "Grace Test", email: "grace@example.com" },
    ])
    await db.adminAudit.recordExport(op, 5, "req-1")
    const [row] = await sql<{ actorUserId: number; requestId: string; details: unknown }[]>`
      SELECT actor_user_id, request_id, details FROM audit_events
      WHERE event_kind = ${ADMIN_AUDIT_EXPORTED_KIND}
    `
    expect(row).toEqual({ actorUserId: op, requestId: "req-1", details: { rows: 5 } })
  })
})
