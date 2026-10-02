/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { GroupRole } from "@domain/groups"
import { NoteError } from "@domain/notes"
import { recordAccessChange } from "@server/groups/group-change-log.ts"
import { PostgresNoteRepository } from "@server/notes/postgres-note-repository.ts"
import { team, withSchema } from "./group-team.ts"

/**
 * A write that passed the handler's role check, racing the owner who removes or demotes the
 * writer. The member change is held open until the write is waiting on it; once it commits, the
 * write must be refused, because every group write checks the role again in its own transaction.
 * Needs "DB_HOST", "DB_USER", "DB_PASS" and "DB_NAME" (recipe in docs/handoff.md); it fails when
 * they are missing.
 */

/** What the owner does to the writer, in a transaction that waits for `release` to commit. */
type MemberChange = "removal" | "demotion"

async function holdMemberChange(
  sql: postgres.Sql,
  groupId: string,
  owner: number,
  member: number,
  change: MemberChange,
) {
  let release!: () => void
  const released = new Promise<void>((resolve) => release = resolve)
  let written!: () => void
  const writtenSignal = new Promise<void>((resolve) => written = resolve)
  const committed = sql.begin(async (transaction: postgres.TransactionSql) => {
    if (change === "removal") {
      await transaction`
        DELETE FROM group_members WHERE group_id = ${groupId} AND user_id = ${member}
      `
      await recordAccessChange(transaction, groupId, owner, "group.member_removed", [member])
    } else {
      await transaction`
        UPDATE group_members SET role = ${GroupRole.VIEWER}
        WHERE group_id = ${groupId} AND user_id = ${member}
      `
      await recordAccessChange(transaction, groupId, owner, "group.member_role_changed", [])
    }
    written()
    await released
  })
  await writtenSignal
  return { release, committed }
}

/** Whether `promise` is still pending after a moment: the write is waiting on the member change. */
async function stillWaiting(promise: Promise<unknown>): Promise<boolean> {
  const pending = Symbol("pending")
  const settled = await Promise.race([
    promise.then(() => "settled", () => "settled"),
    new Promise((resolve) => setTimeout(() => resolve(pending), 300)),
  ])
  return settled === pending
}

const EXPECTED_CODE: Record<MemberChange, string> = {
  removal: "GROUP_NOT_FOUND",
  demotion: "ROLE_INSUFFICIENT",
}

for (const change of ["removal", "demotion"] as const) {
  for (const write of ["create", "update", "delete"] as const) {
    Deno.test(`note ${write}: refused when a ${change} commits while the write waits`, async () => {
      await withSchema(async (sql) => {
        const { groupId, owner, editor } = await team(sql)
        const notes = new PostgresNoteRepository(sql)
        const id = crypto.randomUUID()
        if (write !== "create") {
          await notes.create({ groupId, id, title: "First", body: "" }, editor)
        }

        const held = await holdMemberChange(sql, groupId, owner, editor, change)
        const writing = write === "create"
          ? notes.create({ groupId, id, title: "Late", body: "" }, editor)
          : write === "update"
          ? notes.update({ groupId, id, title: "Late", body: "", expectedVersion: 1 }, editor)
          : notes.delete({ groupId, id, expectedVersion: 1 }, editor)
        const outcome = writing.then(() => null, (error) => error)

        expect(await stillWaiting(outcome)).toBe(true)
        held.release()
        await held.committed

        const error = await outcome
        expect(error).toBeInstanceOf(NoteError)
        expect((error as NoteError).code).toBe(EXPECTED_CODE[change])
        const rows = await sql<{ title: string; deleted: boolean }[]>`
          SELECT title, deleted_at IS NOT NULL AS deleted FROM notes WHERE id = ${id}
        `
        expect(rows).toEqual(write === "create" ? [] : [{ title: "First", deleted: false }])
      })
    })
  }
}

Deno.test("rename: refused when the admin is demoted while the rename waits", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, admin } = await team(sql)

    const held = await holdMemberChange(sql, groupId, owner, admin, "demotion")
    const renaming = repository.rename(groupId, "Late", admin)

    expect(await stillWaiting(renaming)).toBe(true)
    held.release()
    await held.committed

    expect(await renaming).toBeNull()
    expect((await repository.getSummaryForMember(groupId, owner))?.name).toBe("Team")
  })
})
