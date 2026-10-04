import type postgres from "postgres"
import { scheduleOutboxEvent } from "@spy4x/server/outbox"
import { NoteError } from "@domain/notes"
import { PostgresNoteRepository } from "../notes/postgres-note-repository.ts"
import { JOB_AGGREGATE, type JobHandler } from "./jobs.ts"

/** The job that gives a new account its starter data. Its aggregate id is the request's id. */
export const STARTER_DATA_JOB = "onboarding.starter-data"

/** The title of the note every new account starts with. */
export const WELCOME_NOTE_TITLE = "Welcome"

/** The body of the welcome note: what the app is and the three things to try first. */
export const WELCOME_NOTE_BODY = [
  `This is a note. Edit it, delete it or write your own: it is yours.`,
  ``,
  `Notes live in a group. Your first group is called Personal; rename it or make more from the group menu.`,
  `Invite someone to a group and they see the same notes, live, with the role you give them.`,
].join(`\n`)

/**
 * Records that a new account is owed its starter data and queues the job that gives it, both in the
 * caller's transaction, the sign-up's own. The job runs in the worker, so a slow or failing job
 * never holds up or undoes a sign-up. The outbox names a job by a UUID, so the job points at this
 * row rather than at the user.
 */
export async function scheduleStarterData(tx: postgres.Sql, userId: number): Promise<void> {
  const id = crypto.randomUUID()
  await tx`INSERT INTO starter_data_requests (id, user_id) VALUES (${id}, ${userId})`
  await scheduleOutboxEvent(
    tx,
    { aggregateType: JOB_AGGREGATE, aggregateId: id, eventKind: STARTER_DATA_JOB },
    { inMs: 0 },
  )
}

/**
 * Creates the welcome note in the person's first group, then sets `done_at`. The note's id is the
 * request's id, so a job that runs twice (a forced retry, a crash between the note and the marker)
 * adds one note: the second insert finds the first and does nothing. Once `done_at` is set the job
 * does not look at the notes again, so a note the person deleted stays deleted. A person with no
 * active group left gets nothing, and the request is closed.
 */
export function starterDataJob(sql: postgres.Sql): JobHandler {
  return async (event) => {
    const [request] = await sql<{ userId: number; doneAt: Date | null }[]>`
      SELECT user_id AS "userId", done_at AS "doneAt"
      FROM starter_data_requests
      WHERE id = ${event.aggregateId}
    `
    if (!request || request.doneAt) return
    const [group] = await sql<{ id: string }[]>`
      SELECT groups.id
      FROM group_members
      INNER JOIN groups ON groups.id = group_members.group_id AND groups.deleted_at IS NULL
      INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
      WHERE group_members.user_id = ${request.userId}
      ORDER BY groups.created_at, groups.id
      LIMIT 1
    `
    if (group) {
      try {
        await new PostgresNoteRepository(sql).create(
          {
            groupId: group.id,
            id: event.aggregateId,
            title: WELCOME_NOTE_TITLE,
            body: WELCOME_NOTE_BODY,
          },
          request.userId,
          null,
        )
      } catch (error) {
        // The group was deleted or the person was removed since the lookup: nothing to seed.
        if (!(error instanceof NoteError)) throw error
      }
    }
    await sql`UPDATE starter_data_requests SET done_at = now() WHERE id = ${event.aggregateId}`
  }
}
