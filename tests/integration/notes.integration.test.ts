/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { CommandBus, QueryBus } from "@spy4x/platform/cqrs"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { type Actor, UserMFAStatus } from "@domain/identity"
import { GroupRole } from "@domain/groups"
import {
  NoteCreateCommand,
  NoteDeleteCommand,
  NoteError,
  NoteGetQuery,
  type NoteListPageKey,
  NoteListQuery,
  NoteUpdateCommand,
  NoteVersionConflictError,
} from "@domain/notes"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { PostgresNoteRepository } from "@server/notes/postgres-note-repository.ts"
import { createIdempotencyMiddleware } from "@server/idempotency/idempotency.ts"
import { PostgresIdempotencyStore } from "@server/idempotency/postgres-idempotency-store.ts"
import { createSessionGate } from "../../apps/api/cqrs/session-gate.ts"
import {
  createNoteCreateHandler,
  createNoteDeleteHandler,
  createNoteGetHandler,
  createNoteListHandler,
  createNoteUpdateHandler,
  type NoteHandlerDependencies,
} from "../../apps/api/features/notes/handlers.ts"
import { requireDbConnection } from "./db-connection.ts"

/**
 * Notes against a real Postgres built from the migrations, through the same handlers, session gate
 * and idempotency middleware the API puts on its buses. Needs `DB_HOST`, `DB_USER`, `DB_PASS` and
 * `DB_NAME` (recipe in docs/handoff.md); it fails when they are missing rather than skipping.
 */

const MIGRATIONS_DIR = "libs/server/db/migrations"

interface IdRow extends postgres.Row {
  id: number
}

interface OutboxRow extends postgres.Row {
  eventKind: string
  aggregateType: string
  aggregateId: string
  aggregateVersion: string
}

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = requireDbConnection()
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `notes_test_${crypto.randomUUID().replaceAll("-", "")}`
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

async function insertUser(sql: postgres.Sql): Promise<number> {
  const rows = await sql<IdRow[]>`
    WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
    INSERT INTO users (id) SELECT id FROM auth_user RETURNING id
  `
  return rows[0].id
}

function actor(userId: number): Actor {
  return {
    userId,
    userMfa: UserMFAStatus.NOT_CONFIGURED,
    sessionSecondFactor: SecondFactorStatus.NotRequired,
  }
}

/** The API's buses, with the note handlers on real repositories. */
function buses(sql: postgres.Sql) {
  const groups = new PostgresGroupRepository(sql)
  const dependencies: NoteHandlerDependencies = {
    notes: new PostgresNoteRepository(sql),
    groups: {
      roleOf: async (groupId, userId) => (await groups.getForMember(groupId, userId))?.role ?? null,
    },
  }
  const commands = new CommandBus()
  commands.use(createSessionGate([]))
  commands.use(createIdempotencyMiddleware({ store: new PostgresIdempotencyStore(sql) }))
  commands.register(NoteCreateCommand, createNoteCreateHandler(dependencies))
  commands.register(NoteUpdateCommand, createNoteUpdateHandler(dependencies))
  commands.register(NoteDeleteCommand, createNoteDeleteHandler(dependencies))
  const queries = new QueryBus()
  queries.use(createSessionGate([]))
  queries.register(NoteListQuery, createNoteListHandler(dependencies))
  queries.register(NoteGetQuery, createNoteGetHandler(dependencies))
  return { commands, queries, groups }
}

/** A shared group owned by a new user, with a viewer, an editor and a stranger beside it. */
async function seedGroup(sql: postgres.Sql) {
  const { groups } = buses(sql)
  const owner = await insertUser(sql)
  const editor = await insertUser(sql)
  const viewer = await insertUser(sql)
  const stranger = await insertUser(sql)
  const groupId = crypto.randomUUID()
  await groups.createShared({ id: groupId, name: "Team" }, owner)
  await sql`
    INSERT INTO group_members (group_id, user_id, role, added_by_user_id) VALUES
      (${groupId}, ${editor}, ${GroupRole.EDITOR}, ${owner}),
      (${groupId}, ${viewer}, ${GroupRole.VIEWER}, ${owner})
  `
  return { groupId, owner, editor, viewer, stranger }
}

async function nextSequence(sql: postgres.Sql, groupId: string): Promise<string> {
  return (await sql<{ next: string }[]>`
    SELECT next_change_sequence::text AS next FROM groups WHERE id = ${groupId}
  `)[0].next
}

async function outbox(sql: postgres.Sql, groupId: string): Promise<OutboxRow[]> {
  return await sql<OutboxRow[]>`
    SELECT event_kind, aggregate_type, aggregate_id::text, aggregate_version::text
    FROM outbox_events WHERE group_id = ${groupId} AND event_kind LIKE 'note.%'
    ORDER BY aggregate_version
  `
}

/** Waits, for at most five seconds, until `count` statements wait on a row lock. */
async function waitForLockWaiters(sql: postgres.Sql, count: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const [{ waiting }] = await sql<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `
    if (waiting >= count) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Fewer than ${count} statements waited on the row lock within five seconds`)
}

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  return await promise.then(() => null, (error) => error)
}

Deno.test("notes against Postgres", async (t) => {
  await withSchema(async (sql) => {
    const { commands, queries } = buses(sql)

    await t.step(
      "every write moves the group's sequence once and writes its outbox row",
      async () => {
        const { groupId, editor } = await seedGroup(sql)
        const before = BigInt(await nextSequence(sql, groupId))
        const id = crypto.randomUUID()

        const created = await commands.execute(
          new NoteCreateCommand({ actor: actor(editor), groupId, id, title: "Plan", body: "a" }),
        )
        const updated = await commands.execute(
          new NoteUpdateCommand({
            actor: actor(editor),
            groupId,
            id,
            title: "Plan v2",
            body: "b",
            version: 1,
          }),
        )
        const deleted = await commands.execute(
          new NoteDeleteCommand({ actor: actor(editor), groupId, id, version: 2 }),
        )

        expect([created.note.version, updated.note.version, deleted.note.version]).toEqual([
          1,
          2,
          3,
        ])
        expect([
          created.note.changeSequence,
          updated.note.changeSequence,
          deleted.note.changeSequence,
        ])
          .toEqual([String(before), String(before + 1n), String(before + 2n)])
        expect(await nextSequence(sql, groupId)).toBe(String(before + 3n))
        expect(await outbox(sql, groupId)).toEqual([
          ["note.created", before],
          ["note.updated", before + 1n],
          ["note.deleted", before + 2n],
        ].map(([eventKind, version]) => ({
          eventKind,
          aggregateType: "group",
          aggregateId: groupId,
          aggregateVersion: String(version),
        })))
        expect(updated.note.updatedByUserId).toBe(editor)
      },
    )

    await t.step(
      "an update or delete with a stale version is refused with the current version",
      async () => {
        const { groupId, owner, editor } = await seedGroup(sql)
        const id = crypto.randomUUID()
        await commands.execute(
          new NoteCreateCommand({ actor: actor(owner), groupId, id, title: "Draft", body: "" }),
        )
        await commands.execute(
          new NoteUpdateCommand({
            actor: actor(owner),
            groupId,
            id,
            title: "Owner's edit",
            body: "",
            version: 1,
          }),
        )
        const sequence = await nextSequence(sql, groupId)

        const staleUpdate = await refusal(commands.execute(
          new NoteUpdateCommand({
            actor: actor(editor),
            groupId,
            id,
            title: "Editor's edit of version 1",
            body: "",
            version: 1,
          }),
        ))
        const staleDelete = await refusal(commands.execute(
          new NoteDeleteCommand({ actor: actor(editor), groupId, id, version: 1 }),
        ))

        for (const error of [staleUpdate, staleDelete]) {
          expect(error).toBeInstanceOf(NoteVersionConflictError)
          expect((error as NoteVersionConflictError).currentVersion).toBe(2)
        }
        const { note } = await queries.execute(
          new NoteGetQuery({ actor: actor(editor), groupId, id }),
        )
        expect([note.title, note.version]).toEqual(["Owner's edit", 2])
        expect(await nextSequence(sql, groupId)).toBe(sequence)
      },
    )

    await t.step(
      "a member of one group cannot read, update or delete another group's note",
      async () => {
        const x = await seedGroup(sql)
        const y = await seedGroup(sql)
        const id = crypto.randomUUID()
        await commands.execute(
          new NoteCreateCommand({
            actor: actor(x.owner),
            groupId: x.groupId,
            id,
            title: "X's",
            body: "",
          }),
        )
        const sequenceX = await nextSequence(sql, x.groupId)
        const sequenceY = await nextSequence(sql, y.groupId)

        // Y's owner passes the role check for Y, then names X's note.
        const asY = { actor: actor(y.owner), groupId: y.groupId, id }
        const refused = [
          await refusal(commands.execute(
            new NoteUpdateCommand({ ...asY, title: "Taken over", body: "", version: 1 }),
          )),
          await refusal(commands.execute(new NoteDeleteCommand({ ...asY, version: 1 }))),
          await refusal(queries.execute(new NoteGetQuery(asY))),
        ]

        for (const error of refused) {
          expect(error).toBeInstanceOf(NoteError)
          expect((error as NoteError).code).toBe("NOTE_NOT_FOUND")
        }
        const { note } = await queries.execute(
          new NoteGetQuery({ actor: actor(x.owner), groupId: x.groupId, id }),
        )
        expect([note.title, note.version]).toEqual(["X's", 1])
        expect(await nextSequence(sql, x.groupId)).toBe(sequenceX)
        expect(await nextSequence(sql, y.groupId)).toBe(sequenceY)
      },
    )

    await t.step(
      "of four concurrent updates at the same version, one wins and the others conflict",
      async () => {
        const { groupId, owner } = await seedGroup(sql)
        const id = crypto.randomUUID()
        await commands.execute(
          new NoteCreateCommand({ actor: actor(owner), groupId, id, title: "Start", body: "" }),
        )

        // A second connection holds the note's row lock, so all four updates are waiting on it
        // at once before any of them may write: the race is forced, not left to timing.
        const holder = await sql.reserve()
        let outcomes: PromiseSettledResult<unknown>[]
        try {
          await holder`BEGIN`
          await holder`SELECT id FROM notes WHERE id = ${id} FOR UPDATE`
          const racing = Promise.allSettled([1, 2, 3, 4].map((writer) =>
            commands.execute(
              new NoteUpdateCommand({
                actor: actor(owner),
                groupId,
                id,
                title: `Writer ${writer}`,
                body: "",
                version: 1,
              }),
            )
          ))
          await waitForLockWaiters(sql, 4)
          await holder`COMMIT`
          outcomes = await racing
        } finally {
          holder.release()
        }

        const won = outcomes.filter((outcome) => outcome.status === "fulfilled")
        const lost = outcomes.flatMap((outcome) =>
          outcome.status === "rejected" ? [outcome.reason] : []
        )
        expect(won.length).toBe(1)
        expect(lost.length).toBe(3)
        for (const error of lost) {
          expect(error).toBeInstanceOf(NoteVersionConflictError)
          expect((error as NoteVersionConflictError).currentVersion).toBe(2)
        }
        const { note } = await queries.execute(
          new NoteGetQuery({ actor: actor(owner), groupId, id }),
        )
        expect(note.version).toBe(2)
        expect((await outbox(sql, groupId)).map((row) => row.eventKind)).toEqual([
          "note.created",
          "note.updated",
        ])
      },
    )

    await t.step(
      "a failed outbox insert rolls back the note write and the sequence change",
      async () => {
        const { groupId, owner } = await seedGroup(sql)
        const id = crypto.randomUUID()
        await commands.execute(
          new NoteCreateCommand({ actor: actor(owner), groupId, id, title: "Kept", body: "" }),
        )
        const sequence = await nextSequence(sql, groupId)

        // Only this test's schema gets the constraint, and only for this step. NOT VALID leaves the
        // rows earlier steps wrote alone and checks only new ones.
        await sql`
          ALTER TABLE outbox_events
          ADD CONSTRAINT test_refuse_note_updates CHECK (event_kind <> 'note.updated') NOT VALID
        `
        let failure: unknown
        try {
          failure = await refusal(commands.execute(
            new NoteUpdateCommand({
              actor: actor(owner),
              groupId,
              id,
              title: "Lost",
              body: "",
              version: 1,
            }),
          ))
        } finally {
          await sql`ALTER TABLE outbox_events DROP CONSTRAINT test_refuse_note_updates`
        }

        expect(String(failure)).toContain("test_refuse_note_updates")
        expect(await nextSequence(sql, groupId)).toBe(sequence)
        expect((await outbox(sql, groupId)).map((row) => row.eventKind)).toEqual(["note.created"])
        const { note } = await queries.execute(
          new NoteGetQuery({ actor: actor(owner), groupId, id }),
        )
        expect([note.title, note.version]).toEqual(["Kept", 1])
      },
    )

    await t.step("a viewer reads the notes but cannot create, update or delete one", async () => {
      const { groupId, owner, viewer } = await seedGroup(sql)
      const id = crypto.randomUUID()
      await commands.execute(
        new NoteCreateCommand({ actor: actor(owner), groupId, id, title: "Read me", body: "" }),
      )
      const sequence = await nextSequence(sql, groupId)

      const listed = await queries.execute(
        new NoteListQuery({ actor: actor(viewer), groupId, page: { limit: 10 } }),
      )
      expect(listed.notes.map((note) => note.title)).toEqual(["Read me"])
      const refusals = [
        await refusal(commands.execute(
          new NoteCreateCommand({
            actor: actor(viewer),
            groupId,
            id: crypto.randomUUID(),
            title: "Mine",
            body: "",
          }),
        )),
        await refusal(commands.execute(
          new NoteUpdateCommand({
            actor: actor(viewer),
            groupId,
            id,
            title: "Changed",
            body: "",
            version: 1,
          }),
        )),
        await refusal(commands.execute(
          new NoteDeleteCommand({ actor: actor(viewer), groupId, id, version: 1 }),
        )),
      ]

      expect(refusals.map((error) => (error as NoteError).code)).toEqual([
        "ROLE_INSUFFICIENT",
        "ROLE_INSUFFICIENT",
        "ROLE_INSUFFICIENT",
      ])
      expect(await nextSequence(sql, groupId)).toBe(sequence)
      const { note } = await queries.execute(
        new NoteGetQuery({ actor: actor(viewer), groupId, id }),
      )
      expect([note.title, note.version]).toEqual(["Read me", 1])
    })

    await t.step("someone outside the group is told it does not exist", async () => {
      const { groupId, stranger } = await seedGroup(sql)

      const read = await refusal(queries.execute(
        new NoteListQuery({ actor: actor(stranger), groupId, page: { limit: 10 } }),
      ))
      const write = await refusal(commands.execute(
        new NoteCreateCommand({
          actor: actor(stranger),
          groupId,
          id: crypto.randomUUID(),
          title: "x",
          body: "",
        }),
      ))

      expect([(read as NoteError).code, (write as NoteError).code]).toEqual([
        "GROUP_NOT_FOUND",
        "GROUP_NOT_FOUND",
      ])
    })

    await t.step(
      "a create retried with the same idempotency key answers the first result without writing",
      async () => {
        const { groupId, editor } = await seedGroup(sql)
        const command = new NoteCreateCommand({
          actor: actor(editor),
          groupId,
          id: crypto.randomUUID(),
          title: "Once",
          body: "",
          idempotencyKey: "note-create-1",
        })

        const first = await commands.execute(command)
        const replay = await commands.execute(new NoteCreateCommand({ ...command.data }))

        // The stored result is JSON, so a replay reads `created: true` like the first answer.
        expect(replay).toEqual(JSON.parse(JSON.stringify(first)))
        expect((await outbox(sql, groupId)).length).toBe(1)
      },
    )

    await t.step(
      "a create retried without a key returns the note it made and records nothing more",
      async () => {
        const { groupId, editor } = await seedGroup(sql)
        const command = () =>
          new NoteCreateCommand({
            actor: actor(editor),
            groupId,
            id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d11a001",
            title: "Once",
            body: "",
          })

        const first = await commands.execute(command())
        const retry = await commands.execute(command())

        expect([first.created, retry.created]).toEqual([true, false])
        expect(retry.note.id).toBe(first.note.id)
        expect((await outbox(sql, groupId)).length).toBe(1)
      },
    )

    await t.step("the list pages newest first by cursor and leaves deleted notes out", async () => {
      const { groupId, owner } = await seedGroup(sql)
      const notes = new PostgresNoteRepository(sql)
      const ids: string[] = []
      for (const title of ["one", "two", "three"]) {
        const { note } = await notes.create(
          { groupId, id: crypto.randomUUID(), title, body: "" },
          owner,
        )
        ids.push(note.id)
        // updated_at is the transaction's start; keep the three apart.
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      await notes.delete({ groupId, id: ids[1], expectedVersion: 1 }, owner)

      const first = await notes.list(groupId, { limit: 1 })
      const second = await notes.list(groupId, { limit: 1, after: first.nextPageKey! })

      expect(first.notes.map((note) => note.title)).toEqual(["three"])
      expect(second.notes.map((note) => note.title)).toEqual(["one"])
      expect(second.nextPageKey).toBe(null)
    })

    await t.step(
      "the list pages through notes written in the same millisecond, each once",
      async () => {
        const { groupId, owner } = await seedGroup(sql)
        const notes = new PostgresNoteRepository(sql)
        const ids: string[] = []
        for (const title of ["a", "b", "c"]) {
          const { note } = await notes.create(
            { groupId, id: crypto.randomUUID(), title, body: "" },
            owner,
          )
          ids.push(note.id)
        }
        // Three writes ten microseconds apart, inside one millisecond. The times are built in SQL:
        // postgres.js would send a timestamp parameter through a Date, which drops the microseconds.
        for (const [index, id] of ids.entries()) {
          await sql`
            UPDATE notes
            SET updated_at = TIMESTAMPTZ '2026-10-02 12:00:00.12345+00'
              - make_interval(secs => ${index * 10} / 1000000.0)
            WHERE id = ${id}
          `
        }

        const seen: string[] = []
        let after: NoteListPageKey | undefined
        for (let page = 0; page < 5; page++) {
          const result = await notes.list(groupId, after ? { limit: 1, after } : { limit: 1 })
          seen.push(...result.notes.map((note) => note.id))
          if (!result.nextPageKey) break
          after = result.nextPageKey
        }

        expect(seen.toSorted()).toEqual(ids.toSorted())
      },
    )
  })
})
