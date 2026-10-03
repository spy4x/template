import type postgres from "postgres"
import {
  ensureScheduledOutboxEvent,
  OutboxProcessor,
  PostgresOutboxRepository,
} from "@spy4x/server/outbox"
import type { BillingProvider } from "@spy4x/billing"
import { BillingNoticeKind } from "@domain/billing"
import { BILLING_NOTICE_JOBS } from "../billing/billing-notices.ts"
import {
  queueSeatDrift,
  SEAT_SYNC_JOB,
  seatSyncJob,
  SeatSyncPublisher,
} from "../billing/seat-sync.ts"
import { GroupChangeNotifier } from "../groups/group-change-notify.ts"
import { purgeDeadInvitations } from "../groups/purge-dead-invitations.ts"
import { purgeDeletedGroups } from "../groups/purge-deleted-groups.ts"
import { billingNoticeMailJob } from "./billing-notice-mail.ts"
import {
  EMAIL_CODE_MAIL_JOB,
  emailCodeMailJob,
  removeStaleEmailCodeRequests,
} from "./email-code-mail.ts"
import {
  PASSWORD_RESET_MAIL_JOB,
  type PasswordResetMailDeps,
  passwordResetMailJob,
  removeStalePasswordResetRequests,
} from "./password-reset-mail.ts"
import {
  JOB_AGGREGATE,
  JOB_AGGREGATE_ID,
  type JobHandler,
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
 * cleanup also drops password reset and e-mail code requests whose mail gave up, and removes for
 * good the groups whose 30 days for restoring are over, and the invitations dead for over 30 days. Every mail job, the owner's billing notices
 * included, shares one sender and brand.
 *
 * With a billing `provider`, a change to a group's members queues a seat sync, which sets a
 * per-member subscription's quantity to the member count, and the nightly cleanup queues one for
 * every group whose stored quantity has drifted. Without one, a seat sync left in the table does
 * nothing.
 */
export function createOutboxProcessor(
  sql: postgres.Sql,
  mail: Omit<PasswordResetMailDeps, "sql">,
  provider: BillingProvider | null = null,
): OutboxProcessor {
  const notifier = new GroupChangeNotifier(sql)
  return new OutboxProcessor(
    new PostgresOutboxRepository(sql),
    new JobPublisher({
      [OUTBOX_CLEANUP_JOB]: async () => {
        const removed = await removeProcessedOutboxEvents(sql)
        if (removed > 0) console.log(`Removed ${removed} old processed outbox row(s)`)
        const stale = await removeStalePasswordResetRequests(sql)
        if (stale > 0) console.log(`Removed ${stale} unsent password reset request(s)`)
        const staleCodes = await removeStaleEmailCodeRequests(sql)
        if (staleCodes > 0) console.log(`Removed ${staleCodes} unsent e-mail code request(s)`)
        const groups = await purgeDeletedGroups(sql)
        if (groups.removed > 0) console.log(`Removed ${groups.removed} deleted group(s) for good`)
        if (groups.kept > 0) {
          console.warn(
            `Kept ${groups.kept} deleted group(s) with a live subscription; cancel it in Stripe`,
          )
        }
        const invitations = await purgeDeadInvitations(sql)
        if (invitations > 0) console.log(`Removed ${invitations} dead group invitation(s)`)
        if (provider) {
          const drifted = await queueSeatDrift(sql)
          if (drifted > 0) console.log(`Queued a seat sync for ${drifted} group(s)`)
        }
      },
      [SEAT_SYNC_JOB]: provider ? seatSyncJob({ sql, provider }) : async () => {},
      [PASSWORD_RESET_MAIL_JOB]: passwordResetMailJob({ sql, ...mail }),
      [EMAIL_CODE_MAIL_JOB]: emailCodeMailJob({ sql, ...mail }),
      ...billingNoticeJobs(sql, mail),
    }, provider ? new SeatSyncPublisher(sql, notifier) : notifier),
    { repeatEveryMs: { [OUTBOX_CLEANUP_JOB]: DAY_MS } },
  )
}

/** One mail job per billing notice. */
function billingNoticeJobs(
  sql: postgres.Sql,
  { sender, brand, log }: Omit<PasswordResetMailDeps, "sql">,
): Record<string, JobHandler> {
  const kinds = [
    BillingNoticeKind.TrialEnding,
    BillingNoticeKind.PaymentFailed,
    BillingNoticeKind.PlanEnding,
  ]
  return Object.fromEntries(
    kinds.map((kind) => [
      BILLING_NOTICE_JOBS[kind],
      billingNoticeMailJob(kind, { sql, sender, brand, log }),
    ]),
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
