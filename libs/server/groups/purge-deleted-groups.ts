import type postgres from "postgres"
import { BillingStatus } from "@domain/billing"
import { GROUP_RESTORE_DAYS } from "@domain/groups"

/**
 * Removes for good every group that was deleted more than {@link GROUP_RESTORE_DAYS} days ago, and
 * returns how many. The database removes what hangs off a group with it (members, notes, outbox
 * rows). Its audit rows stay: the database empties their group id. A
 * person's selection that pointed at the group is emptied by the database.
 *
 * It uses the clock of the database, as the restore window does, so a group is never both
 * restorable and purged. A group deleted exactly on the boundary stays until the next run.
 *
 * A group whose subscription is not cancelled stays: a webhook can store one after the delete, and
 * purging it would drop the only record of a subscription the provider still charges.
 */
export async function purgeDeletedGroups(sql: postgres.Sql): Promise<number> {
  return await sql.begin(async (transaction) => {
    const due = await transaction<{ id: string }[]>`
      SELECT id
      FROM groups
      WHERE deleted_at < now() - make_interval(days => ${GROUP_RESTORE_DAYS})
        AND NOT EXISTS (
          SELECT 1 FROM subscriptions
          WHERE subscriptions.group_id = groups.id AND subscriptions.status <> ${BillingStatus.Canceled}
        )
      FOR UPDATE
    `
    if (due.length === 0) return 0
    const ids = due.map((group) => group.id)
    await transaction`DELETE FROM groups WHERE id IN ${transaction(ids)}`
    return ids.length
  })
}
