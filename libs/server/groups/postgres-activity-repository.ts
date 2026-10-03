import type postgres from "postgres"
import type {
  ActivityEvent,
  ActivityPage,
  ActivityResult,
  AuditDetails,
  AuditEntityType,
  GroupActivityRepository,
} from "@domain/groups"

interface ActivityRow extends postgres.Row {
  id: string
  kind: string
  at: Date
  actorUserId: number
  actorName: string
  targetUserId: number | null
  targetName: string | null
  entityType: AuditEntityType | null
  entityId: string | null
  entityExists: boolean
  details: AuditDetails
}

/**
 * Reads a group's activity from `audit_events`, newest first, paged by event id: the id grows with
 * every write, so a page never skips or repeats an event the way a timestamp shared by two events
 * would. The caller has checked that the actor may read it.
 *
 * A note the event points at "exists" while it is still in the group and not deleted; a note moved
 * to another group no longer does, so the log never links a reader to a note that left.
 */
export class PostgresGroupActivityRepository implements GroupActivityRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async list(groupId: string, page: ActivityPage): Promise<ActivityResult> {
    const limit = Math.max(1, Math.min(100, page.limit))
    const rows = await this.sql<ActivityRow[]>`
      SELECT
        audit_events.id::text AS id,
        audit_events.event_kind AS kind,
        audit_events.created_at AS at,
        audit_events.actor_user_id,
        btrim(concat_ws(' ', actor.first_name, actor.last_name)) AS actor_name,
        audit_events.target_user_id,
        btrim(concat_ws(' ', target.first_name, target.last_name)) AS target_name,
        audit_events.entity_type,
        audit_events.entity_id,
        (
          audit_events.entity_type = 'note'
          AND EXISTS (
            SELECT 1 FROM notes
            WHERE notes.id = audit_events.entity_id
              AND notes.group_id = audit_events.group_id
              AND notes.deleted_at IS NULL
          )
        ) AS entity_exists,
        audit_events.details
      FROM audit_events
      INNER JOIN users AS actor ON actor.id = audit_events.actor_user_id
      LEFT JOIN users AS target ON target.id = audit_events.target_user_id
      WHERE audit_events.group_id = ${groupId}
        ${page.after ? this.sql`AND audit_events.id < ${page.after.id}::bigint` : this.sql``}
      ORDER BY audit_events.id DESC
      LIMIT ${limit + 1}
    `
    const shown = rows.slice(0, limit)
    return {
      events: shown.map(toEvent),
      nextPageKey: rows.length > limit ? { id: shown[shown.length - 1].id } : null,
    }
  }
}

function toEvent(row: ActivityRow): ActivityEvent {
  return {
    id: row.id,
    kind: row.kind,
    at: row.at,
    actor: { userId: row.actorUserId, name: row.actorName },
    target: row.targetUserId === null
      ? null
      : { userId: row.targetUserId, name: row.targetName ?? "" },
    entity: row.entityType === null || row.entityId === null
      ? null
      : { type: row.entityType, id: row.entityId, exists: row.entityExists },
    details: row.details,
  }
}
