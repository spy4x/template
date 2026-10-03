import type postgres from "postgres"
import { BillingStatus } from "@domain/billing"
import { GroupError } from "@domain/groups"

interface HeldRow extends postgres.Row {
  status: BillingStatus
  cancelAtPeriodEnd: boolean
}

/**
 * The billing half of a transfer of ownership (#250), run in the transfer's transaction after the
 * group row is locked.
 *
 * - A subscription that still renews refuses the transfer (`SUBSCRIPTION_RENEWS`): the old owner
 *   cancels it in the billing portal first, so their card is never charged again for a group they
 *   no longer own. A subscription cancelled at its period's end, or one that has ended, passes.
 * - The group's provider customer is stamped as handed over: the app opens no portal for it any
 *   more, so the new owner never sees the old owner's card, address or invoices, and the new
 *   owner's checkout makes a customer of their own.
 *
 * The provider is not called: nothing here can charge anyone, and nothing needs to be undone if the
 * transfer rolls back.
 */
export async function handOverBilling(
  sql: postgres.TransactionSql,
  groupId: string,
): Promise<void> {
  const held = (
    await sql<HeldRow[]>`
      SELECT status, cancel_at_period_end FROM subscriptions WHERE group_id = ${groupId}
    `
  )[0]
  if (held && held.status !== BillingStatus.Canceled && !held.cancelAtPeriodEnd) {
    throw new GroupError(
      "SUBSCRIPTION_RENEWS",
      "Cancel the group's subscription in the billing portal before transferring it",
    )
  }
  await sql`
    UPDATE billing_customers SET handed_over_at = CURRENT_TIMESTAMP
    WHERE group_id = ${groupId} AND handed_over_at IS NULL
  `
}
