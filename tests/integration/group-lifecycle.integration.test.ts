/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { GroupRole } from "@domain/groups"
import { NoteError } from "@domain/notes"
import { GroupNotActiveError, recordGroupChange } from "@server/groups/group-change-log.ts"
import { PostgresNoteRepository } from "@server/notes/postgres-note-repository.ts"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { purgeDeletedGroups } from "@server/groups/purge-deleted-groups.ts"
import { requireDbConnection } from "./db-connection.ts"

/**
 * Rename, delete and restore of a group against a real Postgres built from schema.sql: who may do
 * what, the rule that a person keeps one group, what members see, the 30 days and the purge. Needs
 * "DB_HOST", "DB_USER", "DB_PASS" and "DB_NAME" (recipe in docs/handoff.md); it fails when they
 * are missing.
 */

interface IdRow extends postgres.Row {
  id: number
}

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const connection = requireDbConnection()
  const admin = postgres({ ...connection, max: 1, onnotice: () => {} })
  const schema = `lifecycle_test_${crypto.randomUUID().replaceAll("-", "")}`
  const sql = postgres({
    ...connection,
    max: 10,
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

/**
 * An owner with a first group and a team group, plus one member per role in the team and a
 * stranger. The members have a group of their own, except "onlyHere", whose only group is the team.
 */
async function team(sql: postgres.Sql) {
  const repository = new PostgresGroupRepository(sql)
  const owner = await insertUser(sql)
  await repository.ensureFirst({ id: crypto.randomUUID(), name: "Home" }, owner)
  const created = await repository.create({ id: crypto.randomUUID(), name: "Team" }, owner)
  const groupId = created.group.id
  const admin = await insertUser(sql)
  const editor = await insertUser(sql)
  const viewer = await insertUser(sql)
  const onlyHere = await insertUser(sql)
  const stranger = await insertUser(sql)
  for (const user of [admin, editor, viewer, stranger]) {
    await repository.ensureFirst({ id: crypto.randomUUID(), name: "Own" }, user)
  }
  await sql`
    INSERT INTO group_members (group_id, user_id, role, added_by_user_id) VALUES
      (${groupId}, ${admin}, ${GroupRole.ADMIN}, ${owner}),
      (${groupId}, ${editor}, ${GroupRole.EDITOR}, ${owner}),
      (${groupId}, ${viewer}, ${GroupRole.VIEWER}, ${owner}),
      (${groupId}, ${onlyHere}, ${GroupRole.EDITOR}, ${owner})
  `
  return { repository, groupId, owner, admin, editor, viewer, onlyHere, stranger }
}

async function expireDeletion(sql: postgres.Sql, groupId: string, days: number): Promise<void> {
  await sql`
    UPDATE groups SET deleted_at = now() - make_interval(days => ${days}) WHERE id = ${groupId}
  `
}

Deno.test("rename: only an admin or the owner changes the name", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, admin, editor, viewer, stranger } = await team(sql)

    for (const [who, name] of [[viewer, "v"], [editor, "e"], [stranger, "s"]] as const) {
      expect(await repository.rename(groupId, name, who)).toBeNull()
    }
    expect((await repository.getSummaryForMember(groupId, owner))?.name).toBe("Team")

    const byAdmin = await repository.rename(groupId, "By admin", admin)
    expect(byAdmin?.name).toBe("By admin")
    const byOwner = await repository.rename(groupId, "By owner", owner)
    expect(byOwner?.name).toBe("By owner")
    expect(byOwner!.changeSequence > byAdmin!.changeSequence).toBe(true)
  })
})

Deno.test("delete: only the owner deletes, and a refused attempt changes nothing", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, admin, editor, viewer, stranger } = await team(sql)

    for (const who of [admin, editor, viewer, stranger]) {
      expect(await repository.softDelete(groupId, who)).toBeNull()
    }
    expect((await repository.getSummaryForMember(groupId, owner))?.name).toBe("Team")

    const deleted = await repository.softDelete(groupId, owner)
    expect(deleted?.id).toBe(groupId)
    expect(await repository.getForMember(groupId, owner)).toBeNull()
  })
})

Deno.test("delete: the server refuses to delete the last group of the person", async () => {
  await withSchema(async (sql) => {
    const repository = new PostgresGroupRepository(sql)
    const owner = await insertUser(sql)
    const only = crypto.randomUUID()
    await repository.ensureFirst({ id: only, name: "Only" }, owner)

    await expect(repository.softDelete(only, owner)).rejects.toMatchObject({
      code: "LAST_GROUP",
    })
    expect((await repository.getSummaryForMember(only, owner))?.name).toBe("Only")
    const marked = await sql`SELECT 1 FROM groups WHERE id = ${only} AND deleted_at IS NOT NULL`
    expect(marked.length).toBe(0)
  })
})

Deno.test("delete: a member whose only group it was gets a new one, others keep theirs", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, editor, onlyHere } = await team(sql)

    await repository.softDelete(groupId, owner)

    const stranded = (await repository.listForUser(onlyHere, { limit: 10 })).groups
    expect(stranded.map((group) => group.name)).toEqual(["Personal"])
    const own = (await repository.listForUser(editor, { limit: 10 })).groups
    expect(own.map((group) => group.name)).toEqual(["Own"])
  })
})

Deno.test("delete: nobody keeps the deleted group selected", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, editor, onlyHere } = await team(sql)
    for (const user of [owner, editor, onlyHere]) {
      expect(await repository.select(user, groupId)).not.toBeNull()
    }

    await repository.softDelete(groupId, owner)

    for (const user of [owner, editor, onlyHere]) {
      const selected = await repository.getSelected(user)
      expect(selected.groupId).not.toBeNull()
      expect(selected.groupId).not.toBe(groupId)
    }
    expect(await repository.select(editor, groupId)).toBeNull()
  })
})

Deno.test("delete: members of the deleted group still get its change hint", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, admin, editor, viewer, onlyHere } = await team(sql)

    await repository.softDelete(groupId, owner)

    expect(await repository.listMemberUserIds(groupId)).toEqual(
      [owner, admin, editor, viewer, onlyHere].sort((a, b) => a - b),
    )
  })
})

Deno.test("restore: only the owner restores, and only inside 30 days", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, admin, editor, stranger } = await team(sql)
    await repository.softDelete(groupId, owner)

    expect((await repository.listRestorable(owner)).map((group) => group.id)).toEqual([groupId])
    for (const who of [admin, editor, stranger]) {
      expect(await repository.listRestorable(who)).toEqual([])
      expect(await repository.restore(groupId, who)).toBeNull()
    }

    await expireDeletion(sql, groupId, 31)
    expect(await repository.restore(groupId, owner)).toBeNull()
    expect(await repository.listRestorable(owner)).toEqual([])

    await expireDeletion(sql, groupId, 29)
    const restored = await repository.restore(groupId, owner)
    expect(restored?.name).toBe("Team")
    expect((await repository.getSummaryForMember(groupId, editor))?.name).toBe("Team")
    expect(await repository.listRestorable(owner)).toEqual([])
  })
})

Deno.test("purge: removes groups deleted over 30 days ago with everything in them", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, editor } = await team(sql)
    const kept = (await repository.create({ id: crypto.randomUUID(), name: "Recent" }, owner)).group
    await sql`
      INSERT INTO notes (id, group_id, title, body, change_sequence, created_by_user_id, updated_by_user_id)
      VALUES (${crypto.randomUUID()}, ${groupId}, 't', 'b', 1, ${owner}, ${owner})
    `
    await sql`
      INSERT INTO audit_events (event_kind, actor_user_id, group_id)
      VALUES ('group.created', ${owner}, ${groupId})
    `
    await repository.select(editor, groupId)
    await repository.softDelete(groupId, owner)
    await repository.softDelete(kept.id, owner)
    await expireDeletion(sql, groupId, 31)
    await expireDeletion(sql, kept.id, 29)

    expect(await purgeDeletedGroups(sql)).toBe(1)

    for (const table of ["groups", "group_members", "notes"]) {
      const rows = await sql`SELECT 1 FROM ${sql(table)} WHERE ${
        sql(table === "groups" ? "id" : "group_id")
      } = ${groupId}`
      expect(rows.length).toBe(0)
    }
    // The audit rows stay as a record, without the group they were about.
    const audit = await sql<{ kind: string; groupId: string | null }[]>`
      SELECT event_kind AS kind, group_id FROM audit_events
      WHERE actor_user_id = ${owner} AND event_kind = 'group.created' AND group_id IS NULL
    `
    expect(audit.length).toBeGreaterThan(0)
    const survivors = await sql`SELECT 1 FROM audit_events WHERE group_id = ${groupId}`
    expect(survivors.length).toBe(0)
    const stillThere = await sql`SELECT 1 FROM groups WHERE id = ${kept.id}`
    expect(stillThere.length).toBe(1)
    expect(await purgeDeletedGroups(sql)).toBe(0)
  })
})

Deno.test("delete and restore are announced to the members through the outbox", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner } = await team(sql)
    const announced = async (kind: string) =>
      (await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM outbox_events
        WHERE group_id = ${groupId} AND event_kind = ${kind}
      `)[0].count
    const sequence = async () =>
      (await sql<{ next: string }[]>`
        SELECT next_change_sequence::text AS next FROM groups WHERE id = ${groupId}
      `)[0].next

    const before = BigInt(await sequence())
    await repository.softDelete(groupId, owner)
    expect(await announced("group.deleted")).toBe(1)
    expect(BigInt(await sequence()) > before).toBe(true)

    const afterDelete = BigInt(await sequence())
    await repository.restore(groupId, owner)
    expect(await announced("group.restored")).toBe(1)
    expect(BigInt(await sequence()) > afterDelete).toBe(true)
  })
})

Deno.test("delete: two deletes at once never leave a person without a group", async () => {
  await withSchema(async (sql) => {
    const repository = new PostgresGroupRepository(sql)
    const ann = await insertUser(sql)
    const bob = await insertUser(sql)
    // Each owns one group and is a member of the other's, and has no other group: either delete
    // alone is allowed, both together would leave both people with nothing.
    const annsGroup = (await repository.create({ id: crypto.randomUUID(), name: "Ann" }, ann)).group
    const bobsGroup = (await repository.create({ id: crypto.randomUUID(), name: "Bob" }, bob)).group
    await sql`
      INSERT INTO group_members (group_id, user_id, role, added_by_user_id) VALUES
        (${annsGroup.id}, ${bob}, ${GroupRole.EDITOR}, ${ann}),
        (${bobsGroup.id}, ${ann}, ${GroupRole.EDITOR}, ${bob})
    `

    // Both deletes start while a third transaction holds both people's rows, and run on together
    // when it lets go: without locks on every member they would not see each other's work.
    const hold = await sql.reserve()
    await hold`BEGIN`
    await hold`SELECT id FROM users WHERE id IN (${ann}, ${bob}) ORDER BY id FOR UPDATE`
    const results = Promise.allSettled([
      repository.softDelete(annsGroup.id, ann),
      repository.softDelete(bobsGroup.id, bob),
    ])
    for (let attempt = 0; attempt < 100; attempt++) {
      const [{ waiting }] = await sql<{ waiting: number }[]>`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND datname = current_database()
      `
      if (waiting >= 2) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await hold`COMMIT`
    hold.release()
    const settled = await results

    for (const person of [ann, bob]) {
      const { groups } = await repository.listForUser(person, { limit: 10 })
      expect(groups.length).toBeGreaterThan(0)
    }
    const refused = settled.filter((result) => result.status === "rejected")
    expect(refused.length).toBe(1)
    expect((refused[0] as PromiseRejectedResult).reason).toMatchObject({ code: "LAST_GROUP" })
  })
})

Deno.test("delete: a group that is already deleted does not count as another group", async () => {
  await withSchema(async (sql) => {
    const repository = new PostgresGroupRepository(sql)
    const owner = await insertUser(sql)
    const live = (await repository.create({ id: crypto.randomUUID(), name: "Live" }, owner)).group
    const gone = (await repository.create({ id: crypto.randomUUID(), name: "Gone" }, owner)).group
    await sql`UPDATE groups SET deleted_at = now() WHERE id = ${gone.id}`

    await expect(repository.softDelete(live.id, owner)).rejects.toMatchObject({
      code: "LAST_GROUP",
    })
    expect((await repository.getSummaryForMember(live.id, owner))?.name).toBe("Live")
  })
})

Deno.test("rename, delete and restore each write an audit row with the request id", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner } = await team(sql)

    await repository.rename(groupId, "Trip", owner, "req-rename")
    await repository.softDelete(groupId, owner, "req-delete")
    await repository.restore(groupId, owner, "req-restore")

    const rows = await sql<{ kind: string; actor: number; request: string }[]>`
      SELECT event_kind AS kind, actor_user_id AS actor, request_id AS request
      FROM audit_events WHERE group_id = ${groupId} AND event_kind <> 'group.created'
      ORDER BY id
    `
    expect(rows).toEqual([
      { kind: "group.renamed", actor: owner, request: "req-rename" },
      { kind: "group.deleted", actor: owner, request: "req-delete" },
      { kind: "group.restored", actor: owner, request: "req-restore" },
    ])
  })
})

Deno.test("a refused rename, delete or restore writes no audit row", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, viewer } = await team(sql)

    await repository.rename(groupId, "Nope", viewer, "req-1")
    await repository.softDelete(groupId, viewer, "req-2")
    await repository.restore(groupId, viewer, "req-3")

    const rows = await sql`
      SELECT 1 FROM audit_events WHERE group_id = ${groupId} AND event_kind <> 'group.created'
    `
    expect(rows.length).toBe(0)
  })
})

Deno.test("rename: a deleted group cannot be renamed, even by its owner", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner } = await team(sql)
    await repository.softDelete(groupId, owner)

    expect(await repository.rename(groupId, "Too late", owner)).toBeNull()

    const name = await sql<{ name: string }[]>`SELECT name FROM groups WHERE id = ${groupId}`
    expect(name[0].name).toBe("Team")
  })
})

Deno.test("notes: a write after the group was deleted is refused and leaves no trace", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner } = await team(sql)
    const notes = new PostgresNoteRepository(sql)
    const existing = crypto.randomUUID()
    await notes.create({ groupId, id: existing, title: "Before", body: "" }, owner)
    // The handlers check the role, then write. A delete that lands between the two:
    await repository.softDelete(groupId, owner)
    const outboxBefore = (await sql`SELECT 1 FROM outbox_events`).length

    const refused = [
      () => notes.create({ groupId, id: crypto.randomUUID(), title: "New", body: "" }, owner),
      () =>
        notes.update(
          { groupId, id: existing, title: "After", body: "", expectedVersion: 1 },
          owner,
        ),
      () => notes.delete({ groupId, id: existing, expectedVersion: 1 }, owner),
    ]

    for (const write of refused) {
      const error = await write().then(() => null, (cause) => cause)
      expect(error).toBeInstanceOf(NoteError)
      expect(error).toMatchObject({ code: "GROUP_NOT_FOUND" })
    }
    const rows = await sql<{ title: string; version: number; deletedAt: Date | null }[]>`
      SELECT title, version, deleted_at FROM notes WHERE group_id = ${groupId}
    `
    expect(rows).toEqual([{ title: "Before", version: 1, deletedAt: null }])
    expect((await sql`SELECT 1 FROM outbox_events`).length).toBe(outboxBefore)
  })
})

Deno.test("delete: an unfinished note insert neither blocks the delete nor deadlocks with it", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner } = await team(sql)

    // A note insert in flight: its foreign keys hold a key-share lock on the group and the person.
    // A delete that locked those rows harder (FOR UPDATE) would wait for it, and the note's own
    // write to the group would then wait for the delete: a deadlock.
    const writing = await sql.reserve()
    await writing`BEGIN`
    await writing`
      INSERT INTO notes (id, group_id, title, body, change_sequence, created_by_user_id, updated_by_user_id)
      VALUES (${crypto.randomUUID()}, ${groupId}, 'Racing', '', 1, ${owner}, ${owner})
    `

    const finished = await Promise.race([
      repository.softDelete(groupId, owner).then(() => "deleted"),
      new Promise((resolve) => setTimeout(() => resolve("blocked"), 5000)),
    ])
    expect(finished).toBe("deleted")

    // The note's write to the group now finds it deleted, and rolls the note back.
    await expect(recordGroupChange(writing, groupId, owner, "note.created")).rejects
      .toBeInstanceOf(GroupNotActiveError)
    await writing`ROLLBACK`
    writing.release()
    expect((await sql`SELECT 1 FROM notes WHERE group_id = ${groupId}`).length).toBe(0)
  })
})
