import type postgres from "postgres"
import { GROUP_RESTORE_DAYS } from "@domain/groups"

/**
 * Removes for good every group that was deleted more than {@link GROUP_RESTORE_DAYS} days ago, and
 * returns how many. The database removes what hangs off a group with it (members, notes, outbox
 * rows); the audit rows of the group are removed first, because they refuse to outlive it. A
 * person's selection that pointed at the group is emptied by the database.
 *
 * It uses the clock of the database, as the restore window does, so a group is never both
 * restorable and purged. A group deleted exactly on the boundary stays until the next run.
 */
export async function purgeDeletedGroups(sql: postgres.Sql): Promise<number> {
  return await sql.begin(async (transaction) => {
    const due = await transaction<{ id: string }[]>`
      SELECT id
      FROM groups
      WHERE deleted_at < now() - make_interval(days => ${GROUP_RESTORE_DAYS})
      FOR UPDATE
    `
    if (due.length === 0) return 0
    const ids = due.map((group) => group.id)
    await transaction`DELETE FROM audit_events WHERE group_id IN ${transaction(ids)}`
    await transaction`DELETE FROM groups WHERE id IN ${transaction(ids)}`
    return ids.length
  })
}
