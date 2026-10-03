import type postgres from "postgres"
import type { EmailSender } from "@spy4x/email/sender"
import { scheduleOutboxEvent } from "@spy4x/server/outbox"
import {
  type AccountDeletionRequest,
  hardDeleteAccount,
  HardDeleteOutcome,
} from "../auth/account-deletion.ts"
import { accountDeletionMail, type MailBrand } from "../mail/mail.ts"
import { JOB_AGGREGATE, type JobHandler } from "./jobs.ts"

/** The job that deletes one account for good once its wait is over. */
export const ACCOUNT_HARD_DELETE_JOB = "account.hard-delete"

/** The job that mails the person the day their account goes. */
export const ACCOUNT_DELETION_MAIL_JOB = "account.deletion-mail"

/**
 * Queues both jobs of a request in the caller's transaction, so they exist exactly when the
 * request does: the mail at once, the delete for good at `deleteAfter`. Both point at the request's
 * id, so a restore, which removes the row, turns both into no-ops.
 */
export async function scheduleAccountDeletionJobs(
  tx: postgres.Sql,
  request: AccountDeletionRequest,
): Promise<void> {
  const event = { aggregateType: JOB_AGGREGATE, aggregateId: request.id }
  await scheduleOutboxEvent(tx, { ...event, eventKind: ACCOUNT_DELETION_MAIL_JOB }, { inMs: 0 })
  await scheduleOutboxEvent(
    tx,
    { ...event, eventKind: ACCOUNT_HARD_DELETE_JOB },
    { at: request.deleteAfter },
  )
}

/** What the delete-for-good job needs. */
export interface AccountHardDeleteDeps {
  sql: postgres.Sql
  /** Told when something stops the delete; gets no id or address. */
  log: (line: string) => void
}

/**
 * Deletes the account of the request the job names. A request that is gone (the person signed in)
 * does nothing. A blocked one is logged and left for the nightly run, which retries every due
 * request.
 */
export function accountHardDeleteJob({ sql, log }: AccountHardDeleteDeps): JobHandler {
  return async (event) => {
    const outcome = await hardDeleteAccount(sql, event.aggregateId)
    if (outcome === HardDeleteOutcome.Blocked) {
      log("warn: an account due for deletion still owns a shared or paid group; kept for now")
    }
  }
}

/** What the deletion mail job needs. */
export interface AccountDeletionMailDeps {
  sql: postgres.Sql
  /** `null` when mail is off: nothing is sent. */
  sender: EmailSender | null
  brand: MailBrand
  /** Told when a send fails or there is no proven address; gets no address. */
  log: (line: string) => void
}

/**
 * Mails the day the account goes to the person's first proven address, while the request still
 * waits. An address nobody proved gets nothing: whoever squats it must not learn about the account.
 * A failed send throws, so the job is retried.
 */
export function accountDeletionMailJob(deps: AccountDeletionMailDeps): JobHandler {
  const { sql } = deps
  return async (event) => {
    if (!deps.sender) return
    const [request] = await sql<{ deleteAfter: Date; email: string | null }[]>`
      SELECT account_deletions.delete_after AS "deleteAfter", (
        SELECT auth_keys.proven_email FROM auth_keys
        WHERE auth_keys.user_id = account_deletions.user_id AND auth_keys.proven_email IS NOT NULL
        ORDER BY auth_keys.id
        LIMIT 1
      ) AS email
      FROM account_deletions
      WHERE account_deletions.id = ${event.aggregateId}
    `
    if (!request) return
    if (!request.email) {
      deps.log("warn: an account deletion mail was not sent: the account has no proven address")
      return
    }
    const result = await deps.sender.send(
      accountDeletionMail(deps.brand, { to: request.email, deleteAfter: request.deleteAfter }),
    )
    if (!result.ok) {
      deps.log("error: an account deletion mail was not sent and will be retried")
      throw new Error("account deletion mail not sent")
    }
  }
}
