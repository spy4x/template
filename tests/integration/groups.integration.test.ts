/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { GroupError, GroupKind, GroupRole } from "@domain/groups"
import {
  PasswordSignupStep,
  PasswordSignupStore,
  PasswordSignupTransaction,
  persistPasswordSignup,
} from "../../apps/api/services/auth/password-signup.ts"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { SessionMFAStatus, User, UserKey, UserSession, UserSessionStatus } from "@domain/identity"
const REQUIRED_DB_ENV = ["DB_HOST", "DB_USER", "DB_PASS", "DB_NAME"]
const hasDatabase = REQUIRED_DB_ENV.every((name) => Boolean(Deno.env.get(name)))

interface IdRow extends postgres.Row {
  id: number
}

interface CountRow extends postgres.Row {
  count: number
}

interface MetadataRow extends postgres.Row {
  value: string
}

interface IntegrationSignupTransaction extends PasswordSignupTransaction {
  sql: postgres.TransactionSql
}

Deno.test({
  name: "group core Postgres integration",
  ignore: !hasDatabase,
  async fn(t) {
    const connection = {
      host: Deno.env.get("DB_HOST")!,
      port: Number(Deno.env.get("DB_PORT") || "5432"),
      user: Deno.env.get("DB_USER")!,
      pass: Deno.env.get("DB_PASS")!,
      db: Deno.env.get("DB_NAME")!,
    }
    const admin = postgres({ ...connection, max: 1 })
    const schema = `groups_test_${crypto.randomUUID().replace(/-/g, "")}`
    const snapshotSchema = `${schema}_snapshot`
    const sql = postgres({
      ...connection,
      max: 20,
      transform: postgres.camel,
      connection: { options: `-c search_path=${schema}` },
    })
    const snapshotSql = postgres({
      ...connection,
      max: 1,
      transform: postgres.camel,
      connection: { options: `-c search_path=${snapshotSchema}` },
    })

    try {
      await admin`CREATE SCHEMA ${admin(schema)}`
      await admin`CREATE SCHEMA ${admin(snapshotSchema)}`
      await applyMigration(sql, "2026_01_26_0001_init.sql")
      await applyMigration(sql, "2026_01_26_0002_auth_profiles_audit.sql")
      await applyMigration(sql, "2026_01_27_0001_drop_user_profiles.sql")

      const activeUserOne =
        (await sql<IdRow[]>`INSERT INTO users DEFAULT VALUES RETURNING id`)[0].id
      const activeUserTwo =
        (await sql<IdRow[]>`INSERT INTO users DEFAULT VALUES RETURNING id`)[0].id
      await sql`INSERT INTO users (deleted_at) VALUES (NOW())`

      await applyMigration(sql, "2026_08_18_0001_group_core.sql")
      await applyMigration(sql, "2026_08_18_0002_personal_group_backfill.sql")

      await t.step("backfill is rerunnable and covers only active users", async () => {
        await applyMigration(sql, "2026_08_18_0002_personal_group_backfill.sql")
        const counts = await sql<CountRow[]>`
          SELECT COUNT(*)::int AS count
          FROM groups
          INNER JOIN group_members
            ON group_members.group_id = groups.id
           AND group_members.user_id = groups.owner_user_id
           AND group_members.role = ${GroupRole.OWNER}
          WHERE groups.kind = ${GroupKind.PERSONAL}
        `
        expect(counts[0].count).toBe(2)

        const invalid = await sql<CountRow[]>`
          SELECT COUNT(*)::int AS count
          FROM groups
          INNER JOIN users ON users.id = groups.owner_user_id
          WHERE groups.kind = ${GroupKind.PERSONAL}
            AND users.deleted_at IS NOT NULL
        `
        expect(invalid[0].count).toBe(0)
      })

      await t.step(
        "schema snapshot matches tables, functions, and trigger definitions",
        async () => {
          await snapshotSql.unsafe(await Deno.readTextFile("libs/server/db/schema.sql"))
          expect(await groupMetadata(sql, schema)).toEqual(
            await groupMetadata(snapshotSql, snapshotSchema),
          )
        },
      )

      await t.step("actual signup rolls back after every persisted step", async () => {
        const store = createSignupStore(sql)
        const steps: PasswordSignupStep[] = ["user", "key", "personal-group", "session"]
        for (const step of steps) {
          // Short prefix keeps total ≤ 50 chars (validator limit): "rb-<step>-<8chars>" = max ~30
          const username = `rb-${step}-${crypto.randomUUID().slice(0, 8)}`
          const before = await signupRowCounts(sql)
          await expect(persistPasswordSignup(
            store,
            { username, passwordHash: "hash", personalGroupId: crypto.randomUUID() },
            createIntegrationSession,
            (completedStep) => {
              if (completedStep === step) {
                throw new Error(`fail after ${step}`)
              }
            },
          )).rejects.toThrow(`fail after ${step}`)
          expect(await signupRowCounts(sql)).toEqual(before)
        }
      })

      await t.step("20 concurrent normalized signups create one complete account", async () => {
        const store = createSignupStore(sql)
        const gate = deferred<void>()
        const requests = Array.from({ length: 20 }, async (_, index) => {
          await gate.promise
          return await persistPasswordSignup(
            store,
            {
              username: index % 2 ? "  ConcurrentUser  " : "concurrentuser",
              passwordHash: "hash",
              personalGroupId: crypto.randomUUID(),
            },
            createIntegrationSession,
          )
        })
        gate.resolve()
        const results = await Promise.all(requests)
        expect(results.filter(Boolean).length).toBe(1)

        const counts = await sql<CountRow[]>`
          SELECT (
            SELECT COUNT(*)
            FROM users
            INNER JOIN user_keys ON user_keys.user_id = users.id
            WHERE user_keys.kind = 1 AND user_keys.identification = 'concurrentuser'
          )::int AS count
          UNION ALL
          SELECT COUNT(*)::int
          FROM user_keys
          WHERE kind = 1 AND identification = 'concurrentuser'
          UNION ALL
          SELECT COUNT(*)::int
          FROM groups
          INNER JOIN user_keys ON user_keys.user_id = groups.owner_user_id
          WHERE groups.kind = 1 AND user_keys.identification = 'concurrentuser'
          UNION ALL
          SELECT COUNT(*)::int
          FROM group_members
          INNER JOIN user_keys ON user_keys.user_id = group_members.user_id
          WHERE group_members.role = 4 AND user_keys.identification = 'concurrentuser'
          UNION ALL
          SELECT COUNT(*)::int
          FROM user_sessions
          INNER JOIN user_keys ON user_keys.id = user_sessions.key_id
          WHERE user_keys.identification = 'concurrentuser'
        `
        expect(counts.map((row: CountRow) => row.count)).toEqual([1, 1, 1, 1, 1])
      })

      await t.step("existing authenticated user self-heals a personal group", async () => {
        const userId = (await sql<IdRow[]>`INSERT INTO users DEFAULT VALUES RETURNING id`)[0].id
        const repository = new PostgresGroupRepository(sql)
        const personal = await repository.ensurePersonal(
          { id: crypto.randomUUID(), name: "Personal" },
          userId,
        )
        const retry = await repository.ensurePersonal(
          { id: crypto.randomUUID(), name: "Personal" },
          userId,
        )
        expect(personal.id).toBe(retry.id)
      })

      await t.step("concurrent exact shared create emits audit and outbox once", async () => {
        const repository = new PostgresGroupRepository(sql)
        const groupId = crypto.randomUUID()
        const gate = deferred<void>()
        const requests = Array.from({ length: 20 }, async () => {
          await gate.promise
          return await repository.createShared(
            { id: groupId, name: "Concurrent team", requestId: "request-exact" },
            activeUserOne,
          )
        })
        gate.resolve()
        const results = await Promise.all(requests)
        expect(results.filter((result) => result.created).length).toBe(1)
        expect(results.every((result) => result.group.id === groupId)).toBe(true)
        expect(await eventCounts(sql, groupId)).toEqual([1, 1])
      })

      await t.step(
        "concurrent changed intent yields one winner without duplicate effects",
        async () => {
          const repository = new PostgresGroupRepository(sql)
          const groupId = crypto.randomUUID()
          const gate = deferred<void>()
          const requests = Array.from({ length: 20 }, async (_, index) => {
            await gate.promise
            try {
              return await repository.createShared(
                { id: groupId, name: index % 2 ? "Intent A" : "Intent B" },
                activeUserOne,
              )
            } catch (error) {
              expect(error).toBeInstanceOf(GroupError)
              return null
            }
          })
          gate.resolve()
          const results = await Promise.all(requests)
          expect(results.filter((result) => result?.created).length).toBe(1)
          expect(results.filter(Boolean).length).toBe(10)
          expect(await eventCounts(sql, groupId)).toEqual([1, 1])
        },
      )

      await t.step("list is bounded, keyset-paged, and cross-user isolated", async () => {
        const repository = new PostgresGroupRepository(sql)
        await sql.begin(async (transaction: postgres.TransactionSql) => {
          for (let index = 0; index < 55; index += 1) {
            const groupId = crypto.randomUUID()
            await transaction`
              INSERT INTO groups (id, kind, name, owner_user_id, created_by_user_id)
              VALUES (${groupId}, 2, ${`Page ${index}`}, ${activeUserOne}, ${activeUserOne})
            `
            await transaction`
              INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
              VALUES (${groupId}, ${activeUserOne}, 4, ${activeUserOne})
            `
          }
        })

        const first = await repository.listForUser(activeUserOne, { limit: 50 })
        expect(first.groups.length).toBe(50)
        expect(first.nextPageKey).not.toBe(null)
        const second = await repository.listForUser(activeUserOne, {
          limit: 50,
          after: first.nextPageKey!,
        })
        const ids = [...first.groups, ...second.groups].map((group) => group.id)
        expect(new Set(ids).size).toBe(ids.length)
        expect((await repository.listForUser(activeUserTwo, { limit: 100 })).groups.length).toBe(1)
      })

      await t.step("shared creation rejects soft-deleted actors", async () => {
        const actor = (await sql<IdRow[]>`
          INSERT INTO users (deleted_at) VALUES (NOW()) RETURNING id
        `)[0].id
        const groupId = crypto.randomUUID()
        await expect(new PostgresGroupRepository(sql).createShared(
          { id: groupId, name: "Denied" },
          actor,
        )).rejects.toThrow(GroupError)
        expect(
          (await sql<CountRow[]>`
          SELECT COUNT(*)::int AS count FROM groups WHERE id = ${groupId}
        `)[0].count,
        ).toBe(0)
      })
    } finally {
      await sql.end({ timeout: 1 })
      await snapshotSql.end({ timeout: 1 })
      await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
      await admin`DROP SCHEMA IF EXISTS ${admin(snapshotSchema)} CASCADE`
      await admin.end({ timeout: 1 })
    }
  },
})

function createSignupStore(
  sql: postgres.Sql,
): PasswordSignupStore<IntegrationSignupTransaction> {
  return {
    begin: (fn) =>
      sql.begin(async (transaction: postgres.TransactionSql) => {
        const signupTransaction: IntegrationSignupTransaction = {
          sql: transaction,
          user: {
            createOne: async ({ data }) => {
              return (await transaction<User[]>`
                INSERT INTO users (first_name, last_name, role, mfa, last_login_at)
                VALUES (
                  ${data.firstName},
                  ${data.lastName},
                  ${data.role},
                  ${data.mfa},
                  ${data.lastLoginAt}
                )
                RETURNING *
              `)[0]
            },
          },
          userKey: {
            findOne: async ({ kind, identification }) => {
              const key = (await transaction<UserKey[]>`
                SELECT * FROM user_keys
                WHERE kind = ${kind} AND identification = ${identification}
                LIMIT 1
              `)[0]
              return key ? { ...key, deletedAt: null } : null
            },
            createOne: async ({ userId, kind, identification, secret }) => {
              const key = (await transaction<UserKey[]>`
                INSERT INTO user_keys (user_id, kind, identification, secret)
                VALUES (${userId}, ${kind}, ${identification}, ${secret})
                RETURNING *
              `)[0]
              return { ...key, deletedAt: null }
            },
          },
          group: new PostgresGroupRepository(transaction),
        }
        return await fn(signupTransaction)
      }),
  }
}

async function createIntegrationSession(
  session: { userId: number; keyId: number; mfa: SessionMFAStatus },
  transaction: IntegrationSignupTransaction,
): Promise<UserSession> {
  return (await transaction.sql<UserSession[]>`
    INSERT INTO user_sessions (token, user_id, key_id, expires_at, mfa, status)
    VALUES (
      ${crypto.randomUUID()},
      ${session.userId},
      ${session.keyId},
      NOW() + INTERVAL '1 day',
      ${session.mfa},
      ${UserSessionStatus.ACTIVE}
    )
    RETURNING *
  `)[0]
}

async function signupRowCounts(sql: postgres.Sql): Promise<number[]> {
  const rows = await sql<CountRow[]>`
    SELECT COUNT(*)::int AS count FROM users
    UNION ALL SELECT COUNT(*)::int FROM user_keys
    UNION ALL SELECT COUNT(*)::int FROM groups
    UNION ALL SELECT COUNT(*)::int FROM group_members
    UNION ALL SELECT COUNT(*)::int FROM user_sessions
  `
  return rows.map((row: CountRow) => row.count)
}

async function eventCounts(sql: postgres.Sql, groupId: string): Promise<number[]> {
  const rows = await sql<CountRow[]>`
    SELECT COUNT(*)::int AS count FROM audit_events WHERE group_id = ${groupId}
    UNION ALL
    SELECT COUNT(*)::int FROM outbox_events WHERE group_id = ${groupId}
  `
  return rows.map((row: CountRow) => row.count)
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve: () => resolve(undefined as T) }
}

async function applyMigration(sql: postgres.Sql, name: string): Promise<void> {
  const source = await Deno.readTextFile(`libs/server/db/migrations/${name}`)
  await sql.unsafe(source)
}

async function groupMetadata(sql: postgres.Sql, schema: string): Promise<string[]> {
  const rows = await sql<MetadataRow[]>`
    SELECT value
    FROM (
      SELECT
        'column|' || table_name || '|' || ordinal_position || '|' || column_name || '|' ||
        data_type || '|' || is_nullable || '|' || COALESCE(column_default, '') AS value
      FROM information_schema.columns
      WHERE table_schema = ${schema}
        AND table_name IN ('groups', 'group_members', 'audit_events', 'outbox_events')

      UNION ALL

      SELECT
        'constraint|' || tables.relname || '|' || constraints.conname || '|' ||
        pg_get_constraintdef(constraints.oid) AS value
      FROM pg_constraint constraints
      INNER JOIN pg_class tables ON tables.oid = constraints.conrelid
      INNER JOIN pg_namespace namespaces ON namespaces.oid = tables.relnamespace
      WHERE namespaces.nspname = ${schema}
        AND tables.relname IN ('groups', 'group_members', 'audit_events', 'outbox_events')

      UNION ALL

      SELECT
        'index|' || tablename || '|' || indexname || '|' ||
        replace(indexdef, ${schema}, '<schema>') AS value
      FROM pg_indexes
      WHERE schemaname = ${schema}
        AND tablename IN (
          'user_keys',
          'groups',
          'group_members',
          'audit_events',
          'outbox_events'
        )

      UNION ALL

      SELECT
        'trigger|' || tables.relname || '|' || triggers.tgname || '|' ||
        replace(pg_get_triggerdef(triggers.oid), ${schema}, '<schema>') AS value
      FROM pg_trigger triggers
      INNER JOIN pg_class tables ON tables.oid = triggers.tgrelid
      INNER JOIN pg_namespace namespaces ON namespaces.oid = tables.relnamespace
      WHERE namespaces.nspname = ${schema}
        AND tables.relname IN ('groups', 'group_members')
        AND NOT triggers.tgisinternal

      UNION ALL

      SELECT
        'function|' || procedures.proname || '|' ||
        replace(pg_get_functiondef(procedures.oid), ${schema}, '<schema>') AS value
      FROM pg_proc procedures
      INNER JOIN pg_namespace namespaces ON namespaces.oid = procedures.pronamespace
      WHERE namespaces.nspname = ${schema}
        AND procedures.proname IN (
          'assert_personal_group_membership',
          'check_personal_group_membership_trigger'
        )
    ) metadata
    ORDER BY value
  `
  return rows.map((row: MetadataRow) => row.value)
}
