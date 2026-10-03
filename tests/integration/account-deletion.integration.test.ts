/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import postgres from "postgres"
import type { EmailMessage } from "@spy4x/email/message"
import type { EmailSender } from "@spy4x/email/sender"
import type { OutboxEvent } from "@spy4x/server/outbox"
import { BillingStatus } from "@domain/billing"
import { AccountDeletionBlockReason } from "@domain/identity"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn, type SignIn } from "../../apps/api/services/sign-in.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import {
  hardDeleteAccount,
  hardDeleteDueAccounts,
  HardDeleteOutcome,
} from "../../libs/server/auth/account-deletion.ts"
import {
  ACCOUNT_DELETION_MAIL_JOB,
  ACCOUNT_HARD_DELETE_JOB,
  accountDeletionMailJob,
} from "../../libs/server/jobs/account-deletion.ts"
import { requireDbConnection } from "./db-connection.ts"

/**
 * Deleting one's own account (#144) against a real Postgres: the request, the refusal while a group
 * stops it, the restore by signing in, and the delete for good that must leave no row pointing at
 * the person. That last check reads the catalog for every foreign key to `users` and `auth_users`,
 * so a table added later is covered without touching this file.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

const MIGRATIONS_DIR = "libs/server/db/migrations"
// Test-only secrets, long enough for the package's 32-character minimum.
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"
const PASSWORD = "Passw0rd!"

/** Runs `body` against a fresh schema with every migration applied, and drops the schema after. */
async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = requireDbConnection()
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `account_deletion_test_${crypto.randomUUID().replaceAll("-", "")}`
  const sql = postgres({
    ...settings,
    max: 10,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    const names = [...Deno.readDirSync(MIGRATIONS_DIR)].map((entry) => entry.name).sort()
    for (const name of names) {
      await sql.unsafe(await Deno.readTextFile(`${MIGRATIONS_DIR}/${name}`))
    }
    await body(sql)
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
}

/** A test app over the real sign-in: sign-up, sign-in, the session check and the delete. */
function buildApp(sql: postgres.Sql) {
  const db = new AppDbBase({ sql })
  const signIn: SignIn = createSignIn({
    db,
    pepper: PEPPER,
    cookieSecret: COOKIE_SECRET,
    secureCookie: false,
    sessionMinutes: 60,
    totpIssuer: "example.test",
  })
  const app = new Hono<APIContext>()
  app.use(signIn.auth.parseAuth)
  app.post("/sign-up", async (c) => {
    const { email, password } = await c.req.json()
    const result = await signIn.signUp(c, email, password)
    return result ? c.json(result.user) : c.json({ error: "refused" }, 401)
  })
  app.post("/sign-in", async (c) => {
    const { login, password } = await c.req.json()
    const result = await signIn.signIn(c, login, password)
    return result ? c.json(result.user) : c.json({ error: "refused" }, 401)
  })
  app.get("/me", (c) => c.get("auth") ? c.json(c.get("auth")!.user) : c.json({}, 401))
  app.post("/delete", async (c) => {
    const auth = c.get("auth")
    if (!auth) return c.json({ error: "signed out" }, 401)
    return c.json(await signIn.deleteAccount(c, auth))
  })
  const request = (path: string, init: { body?: unknown; cookie?: string } = {}) =>
    app.request(`http://local${path}`, {
      method: init.body === undefined && path === "/me" ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        ...(init.cookie ? { cookie: init.cookie } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  return { db, request }
}

type App = ReturnType<typeof buildApp>

/** The session cookie a response set, as a browser sends it back. */
function cookieOf(response: Response): string {
  const header = response.headers.get("set-cookie")
  if (!header) throw new Error("the response set no cookie")
  return header.split(";")[0]
}

/** Signs `<name>@example.com` up; answers the user's id and the session cookie. */
async function signUp(app: App, name: string): Promise<{ id: number; cookie: string }> {
  const response = await app.request("/sign-up", {
    body: { email: `${name}@example.com`, password: PASSWORD },
  })
  expect(response.status).toBe(200)
  return { id: ((await response.json()) as { id: number }).id, cookie: cookieOf(response) }
}

/** Signs in as `<name>@example.com`; answers the response. */
async function signIn(app: App, name: string): Promise<Response> {
  return await app.request("/sign-in", {
    body: { login: `${name}@example.com`, password: PASSWORD },
  })
}

/**
 * Asks for the deletion of `user`'s account with `cookie`, their session by default; answers the
 * waiting request's id and the date the API answered.
 */
async function requestDeletion(
  app: App,
  sql: postgres.Sql,
  user: { id: number; cookie: string },
  cookie = user.cookie,
): Promise<{ id: string; deleteAfter: string }> {
  const response = await app.request("/delete", { body: {}, cookie })
  expect(response.status).toBe(200)
  const body = await response.json() as { deleteAfter?: string }
  expect(typeof body.deleteAfter).toBe("string")
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM account_deletions WHERE user_id = ${user.id}
  `
  return { id: row.id, deleteAfter: body.deleteAfter! }
}

/** Moves the user's waiting request into the past, as if its 7 days were over. */
async function makeDue(sql: postgres.Sql, userId: number): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    UPDATE account_deletions SET delete_after = now() - INTERVAL '1 second'
    WHERE user_id = ${userId}
    RETURNING id
  `
  return row.id
}

/** Every column that references `users.id` or `auth_users.id`, read from the catalog. */
async function userReferences(sql: postgres.Sql): Promise<{ table: string; column: string }[]> {
  return await sql<{ table: string; column: string }[]>`
    SELECT source.relname AS "table", source_column.attname AS "column"
    FROM pg_constraint
    INNER JOIN pg_class source ON source.oid = pg_constraint.conrelid
    INNER JOIN pg_class target ON target.oid = pg_constraint.confrelid
    INNER JOIN pg_namespace ON pg_namespace.oid = source.relnamespace
    CROSS JOIN LATERAL unnest(pg_constraint.conkey, pg_constraint.confkey)
      AS pairs(source_attnum, target_attnum)
    INNER JOIN pg_attribute source_column
      ON source_column.attrelid = pg_constraint.conrelid
      AND source_column.attnum = pairs.source_attnum
    INNER JOIN pg_attribute target_column
      ON target_column.attrelid = pg_constraint.confrelid
      AND target_column.attnum = pairs.target_attnum
    WHERE pg_constraint.contype = 'f'
      AND pg_namespace.nspname = current_schema()
      AND target.relname IN ('users', 'auth_users')
      AND target_column.attname = 'id'
    ORDER BY 1, 2
  `
}

/** For every referencing column and the two user tables, how many rows still hold `userId`. */
async function rowsPointingAt(sql: postgres.Sql, userId: number): Promise<Record<string, number>> {
  const columns = [
    { table: "users", column: "id" },
    { table: "auth_users", column: "id" },
    ...await userReferences(sql),
  ]
  const counts: Record<string, number> = {}
  for (const { table, column } of columns) {
    const [row] = await sql.unsafe<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM "${table}" WHERE "${column}" = $1`,
      [userId],
    )
    counts[`${table}.${column}`] = row.count
  }
  return counts
}

Deno.test("deleting one's own account", async (t) => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)

    await t.step(
      "the delete for good leaves no row in any table that references the user",
      async () => {
        const ann = await signUp(app, "ann")
        const bob = await signUp(app, "bob")
        // Ann works in Bob's group: a note, an audit row, a member she added, an invitation.
        const shared = crypto.randomUUID()
        await app.db.group.create({ id: shared, name: "Bob's team" }, bob.id)
        const carl = await signUp(app, "carl")
        await sql`
          INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
          VALUES (${shared}, ${ann.id}, 3, ${bob.id}), (${shared}, ${carl.id}, 1, ${ann.id})
        `
        const note = await app.db.note.create(
          { groupId: shared, id: crypto.randomUUID(), title: "Ann's note", body: "" },
          ann.id,
          null,
        )
        await sql`
          INSERT INTO group_invitations (id, group_id, token_hash, role, created_by_user_id,
            expires_at)
          VALUES (${crypto.randomUUID()}, ${shared}, ${"a".repeat(64)}, 1, ${ann.id},
            now() + INTERVAL '1 day')
        `
        // And she has her own: a second group, a push device and settings.
        await app.db.group.create({ id: crypto.randomUUID(), name: "Ann's own" }, ann.id)
        await sql`
          INSERT INTO user_push_tokens (user_id, device_id, endpoint, auth, p256dh)
          VALUES (${ann.id}, 'device', 'https://push.example.com/1', 'auth', 'key')
        `
        const before = await rowsPointingAt(sql, ann.id)
        // Her two groups record her as who added herself; Carl's row in Bob's group is the third.
        expect(before["notes.created_by_user_id"]).toBe(1)
        expect(before["group_members.added_by_user_id"]).toBe(3)
        expect(before["group_invitations.created_by_user_id"]).toBe(1)
        expect(before["user_push_tokens.user_id"]).toBe(1)

        await requestDeletion(app, sql, ann)
        expect(await hardDeleteAccount(sql, await makeDue(sql, ann.id))).toBe(
          HardDeleteOutcome.Deleted,
        )

        const after = await rowsPointingAt(sql, ann.id)
        expect(Object.keys(after).length).toBeGreaterThan(15)
        expect(Object.entries(after).filter(([, count]) => count > 0)).toEqual([])
        // What she left in Bob's group stays, by "Deleted user".
        const [kept] = await sql<{ createdByUserId: number | null }[]>`
          SELECT created_by_user_id FROM notes WHERE id = ${note.note.id}
        `
        expect(kept).toEqual({ createdByUserId: null })
        const members = await sql<{ userId: number; addedByUserId: number | null }[]>`
          SELECT user_id, added_by_user_id FROM group_members WHERE group_id = ${shared}
          ORDER BY user_id
        `
        expect(members).toEqual([
          { userId: bob.id, addedByUserId: bob.id },
          { userId: carl.id, addedByUserId: null },
        ])
      },
    )

    await t.step(
      "the request signs out every session of the user at once, and a restore brings none back",
      async () => {
        const dan = await signUp(app, "dan")
        const other = cookieOf(await signIn(app, "dan"))
        expect((await app.request("/me", { cookie: dan.cookie })).status).toBe(200)

        await requestDeletion(app, sql, dan, other)

        expect((await app.request("/me", { cookie: dan.cookie })).status).toBe(401)
        expect((await app.request("/me", { cookie: other })).status).toBe(401)
        const [deleted] = await sql<{ deleted: boolean }[]>`
          SELECT deleted_at IS NOT NULL AS deleted FROM users WHERE id = ${dan.id}
        `
        expect(deleted.deleted).toBe(true)

        // The soft delete alone refuses the old sessions; once a sign-in restores the account,
        // only the new session works.
        const restored = cookieOf(await signIn(app, "dan"))
        expect((await app.request("/me", { cookie: restored })).status).toBe(200)
        expect((await app.request("/me", { cookie: dan.cookie })).status).toBe(401)
        expect((await app.request("/me", { cookie: other })).status).toBe(401)
      },
    )

    await t.step(
      "the request queues the mail at once and the delete for good in 7 days",
      async () => {
        const eve = await signUp(app, "eve")
        const { id, deleteAfter } = await requestDeletion(app, sql, eve)

        const jobs = await sql<{ eventKind: string; availableAt: Date }[]>`
        SELECT event_kind, available_at FROM outbox_events
        WHERE aggregate_type = 'job' AND aggregate_id = ${id}
        ORDER BY available_at
      `
        expect(jobs.map((job) => job.eventKind)).toEqual([
          ACCOUNT_DELETION_MAIL_JOB,
          ACCOUNT_HARD_DELETE_JOB,
        ])
        expect(jobs[1].availableAt.toISOString()).toBe(deleteAfter)
        const days = (jobs[1].availableAt.getTime() - jobs[0].availableAt.getTime()) / 86_400_000
        expect(Math.round(days)).toBe(7)
        // Not due yet: the job does nothing if it runs early.
        expect(await hardDeleteAccount(sql, id)).toBe(HardDeleteOutcome.NothingDue)
      },
    )

    await t.step(
      "signing in during the wait restores the account and the delete then does nothing",
      async () => {
        const fay = await signUp(app, "fay")
        const { id } = await requestDeletion(app, sql, fay)

        const response = await signIn(app, "fay")

        expect(response.status).toBe(200)
        expect((await app.request("/me", { cookie: cookieOf(response) })).status).toBe(200)
        expect(await sql`SELECT 1 FROM account_deletions WHERE user_id = ${fay.id}`).toEqual([])
        expect(await hardDeleteAccount(sql, id)).toBe(HardDeleteOutcome.NothingDue)
        const [events] = await sql<{ types: number[] }[]>`
          SELECT array_agg(event_type ORDER BY id) AS types FROM auth_audits
          WHERE user_id = ${fay.id}
        `
        expect(events.types).toEqual([1, 5, 6, 2])
      },
    )

    await t.step("a deleted account with no request waiting stays refused at sign-in", async () => {
      const gus = await signUp(app, "gus")
      await sql`UPDATE users SET deleted_at = now() WHERE id = ${gus.id}`

      expect((await signIn(app, "gus")).status).toBe(401)
      const [user] = await sql<{ deleted: boolean }[]>`
        SELECT deleted_at IS NOT NULL AS deleted FROM users WHERE id = ${gus.id}
      `
      expect(user.deleted).toBe(true)
    })

    await t.step(
      "refuses while the person owns a group others use, naming it, and changes nothing",
      async () => {
        const hal = await signUp(app, "hal")
        const ivy = await signUp(app, "ivy")
        const groupId = crypto.randomUUID()
        await app.db.group.create({ id: groupId, name: "Hal's club" }, hal.id)
        await sql`
          INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
          VALUES (${groupId}, ${ivy.id}, 1, ${hal.id})
        `

        const response = await app.request("/delete", { body: {}, cookie: hal.cookie })

        expect(await response.json()).toEqual({
          blockers: [{ groupId, name: "Hal's club", reason: AccountDeletionBlockReason.Members }],
        })
        expect((await app.request("/me", { cookie: hal.cookie })).status).toBe(200)
        expect(await sql`SELECT 1 FROM account_deletions WHERE user_id = ${hal.id}`).toEqual([])
      },
    )

    await t.step("a member who is waiting to be deleted does not stop the owner", async () => {
      const jay = await signUp(app, "jay")
      const kim = await signUp(app, "kim")
      const groupId = crypto.randomUUID()
      await app.db.group.create({ id: groupId, name: "Jay's club" }, jay.id)
      await sql`
        INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
        VALUES (${groupId}, ${kim.id}, 1, ${jay.id})
      `
      await requestDeletion(app, sql, kim)

      await requestDeletion(app, sql, jay)
    })

    await t.step("refuses while a group of theirs has a subscription not cancelled", async () => {
      const lee = await signUp(app, "lee")
      const [personal] = await sql<{ id: string; name: string }[]>`
        SELECT id, name FROM groups WHERE owner_user_id = ${lee.id}
      `
      await sql`
        INSERT INTO subscriptions (group_id, provider_subscription_id, plan_id, status,
          provider_event_at, provider_event_rank)
        VALUES (${personal.id}, 'sub_lee', 'pro', ${BillingStatus.Active}, now(), 1)
      `

      const response = await app.request("/delete", { body: {}, cookie: lee.cookie })

      expect(await response.json()).toEqual({
        blockers: [{
          groupId: personal.id,
          name: personal.name,
          reason: AccountDeletionBlockReason.Subscription,
        }],
      })
    })

    await t.step(
      "keeps an account due for deletion when a subscription arrived during the wait",
      async () => {
        const max = await signUp(app, "max")
        await requestDeletion(app, sql, max)
        const [personal] = await sql<{ id: string }[]>`
          SELECT id FROM groups WHERE owner_user_id = ${max.id}
        `
        await sql`
          INSERT INTO subscriptions (group_id, provider_subscription_id, plan_id, status,
            provider_event_at, provider_event_rank)
          VALUES (${personal.id}, 'sub_max', 'pro', ${BillingStatus.Active}, now(), 1)
        `
        const id = await makeDue(sql, max.id)

        expect(await hardDeleteAccount(sql, id)).toBe(HardDeleteOutcome.Blocked)
        expect(await sql`SELECT 1 FROM auth_users WHERE id = ${max.id}`).toHaveLength(1)

        await sql`
          UPDATE subscriptions SET status = ${BillingStatus.Canceled} WHERE group_id = ${personal.id}
        `
        expect(await hardDeleteDueAccounts(sql)).toEqual({ deleted: 1, blocked: 0 })
        expect(await sql`SELECT 1 FROM auth_users WHERE id = ${max.id}`).toEqual([])
      },
    )

    await t.step(
      "revokes the invitations into the person's groups and the ones they made elsewhere",
      async () => {
        const ned = await signUp(app, "ned")
        const oli = await signUp(app, "oli")
        const nedsGroup = crypto.randomUUID()
        await app.db.group.create({ id: nedsGroup, name: "Ned's club" }, ned.id)
        const olisGroup = crypto.randomUUID()
        await app.db.group.create({ id: olisGroup, name: "Oli's club" }, oli.id)
        await sql`
          INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
          VALUES (${olisGroup}, ${ned.id}, 3, ${oli.id})
        `
        // One into Ned's group made by someone who left it, one Ned made into Oli's group, and
        // Oli's own, which stays.
        const [intoHis, byHim, untouched] = [
          crypto.randomUUID(),
          crypto.randomUUID(),
          crypto.randomUUID(),
        ]
        await sql`
          INSERT INTO group_invitations (id, group_id, token_hash, role, created_by_user_id,
            expires_at)
          VALUES
            (${intoHis}, ${nedsGroup}, ${"b".repeat(64)}, 1, ${oli.id}, now() + INTERVAL '1 day'),
            (${byHim}, ${olisGroup}, ${"c".repeat(64)}, 1, ${ned.id}, now() + INTERVAL '1 day'),
            (${untouched}, ${olisGroup}, ${"d".repeat(64)}, 1, ${oli.id}, now() + INTERVAL '1 day')
        `

        await requestDeletion(app, sql, ned)

        const invitations = await sql<{ id: string; revoked: boolean }[]>`
          SELECT id, revoked_at IS NOT NULL AS revoked FROM group_invitations
          WHERE id IN ${sql([intoHis, byHim, untouched])}
        `
        expect(Object.fromEntries(invitations.map((row) => [row.id, row.revoked]))).toEqual({
          [intoHis]: true,
          [byHim]: true,
          [untouched]: false,
        })
      },
    )

    await t.step("mails the day it goes to a proven address only, while it waits", async () => {
      const sent: EmailMessage[] = []
      const logged: string[] = []
      const job = accountDeletionMailJob({
        sql,
        sender: {
          send: (message: EmailMessage) => (
            sent.push(message),
              Promise.resolve({ ok: true, accepted: [message.to], duplicates: [] })
          ),
        } as unknown as EmailSender,
        brand: { webAppUrl: "https://app.example.com" },
        log: (line) => void logged.push(line),
      })
      const event = (id: string) => ({ aggregateId: id }) as OutboxEvent

      const ola = await signUp(app, "ola")
      await sql`INSERT INTO auth_email_owners (email, user_id) VALUES ('ola@example.com', ${ola.id})`
      await sql`UPDATE auth_keys SET proven_at = now() WHERE user_id = ${ola.id}`
      const proven = await requestDeletion(app, sql, ola)
      const pia = await signUp(app, "pia")
      const unproven = await requestDeletion(app, sql, pia)
      await job(event(proven.id))
      await job(event(unproven.id))

      expect(sent.map((mail) => mail.to)).toEqual(["ola@example.com"])
      expect(logged).toEqual([
        "warn: an account deletion mail was not sent: the account has no proven address",
      ])

      // Restored before the job ran: nothing is sent.
      expect((await signIn(app, "ola")).status).toBe(200)
      await job(event(proven.id))
      expect(sent).toHaveLength(1)
    })
  })
})
