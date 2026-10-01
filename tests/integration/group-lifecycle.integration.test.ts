/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { GroupRole } from "@domain/groups"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { purgeDeletedGroups } from "@server/groups/purge-deleted-groups.ts"
import { requireDbConnection } from "./db-connection.ts"

/**
 * Rename, delete and restore of a group against a real Postgres built from schema.sql: who may do
 * what, the rule that a person keeps one group, what members see, the 30 days and the purge. Needs
 * `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md); it fails when they
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
 * stranger. The members have a group of their own, except `onlyHere`, whose only group is the team.
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

    for (const table of ["groups", "group_members", "notes", "audit_events"]) {
      const rows = await sql`SELECT 1 FROM ${sql(table)} WHERE ${
        sql(table === "groups" ? "id" : "group_id")
      } = ${groupId}`
      expect(rows.length).toBe(0)
    }
    const stillThere = await sql`SELECT 1 FROM groups WHERE id = ${kept.id}`
    expect(stillThere.length).toBe(1)
    expect(await purgeDeletedGroups(sql)).toBe(0)
  })
})
