import type postgres from "postgres"
import type { OutboxEvent, OutboxPublisher } from "@spy4x/server/outbox"
import { GROUP_AGGREGATE } from "@domain/groups"

/** The Postgres channel the worker announces group changes on and the API listens to. */
export const GROUP_CHANGE_CHANNEL = "group_change"

/** A group moved to `sequence`. Carries no data: a client that is behind pulls it. */
export interface GroupChange {
  groupId: string
  sequence: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Turns one committed outbox row into a Postgres notification, which is how a change reaches the
 * API process that holds the sockets (the worker holds none).
 *
 * The notification is a wake-up, not a delivery guarantee: one sent while the API is down is lost.
 * That is by design (ADR 002, "Push with sequence, pull as the authority"): a client that missed a
 * hint pulls when it reconnects or sees a gap, so a lost notification costs a pull, never
 * divergence. A row of another aggregate is not a group change and is left alone.
 */
export class GroupChangeNotifier implements OutboxPublisher {
  constructor(private readonly sql: postgres.Sql) {}

  async publish(event: OutboxEvent): Promise<void> {
    if (event.aggregateType !== GROUP_AGGREGATE) return
    const sequence = Number(event.aggregateVersion)
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new RangeError(`outbox row ${event.id} has no usable sequence`)
    }
    const change: GroupChange = { groupId: event.aggregateId, sequence }
    await this.sql`SELECT pg_notify(${GROUP_CHANGE_CHANNEL}, ${JSON.stringify(change)})`
  }
}

/** Reads a notification payload; `null` for anything that is not a well-formed group change. */
export function parseGroupChange(payload: string): GroupChange | null {
  let value: unknown
  try {
    value = JSON.parse(payload)
  } catch {
    return null
  }
  if (typeof value !== "object" || value === null) return null
  const { groupId, sequence } = value as Record<string, unknown>
  if (typeof groupId !== "string" || !UUID.test(groupId)) return null
  if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 1) return null
  return { groupId, sequence }
}

/**
 * Calls `onChange` for every group change announced on {@link GROUP_CHANGE_CHANNEL}. Postgres.js
 * re-listens after a dropped connection. Returns a function that stops listening.
 */
export async function listenForGroupChanges(
  sql: postgres.Sql,
  onChange: (change: GroupChange) => void,
): Promise<() => Promise<void>> {
  const subscription = await sql.listen(GROUP_CHANGE_CHANNEL, (payload) => {
    const change = parseGroupChange(payload)
    if (change) onChange(change)
  })
  return () => subscription.unlisten()
}
