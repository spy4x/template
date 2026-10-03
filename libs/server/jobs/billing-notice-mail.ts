import type postgres from "postgres"
import type { EmailSender } from "@spy4x/email/sender"
import {
  accessEndsAt,
  BillingNoticeKind,
  billingNoticeKindOf,
  findPlan,
  type StoredSubscription,
} from "@domain/billing"
import { trialNoticeAt } from "../billing/billing-notices.ts"
import { PostgresBillingRepository } from "../billing/postgres-billing-repository.ts"
import { billingNoticeMail, type MailBrand } from "../mail/mail.ts"
import type { JobHandler } from "./jobs.ts"

/** What a billing notice mail job needs. */
export interface BillingNoticeMailDeps {
  sql: postgres.Sql
  /** `null` when mail is off: nothing is sent. */
  sender: EmailSender | null
  brand: MailBrand
  /** Told when a send fails or the owner has no address; gets no address. */
  log: (line: string) => void
  /** The current time; tests pass a fixed one. */
  now?: () => Date
}

interface OwnerRow extends postgres.Row {
  name: string
  email: string | null
}

/**
 * Mails one notice of `kind` to the owner of the group the job names, when that notice is still in
 * force as the job runs: a trial that was converted, a payment that went through or a cancellation
 * that was undone sends nothing. A trial's notice is sent only by the job queued for the trial's
 * current end, so a trial whose end moved is told once. The owner's first proven address gets it.
 * A failed send throws, so the job is retried.
 *
 * The notice is judged at the job's run time, or later when it runs late, so a worker whose clock
 * is a little behind the database's still sends it.
 */
export function billingNoticeMailJob(
  kind: BillingNoticeKind,
  { sql, sender, brand, log, now = () => new Date() }: BillingNoticeMailDeps,
): JobHandler {
  const billing = new PostgresBillingRepository(sql)
  return async (event) => {
    if (!sender) return
    const groupId = event.aggregateId
    const runAt = Number(event.aggregateVersion)
    const subscription = await billing.get(groupId)
    if (!inForce(kind, subscription, new Date(Math.max(now().getTime(), runAt)), runAt)) return
    const [owner] = await sql<OwnerRow[]>`
      SELECT groups.name, (
        SELECT auth_keys.proven_email FROM auth_keys
        WHERE auth_keys.user_id = groups.owner_user_id AND auth_keys.proven_email IS NOT NULL
        ORDER BY auth_keys.id
        LIMIT 1
      ) AS email
      FROM groups
      WHERE groups.id = ${groupId} AND groups.deleted_at IS NULL
    `
    if (!owner) return
    if (!owner.email) {
      log("warn: a billing notice was not sent: the group's owner has no proven address")
      return
    }
    const result = await sender.send(billingNoticeMail(brand, {
      to: owner.email,
      kind,
      groupName: owner.name,
      planName: findPlan(subscription.planId ?? "")?.name ?? "paid",
      at: accessEndsAt(subscription) ?? new Date(runAt),
      link: new URL(`/groups/${encodeURIComponent(groupId)}`, brand.webAppUrl).href,
      planKept: subscription.everActive,
    }))
    if (!result.ok) {
      log("error: a billing notice mail was not sent and will be retried")
      throw new Error("billing notice mail not sent")
    }
  }
}

function inForce(
  kind: BillingNoticeKind,
  subscription: StoredSubscription | null,
  at: Date,
  runAt: number,
): subscription is StoredSubscription {
  if (billingNoticeKindOf(subscription, at) !== kind) return false
  if (kind !== BillingNoticeKind.TrialEnding) return true
  const trialEnd = subscription?.trialEnd ?? null
  return trialEnd !== null && trialNoticeAt(trialEnd).getTime() === runAt
}
