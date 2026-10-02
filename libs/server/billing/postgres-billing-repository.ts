import type postgres from "postgres"
import {
  type BillingEvent,
  BillingEventType,
  type SubscriptionEvent,
  SubscriptionStatus,
} from "@spy4x/billing"
import {
  BILLING_EVENTS,
  type BillingApplyOutcome,
  type BillingRepository,
  type StoredSubscription,
} from "@domain/billing"
import type { GroupRole } from "@domain/groups"
import {
  GroupNotActiveError,
  lockActorRole,
  recordGroupChange,
} from "@server/groups/group-change-log.ts"

interface SubscriptionRow extends postgres.Row, StoredSubscription {}

interface CustomerRow extends postgres.Row {
  providerCustomerId: string
}

interface GroupOwnerRow extends postgres.Row {
  id: string
  ownerUserId: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * How events of one second are ordered. The provider stamps events in whole seconds, so a creation
 * and its first update can share one; a creation never follows an update, and nothing follows the
 * end of a subscription.
 */
const EVENT_RANK: Record<SubscriptionEvent["type"], number> = {
  [BillingEventType.SubscriptionCreated]: 1,
  [BillingEventType.SubscriptionUpdated]: 2,
  [BillingEventType.SubscriptionCanceled]: 3,
}

/**
 * Billing in Postgres: each group's subscription and customer, and every webhook event already
 * handled. It checks no role; the handlers decide who may call it, and the webhook is trusted only
 * after its signature passes.
 */
export class PostgresBillingRepository implements BillingRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async get(groupId: string): Promise<StoredSubscription | null> {
    const row = (
      await this.sql<SubscriptionRow[]>`
        SELECT
          group_id,
          provider_subscription_id,
          plan_id,
          status,
          current_period_end,
          cancel_at_period_end
        FROM subscriptions
        WHERE group_id = ${groupId}
      `
    )[0]
    return row
      ? {
        groupId: row.groupId,
        providerSubscriptionId: row.providerSubscriptionId,
        planId: row.planId,
        status: row.status,
        currentPeriodEnd: row.currentPeriodEnd,
        cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      }
      : null
  }

  /**
   * The actor's role through `lockActorRole`, in a transaction of its own. The transaction ends
   * before the caller talks to the provider, so no group lock is held over the network.
   */
  async lockedRoleOf(groupId: string, userId: number): Promise<GroupRole | null> {
    try {
      return await this.sql.begin((transaction: postgres.TransactionSql) =>
        lockActorRole(transaction, groupId, userId)
      )
    } catch (error) {
      if (error instanceof GroupNotActiveError) return null
      throw error
    }
  }

  async customerOf(groupId: string): Promise<string | null> {
    const row = (
      await this.sql<CustomerRow[]>`
        SELECT provider_customer_id FROM billing_customers WHERE group_id = ${groupId}
      `
    )[0]
    return row?.providerCustomerId ?? null
  }

  /**
   * Applies one verified webhook event in a single transaction: the event id is stored first, so a
   * second delivery finds it and changes nothing; then the group's subscription is replaced only
   * when the event is not older than the one it holds, and the change is recorded on the group
   * (`group.plan.changed` in the outbox). A failure rolls back the event id too, so the provider's
   * retry is applied in full.
   *
   * The group comes from the checkout's `reference` (the group id), or else from the customer an
   * earlier event stored. An event that names no group of this app is stored and ignored.
   */
  async applyEvent(event: BillingEvent): Promise<BillingApplyOutcome> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const stored = await transaction`
        INSERT INTO billing_events (id, event_type) VALUES (${event.id}, ${event.type})
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `
      if (stored.length === 0) return "duplicate"
      if (!isSubscriptionEvent(event)) return "ignored"

      const group = await findGroup(transaction, event)
      if (!group) return "ignored"

      const subscription = event.subscription
      const rank = EVENT_RANK[event.type]
      // A different subscription than the one held takes over only while it is alive: the end of an
      // old subscription must not end the new one that replaced it.
      const replaces = subscription.status !== SubscriptionStatus.Canceled
      const before = (
        await transaction<{ planId: string | null; status: number }[]>`
          SELECT plan_id, status FROM subscriptions WHERE group_id = ${group.id} FOR UPDATE
        `
      )[0]
      const written = await transaction`
        INSERT INTO subscriptions (
          group_id,
          provider_subscription_id,
          plan_id,
          status,
          current_period_end,
          cancel_at_period_end,
          provider_event_at,
          provider_event_rank
        ) VALUES (
          ${group.id},
          ${subscription.id},
          ${subscription.planId},
          ${subscription.status},
          ${subscription.currentPeriodEnd},
          ${subscription.cancelAtPeriodEnd},
          ${event.occurredAt},
          ${rank}
        )
        ON CONFLICT (group_id) DO UPDATE SET
          provider_subscription_id = EXCLUDED.provider_subscription_id,
          plan_id = EXCLUDED.plan_id,
          status = EXCLUDED.status,
          current_period_end = EXCLUDED.current_period_end,
          cancel_at_period_end = EXCLUDED.cancel_at_period_end,
          provider_event_at = EXCLUDED.provider_event_at,
          provider_event_rank = EXCLUDED.provider_event_rank,
          updated_at = CURRENT_TIMESTAMP
        WHERE (subscriptions.provider_event_at, subscriptions.provider_event_rank)
            <= (EXCLUDED.provider_event_at, EXCLUDED.provider_event_rank)
          AND (subscriptions.provider_subscription_id = EXCLUDED.provider_subscription_id
            OR ${replaces})
        RETURNING group_id
      `
      if (written.length === 0) return "stale"

      // One customer pays for one group. A customer another group already holds stays with it, so
      // an event naming it is still applied instead of failing on the unique index forever.
      await transaction`
        INSERT INTO billing_customers (group_id, provider_customer_id)
        SELECT ${group.id}, ${subscription.customerId}
        WHERE NOT EXISTS (
          SELECT 1 FROM billing_customers
          WHERE provider_customer_id = ${subscription.customerId} AND group_id <> ${group.id}
        )
        ON CONFLICT (group_id) DO UPDATE SET provider_customer_id = EXCLUDED.provider_customer_id
      `
      // Only a new plan or status is news to the group's pages; a renewal that moves the period's end
      // is not. The owner pays, so the change is theirs; a deleted group still records it, so a
      // restore shows the plan the provider reported meanwhile.
      const changed = before === undefined || before.planId !== subscription.planId ||
        before.status !== subscription.status
      if (!changed) return "applied"
      await recordGroupChange(
        transaction,
        group.id,
        group.ownerUserId,
        BILLING_EVENTS.planChanged,
        {
          allowDeleted: true,
        },
      )
      return "applied"
    })
  }
}

function isSubscriptionEvent(event: BillingEvent): event is SubscriptionEvent {
  return "subscription" in event
}

async function findGroup(
  sql: postgres.Sql,
  event: SubscriptionEvent,
): Promise<GroupOwnerRow | null> {
  const reference = event.subscription.reference
  if (reference !== null && UUID.test(reference)) {
    const row = (
      await sql<GroupOwnerRow[]>`SELECT id, owner_user_id FROM groups WHERE id = ${reference}`
    )[0]
    if (row) return row
  }
  const row = (
    await sql<GroupOwnerRow[]>`
      SELECT groups.id, groups.owner_user_id
      FROM billing_customers
      JOIN groups ON groups.id = billing_customers.group_id
      WHERE billing_customers.provider_customer_id = ${event.subscription.customerId}
    `
  )[0]
  return row ?? null
}
