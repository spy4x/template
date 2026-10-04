import type postgres from "postgres"

/**
 * The Postgres channel a change to a person's inbox is announced on. It is sent from inside the
 * transaction of that change, so Postgres delivers it only once the change has committed and never
 * for one that rolled back. The API listens and tells the person's open sockets.
 */
export const USER_NOTIFICATION_CHANNEL = "user_notification"

/** The inbox of `userId` changed: a notification arrived, or some were read. */
export interface UserNotificationChange {
  userId: number
}

/** Announces a change to `userId`'s inbox. Call it in the transaction of the change. */
export async function announceNotificationChange(
  sql: postgres.Sql,
  userId: number,
): Promise<void> {
  const change: UserNotificationChange = { userId }
  await sql`SELECT pg_notify(${USER_NOTIFICATION_CHANNEL}, ${JSON.stringify(change)})`
}

/** Reads a notification payload; `null` for anything that is not a well-formed change. */
export function parseNotificationChange(payload: string): UserNotificationChange | null {
  let value: unknown
  try {
    value = JSON.parse(payload)
  } catch {
    return null
  }
  if (typeof value !== "object" || value === null) return null
  const { userId } = value as Record<string, unknown>
  if (typeof userId !== "number" || !Number.isSafeInteger(userId) || userId < 1) return null
  return { userId }
}

/**
 * Calls `onChange` for every inbox change announced on {@link USER_NOTIFICATION_CHANNEL}. Returns a
 * function that stops listening.
 */
export async function listenForNotificationChanges(
  sql: postgres.Sql,
  onChange: (change: UserNotificationChange) => void,
): Promise<() => Promise<void>> {
  const subscription = await sql.listen(USER_NOTIFICATION_CHANNEL, (payload) => {
    const change = parseNotificationChange(payload)
    if (change) onChange(change)
  })
  return () => subscription.unlisten()
}
