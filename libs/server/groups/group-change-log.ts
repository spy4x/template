import type postgres from "postgres"
import { GROUP_AGGREGATE } from "@domain/groups"

interface ChangeSequenceRow extends postgres.Row {
  sequence: string
}

/**
 * Stamps one committed change on a group: takes the group's next sequence and writes the outbox
 * row that announces it. Returns the sequence, as a decimal string. Every write to a group or to
 * anything inside one (a note) calls it, so one sequence orders all of a group's changes.
 *
 * It must run in the transaction of the change it records, so a change that rolls back takes its
 * sequence and its outbox row with it, and no push is ever sent for it. The `UPDATE` locks the
 * group row, which is what hands two concurrent changes two different sequences in commit order.
 * The outbox row carries the group as its aggregate and the sequence as its version, so the
 * publisher can name both without reading the group again; `eventKind` says what changed.
 */
export async function recordGroupChange(
  sql: postgres.Sql,
  groupId: string,
  actorId: number,
  eventKind: string,
): Promise<string> {
  const stamped = (
    await sql<ChangeSequenceRow[]>`
      UPDATE groups
      SET next_change_sequence = next_change_sequence + 1
      WHERE id = ${groupId}
      RETURNING (next_change_sequence - 1)::text AS sequence
    `
  )[0]
  if (!stamped) {
    throw new Error(`Group ${groupId} vanished while its change was being recorded`)
  }
  await sql`
    INSERT INTO outbox_events (
      id,
      event_kind,
      aggregate_type,
      aggregate_id,
      aggregate_version,
      group_id,
      actor_user_id
    ) VALUES (
      ${crypto.randomUUID()},
      ${eventKind},
      ${GROUP_AGGREGATE},
      ${groupId},
      ${stamped.sequence}::bigint,
      ${groupId},
      ${actorId}
    )
  `
  return stamped.sequence
}
