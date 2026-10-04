import type postgres from "postgres"
import { NOTIFICATION_RETENTION_DAYS } from "@domain/notifications"

/**
 * Deletes every notification that was read more than `days` ago (90 by default,
 * {@link NOTIFICATION_RETENTION_DAYS}) and returns how many. It runs in the worker's nightly
 * cleanup. The age is counted from the moment of reading, by the database's clock, as the other
 * purges are: an unread notification is never deleted, however old, because the person has not
 * seen it yet.
 */
export async function purgeReadNotifications(
  sql: postgres.Sql,
  days: number = NOTIFICATION_RETENTION_DAYS,
): Promise<number> {
  const removed = await sql`
    DELETE FROM notifications
    WHERE read_at IS NOT NULL AND read_at < now() - make_interval(days => ${days})
  `
  return removed.count
}
