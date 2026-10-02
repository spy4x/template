import type postgres from "postgres"
import {
  ensureScheduledOutboxEvent,
  OutboxProcessor,
  PostgresOutboxRepository,
} from "@spy4x/server/outbox"
import { GroupChangeNotifier } from "../groups/group-change-notify.ts"
import { purgeDeletedGroups } from "../groups/purge-deleted-groups.ts"
import {
  PASSWORD_RESET_MAIL_JOB,
  type PasswordResetMailDeps,
  passwordResetMailJob,
  removeStalePasswordResetRequests,
} from "./password-reset-mail.ts"
import {
  JOB_AGGREGATE,
  JOB_AGGREGATE_ID,
  JobPublisher,
  nextUtcHour,
  OUTBOX_CLEANUP_JOB,
  removeProcessedOutboxEvents,
} from "./jobs.ts"

const DAY_MS = 24 * 60 * 60_000

/** The hour, in UTC, at which the nightly jobs first run. */
const NIGHTLY_HOUR_UTC = 3

/**
 * The worker's outbox processor: group changes go to the notifier, jobs to their handlers, and the
 * nightly cleanup is one row that writes its next run, a day later, once it has succeeded. The
 * cleanup also drops password reset requests whose mail gave up, and removes for good the groups
 * whose 30 days for restoring are over.
 */
export function createOutboxProcessor(
  sql: postgres.Sql,
  mail: Omit<PasswordResetMailDeps, "sql">,
): OutboxProcessor {
  return new OutboxProcessor(
    new PostgresOutboxRepository(sql),
    new JobPublisher({
      [OUTBOX_CLEANUP_JOB]: async () => {
        const removed = await removeProcessedOutboxEvents(sql)
        if (removed > 0) console.log(`Removed ${removed} old processed outbox row(s)`)
        const stale = await removeStalePasswordResetRequests(sql)
        if (stale > 0) console.log(`Removed ${stale} unsent password reset request(s)`)
        const groups = await purgeDeletedGroups(sql)
        if (groups > 0) console.log(`Removed ${groups} deleted group(s) for good`)
      },
      [PASSWORD_RESET_MAIL_JOB]: passwordResetMailJob({ sql, ...mail }),
    }, new GroupChangeNotifier(sql)),
    { repeatEveryMs: { [OUTBOX_CLEANUP_JOB]: DAY_MS } },
  )
}

/** Starts the nightly cleanup chain at the next 03:00 UTC unless one is already waiting. */
export async function scheduleNightlyJobs(sql: postgres.Sql, now = new Date()): Promise<void> {
  await ensureScheduledOutboxEvent(
    sql,
    { eventKind: OUTBOX_CLEANUP_JOB, aggregateType: JOB_AGGREGATE, aggregateId: JOB_AGGREGATE_ID },
    { at: nextUtcHour(now, NIGHTLY_HOUR_UTC) },
  )
}
