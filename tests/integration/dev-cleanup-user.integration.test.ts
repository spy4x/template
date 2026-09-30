/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import postgres from "postgres"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn, type SignIn } from "../../apps/api/services/sign-in.ts"
import { createDevRoute } from "../../apps/api/routes/dev.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { requireDbConnection } from "./db-connection.ts"

/**
 * The development-only `POST /test/cleanup-user` against a real Postgres, for users made through
 * the same `signIn.signUp` that `POST /api/auth/password/sign-up` runs.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

const MIGRATIONS_DIR = "libs/server/db/migrations"
// Test-only secrets, long enough for the package's 32-character minimum.
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"
const PASSWORD = "Passw0rd!"

interface IdRow extends postgres.Row {
  id: number
}

interface GroupIdRow extends postgres.Row {
  id: string
}

interface CountRow extends postgres.Row {
  count: number
}

/** Runs `body` against a fresh schema with every migration applied, and drops the schema after. */
async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = requireDbConnection()
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `dev_cleanup_test_${crypto.randomUUID().replaceAll("-", "")}`
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

/** A test app with the API's sign-up handler and the dev route, as the API mounts it. */
function buildApp(sql: postgres.Sql, isDev: boolean) {
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
    const { username, password } = await c.req.json()
    const result = await signIn.signUp(c, username, password)
    return result ? c.json(result.user) : c.json({ error: "refused" }, 401)
  })
  app.route("/test", createDevRoute({ isDev, db, sql }))
  const post = (path: string, body: unknown) =>
    app.request(`http://local${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  return { db, post }
}

async function signUp(app: ReturnType<typeof buildApp>, username: string): Promise<number> {
  const response = await app.post("/sign-up", { username, password: PASSWORD })
  expect(response.status).toBe(200)
  return ((await response.json()) as { id: number }).id
}

/** How many rows in each table still point at `userId`, keyed by table. */
async function rowsOf(sql: postgres.Sql, userId: number): Promise<Record<string, number>> {
  const rows = await sql<(CountRow & { name: string })[]>`
    SELECT 'auth_users' AS name, COUNT(*)::int AS count FROM auth_users WHERE id = ${userId}
    UNION ALL SELECT 'users', COUNT(*)::int FROM users WHERE id = ${userId}
    UNION ALL SELECT 'groups', COUNT(*)::int FROM groups
      WHERE owner_user_id = ${userId} OR created_by_user_id = ${userId}
    UNION ALL SELECT 'group_members', COUNT(*)::int FROM group_members
      WHERE user_id = ${userId} OR added_by_user_id = ${userId}
    UNION ALL SELECT 'audit_events', COUNT(*)::int FROM audit_events
      WHERE actor_user_id = ${userId}
    UNION ALL SELECT 'outbox_events', COUNT(*)::int FROM outbox_events
      WHERE actor_user_id = ${userId}
  `
  return Object.fromEntries(rows.map((row) => [row.name, row.count]))
}

const NONE = {
  auth_users: 0,
  users: 0,
  groups: 0,
  group_members: 0,
  audit_events: 0,
  outbox_events: 0,
}

Deno.test("dev cleanup-user route", async (t) => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, true)

    await t.step("deletes a signed-up user with their personal group", async () => {
      const userId = await signUp(app, "personal-only")
      const personal = await sql<
        GroupIdRow[]
      >`SELECT id FROM groups WHERE owner_user_id = ${userId}`
      expect(personal.length).toBe(1)

      const response = await app.post("/test/cleanup-user", { username: "personal-only" })

      expect(response.status).toBe(200)
      expect(await rowsOf(sql, userId)).toEqual(NONE)
      const left = await sql<CountRow[]>`
        SELECT COUNT(*)::int AS count FROM groups WHERE id = ${personal[0].id}
      `
      expect(left[0].count).toBe(0)
    })

    await t.step("deletes the shared groups the user created, with their events", async () => {
      const userId = await signUp(app, "shared-owner")
      await app.db.group.createShared({ id: crypto.randomUUID(), name: "Team" }, userId)
      // One event for the personal group made at sign-up, one for the shared group.
      expect((await rowsOf(sql, userId)).outbox_events).toBe(2)

      const response = await app.post("/test/cleanup-user", { username: "shared-owner" })

      expect(response.status).toBe(200)
      expect(await rowsOf(sql, userId)).toEqual(NONE)
    })

    await t.step(
      "removes the user's traces from other users' groups and keeps those groups",
      async () => {
        const ownerId = await signUp(app, "bystander-owner")
        const memberId = await signUp(app, "bystander-member")
        const leaverId = await signUp(app, "leaver")
        const bystanderGroup = (
          await sql<GroupIdRow[]>`SELECT id FROM groups WHERE owner_user_id = ${ownerId}`
        )[0].id
        await sql`
        INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
        VALUES (${bystanderGroup}, ${memberId}, 1, ${leaverId})
      `
        await sql`
        INSERT INTO audit_events (event_kind, actor_user_id, group_id)
        VALUES ('group.member_added', ${leaverId}, ${bystanderGroup})
      `

        const response = await app.post("/test/cleanup-user", { username: "leaver" })

        expect(response.status).toBe(200)
        expect(await rowsOf(sql, leaverId)).toEqual(NONE)
        const owner = await rowsOf(sql, ownerId)
        expect([owner.auth_users, owner.users, owner.groups, owner.group_members]).toEqual([
          1,
          1,
          1,
          1,
        ])
        expect((await rowsOf(sql, memberId)).users).toBe(1)
      },
    )

    await t.step("answers 200 for a username that has no user", async () => {
      const response = await app.post("/test/cleanup-user", { username: "never-signed-up" })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ success: true })
    })

    await t.step("refuses with 403 and deletes nothing outside development", async () => {
      const userId = await signUp(app, "kept-in-prod")

      const response = await buildApp(sql, false).post("/test/cleanup-user", {
        username: "kept-in-prod",
      })

      expect(response.status).toBe(403)
      const rows = await sql<IdRow[]>`SELECT id FROM auth_users WHERE id = ${userId}`
      expect(rows.length).toBe(1)
    })
  })
})
