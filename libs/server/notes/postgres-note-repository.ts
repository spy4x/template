import type postgres from "postgres"
import {
  type DeletedNote,
  type Note,
  NOTE_EVENTS,
  type NoteCreateInput,
  type NoteDeleteInput,
  NoteError,
  type NoteListPage,
  type NoteListResult,
  type NoteRepository,
  type NoteUpdateInput,
  NoteVersionConflictError,
  type NoteWriteResult,
} from "@domain/notes"
import { GroupNotActiveError, recordGroupChange } from "@server/groups/group-change-log.ts"

interface NoteRow extends postgres.Row, Note {}

interface VersionRow extends postgres.Row {
  version: number
}

interface DeletedRow extends postgres.Row {
  id: string
  groupId: string
  version: number
}

/**
 * Records a note's change on its group. A group deleted since the role check is answered as a
 * missing group, and the note write rolls back with it.
 */
async function recordNoteChange(
  sql: postgres.Sql,
  groupId: string,
  actorId: number,
  eventKind: string,
): Promise<string> {
  try {
    return await recordGroupChange(sql, groupId, actorId, eventKind)
  } catch (error) {
    if (error instanceof GroupNotActiveError) {
      throw new NoteError("GROUP_NOT_FOUND", "Group not found")
    }
    throw error
  }
}

/**
 * Notes in Postgres. Every write runs in one transaction that also records the change on the
 * group (`recordGroupChange`): the group's sequence moves and an outbox row is written, or neither
 * happens. It checks no role; the handlers decide who may call it.
 */
export class PostgresNoteRepository implements NoteRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async list(groupId: string, page: NoteListPage): Promise<NoteListResult> {
    const limit = Math.max(1, Math.min(100, page.limit))
    const rows = await this.sql<NoteRow[]>`
      SELECT ${this.columns()}
      FROM notes
      WHERE group_id = ${groupId}
        AND deleted_at IS NULL
        ${
      page.after
        ? this.sql`
          AND (
            updated_at < ${page.after.updatedAt}
            OR (updated_at = ${page.after.updatedAt} AND id > ${page.after.id})
          )
        `
        : this.sql``
    }
      ORDER BY updated_at DESC, id
      LIMIT ${limit + 1}
    `
    const notes = rows.slice(0, limit).map(toNote)
    const last = notes.at(-1)
    return {
      notes,
      nextPageKey: rows.length > limit && last ? { updatedAt: last.updatedAt, id: last.id } : null,
    }
  }

  async get(groupId: string, id: string): Promise<Note | null> {
    const row = (
      await this.sql<NoteRow[]>`
        SELECT ${this.columns()}
        FROM notes
        WHERE id = ${id} AND group_id = ${groupId} AND deleted_at IS NULL
      `
    )[0]
    return row ? toNote(row) : null
  }

  async create(input: NoteCreateInput, actorId: number): Promise<NoteWriteResult> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresNoteRepository(transaction)
      // `change_sequence` is set below, once the change is recorded: recording it before the insert
      // would announce a change for a retry that inserts nothing.
      const inserted = (
        await transaction<{ id: string }[]>`
          INSERT INTO notes (
            id, group_id, title, body, change_sequence, created_by_user_id, updated_by_user_id
          ) VALUES (
            ${input.id}, ${input.groupId}, ${input.title}, ${input.body}, 1, ${actorId}, ${actorId}
          )
          ON CONFLICT (id) DO NOTHING
          RETURNING id
        `
      )[0]
      if (inserted) {
        const note = await repository.stamp(input.groupId, input.id, actorId, NOTE_EVENTS.created)
        return { note, created: true }
      }

      // The id is taken. A retry of this very request gets the note back; anything else is refused.
      const existing = await repository.get(input.groupId, input.id)
      if (
        existing &&
        existing.createdByUserId === actorId &&
        existing.title === input.title &&
        existing.body === input.body
      ) {
        return { note: existing, created: false }
      }
      throw new NoteError("ID_ALREADY_EXISTS", "Note id is already in use")
    })
  }

  async update(input: NoteUpdateInput, actorId: number): Promise<Note> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresNoteRepository(transaction)
      const updated = await transaction<{ id: string }[]>`
        UPDATE notes
        SET title = ${input.title},
            body = ${input.body},
            version = version + 1,
            updated_by_user_id = ${actorId},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${input.id}
          AND group_id = ${input.groupId}
          AND deleted_at IS NULL
          AND version = ${input.expectedVersion}
        RETURNING id
      `
      if (updated.length === 0) return await repository.refuseStaleWrite(input.groupId, input.id)
      return await repository.stamp(input.groupId, input.id, actorId, NOTE_EVENTS.updated)
    })
  }

  async delete(input: NoteDeleteInput, actorId: number): Promise<DeletedNote> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresNoteRepository(transaction)
      const deleted = (
        await transaction<DeletedRow[]>`
          UPDATE notes
          SET deleted_at = CURRENT_TIMESTAMP,
              version = version + 1,
              updated_by_user_id = ${actorId},
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ${input.id}
            AND group_id = ${input.groupId}
            AND deleted_at IS NULL
            AND version = ${input.expectedVersion}
          RETURNING id, group_id, version
        `
      )[0]
      if (!deleted) return await repository.refuseStaleWrite(input.groupId, input.id)
      const sequence = await recordNoteChange(
        transaction,
        input.groupId,
        actorId,
        NOTE_EVENTS.deleted,
      )
      await transaction`UPDATE notes SET change_sequence = ${sequence}::bigint WHERE id = ${input.id}`
      return {
        id: deleted.id,
        groupId: deleted.groupId,
        version: deleted.version,
        changeSequence: sequence,
      }
    })
  }

  /**
   * Records the change of a note written in this transaction on its group, stores the sequence on
   * the note and returns the note as it now reads.
   */
  private async stamp(
    groupId: string,
    id: string,
    actorId: number,
    eventKind: string,
  ): Promise<Note> {
    const sequence = await recordNoteChange(this.sql, groupId, actorId, eventKind)
    const row = (
      await this.sql<NoteRow[]>`
        UPDATE notes SET change_sequence = ${sequence}::bigint
        WHERE id = ${id}
        RETURNING ${this.columns()}
      `
    )[0]
    if (!row) throw new Error(`Note ${id} vanished while its change was being recorded`)
    return toNote(row)
  }

  /**
   * Explains why an update or delete matched no row: the note is gone (`NOTE_NOT_FOUND`) or it is
   * at another version ({@link NoteVersionConflictError} with that version). Always throws.
   */
  private async refuseStaleWrite(groupId: string, id: string): Promise<never> {
    const current = (
      await this.sql<VersionRow[]>`
        SELECT version FROM notes
        WHERE id = ${id} AND group_id = ${groupId} AND deleted_at IS NULL
      `
    )[0]
    if (!current) throw new NoteError("NOTE_NOT_FOUND", "Note not found")
    throw new NoteVersionConflictError(current.version)
  }

  private columns() {
    return this.sql`
      id,
      group_id,
      title,
      body,
      version,
      change_sequence::text AS change_sequence,
      created_by_user_id,
      updated_by_user_id,
      created_at,
      updated_at
    `
  }
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    groupId: row.groupId,
    title: row.title,
    body: row.body,
    version: row.version,
    changeSequence: row.changeSequence,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
