import type postgres from "postgres"
import type { OutboxEvent, OutboxPublisher } from "@spy4x/server/outbox"

/** The outbox rows that are jobs, not group changes, carry this aggregate type. */
export const JOB_AGGREGATE = "job"

/** A job row names no real thing, so every job of one kind points at the same fixed id. */
export const JOB_AGGREGATE_ID = "00000000-0000-4000-8000-000000000000"

/** The nightly removal of old processed outbox rows. */
export const OUTBOX_CLEANUP_JOB = "outbox.cleanup"

/** Processed outbox rows are kept this long, so a recent change can still be looked at. */
export const OUTBOX_RETENTION_DAYS = 7

/** What the worker does when a job's time has come. */
export type JobHandler = () => Promise<void>

/**
 * Runs the outbox rows that are jobs and passes every other row to `fallback`. A job kind with no
 * handler throws, so it is retried and then stops with its error stored instead of vanishing.
 */
export class JobPublisher implements OutboxPublisher {
  constructor(
    private readonly handlers: Readonly<Record<string, JobHandler>>,
    private readonly fallback: OutboxPublisher,
  ) {}

  async publish(event: OutboxEvent): Promise<void> {
    if (event.aggregateType !== JOB_AGGREGATE) return await this.fallback.publish(event)
    const handler = this.handlers[event.eventKind]
    if (!handler) throw new RangeError(`no handler for job ${event.eventKind}`)
    await handler()
  }
}

/**
 * Deletes outbox rows processed more than {@link OUTBOX_RETENTION_DAYS} days ago and returns how
 * many. Every group change leaves a row, so without this the table only grows. Unprocessed rows,
 * including a job waiting for its time, are never touched.
 */
export async function removeProcessedOutboxEvents(sql: postgres.Sql): Promise<number> {
  const removed = await sql`
    DELETE FROM outbox_events
    WHERE processed_at < now() - make_interval(days => ${OUTBOX_RETENTION_DAYS})
  `
  return removed.count
}

/** The next time the clock reads `hour`:00 UTC after `now`; the first run of a nightly job. */
export function nextUtcHour(now: Date, hour: number): Date {
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    hour,
  ))
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1)
  return next
}
