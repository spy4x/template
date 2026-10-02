/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import {
  type BillingEvent,
  BillingEventType,
  type SubscriptionEvent,
  SubscriptionStatus,
} from "@spy4x/billing"
import { BILLING_EVENTS, PRO_PLAN_ID } from "@domain/billing"
import { PostgresBillingRepository } from "@server/billing/postgres-billing-repository.ts"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { requireDbConnection } from "./db-connection.ts"

/**
 * Webhook events applied to a real Postgres built from the migrations. Needs `DB_HOST`, `DB_USER`,
 * `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md); it fails when they are missing rather than
 * skipping.
 */

const MIGRATIONS_DIR = "libs/server/db/migrations"

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = requireDbConnection()
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `billing_test_${crypto.randomUUID().replaceAll("-", "")}`
  const sql = postgres({
    ...settings,
    max: 10,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    const names = [...Deno.readDirSync(MIGRATIONS_DIR)].map((entry) => entry.name).sort()
    for (const name of names) {
      await sql.unsafe(await Deno.readTextFile(`${MIGRATIONS_DIR}/${name}`))
    }
    await body(sql)
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
}

/** A new user and the group they own. */
async function seedGroup(sql: postgres.Sql): Promise<{ groupId: string; owner: number }> {
  const owner = (await sql<{ id: number }[]>`
    WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
    INSERT INTO users (id) SELECT id FROM auth_user RETURNING id
  `)[0].id
  const groupId = crypto.randomUUID()
  await new PostgresGroupRepository(sql).create({ id: groupId, name: "Team" }, owner)
  return { groupId, owner }
}

const T0 = new Date("2026-10-01T10:00:00Z")

function event(
  input: {
    id: string
    type?: SubscriptionEvent["type"]
    at?: Date
    reference?: string | null
    subscriptionId?: string
    customerId?: string
    status?: SubscriptionStatus
  },
): SubscriptionEvent {
  return {
    id: input.id,
    type: input.type ?? BillingEventType.SubscriptionCreated,
    occurredAt: input.at ?? T0,
    subscription: {
      id: input.subscriptionId ?? "sub_1",
      customerId: input.customerId ?? "cus_1",
      status: input.status ?? SubscriptionStatus.Active,
      planId: PRO_PLAN_ID,
      priceId: "price_pro",
      currentPeriodEnd: new Date("2026-11-01T10:00:00Z"),
      cancelAtPeriodEnd: false,
      trialEnd: null,
      reference: input.reference === undefined ? null : input.reference,
    },
  }
}

interface ChangeRow extends postgres.Row {
  eventKind: string
  actorUserId: number
}

async function planChanges(sql: postgres.Sql, groupId: string): Promise<ChangeRow[]> {
  return await sql<ChangeRow[]>`
    SELECT event_kind, actor_user_id FROM outbox_events
    WHERE group_id = ${groupId} AND event_kind LIKE 'group.plan.%'
    ORDER BY id
  `
}

async function nextSequence(sql: postgres.Sql, groupId: string): Promise<string> {
  return (await sql<{ next: string }[]>`
    SELECT next_change_sequence::text AS next FROM groups WHERE id = ${groupId}
  `)[0].next
}

Deno.test("billing events against Postgres", async (t) => {
  await withSchema(async (sql) => {
    const billing = new PostgresBillingRepository(sql)

    await t.step(
      "a checkout's subscription puts the group on its plan and writes one plan-changed event",
      async () => {
        const { groupId, owner } = await seedGroup(sql)

        const outcome = await billing.applyEvent(event({ id: "evt_a1", reference: groupId }))

        expect(outcome).toBe("applied")
        expect(await billing.get(groupId)).toMatchObject({
          planId: PRO_PLAN_ID,
          status: SubscriptionStatus.Active,
          providerSubscriptionId: "sub_1",
        })
        expect(await billing.customerOf(groupId)).toBe("cus_1")
        expect(await planChanges(sql, groupId)).toEqual([
          { eventKind: BILLING_EVENTS.planChanged, actorUserId: owner },
        ])
      },
    )

    await t.step("a second delivery of the same event changes nothing", async () => {
      const { groupId } = await seedGroup(sql)
      await billing.applyEvent(event({ id: "evt_b1", reference: groupId, customerId: "cus_b" }))
      const sequence = await nextSequence(sql, groupId)

      const again = await billing.applyEvent(
        event({
          id: "evt_b1",
          reference: groupId,
          customerId: "cus_b",
          type: BillingEventType.SubscriptionCanceled,
          status: SubscriptionStatus.Canceled,
          at: new Date(T0.getTime() + 60_000),
        }),
      )

      expect(again).toBe("duplicate")
      expect((await billing.get(groupId))?.status).toBe(SubscriptionStatus.Active)
      expect(await nextSequence(sql, groupId)).toBe(sequence)
      expect(await planChanges(sql, groupId)).toHaveLength(1)
    })

    await t.step("an event older than the stored one never rolls the plan back", async () => {
      const { groupId } = await seedGroup(sql)
      await billing.applyEvent(
        event({
          id: "evt_c2",
          reference: groupId,
          customerId: "cus_c",
          type: BillingEventType.SubscriptionUpdated,
          status: SubscriptionStatus.PastDue,
          at: new Date(T0.getTime() + 60_000),
        }),
      )

      const late = await billing.applyEvent(
        event({ id: "evt_c1", reference: groupId, customerId: "cus_c", at: T0 }),
      )

      expect(late).toBe("stale")
      expect((await billing.get(groupId))?.status).toBe(SubscriptionStatus.PastDue)
      expect(await planChanges(sql, groupId)).toHaveLength(1)
    })

    await t.step(
      "within one second, a creation arriving after the cancellation does not revive it",
      async () => {
        const { groupId } = await seedGroup(sql)
        await billing.applyEvent(
          event({
            id: "evt_d2",
            reference: groupId,
            customerId: "cus_d",
            type: BillingEventType.SubscriptionCanceled,
            status: SubscriptionStatus.Canceled,
          }),
        )

        const late = await billing.applyEvent(
          event({ id: "evt_d1", reference: groupId, customerId: "cus_d" }),
        )

        expect(late).toBe("stale")
        expect((await billing.get(groupId))?.status).toBe(SubscriptionStatus.Canceled)
      },
    )

    await t.step(
      "a later event without the checkout's reference finds the group by its customer",
      async () => {
        const { groupId } = await seedGroup(sql)
        await billing.applyEvent(event({ id: "evt_e1", reference: groupId, customerId: "cus_e" }))

        const outcome = await billing.applyEvent(
          event({
            id: "evt_e2",
            reference: null,
            customerId: "cus_e",
            type: BillingEventType.SubscriptionCanceled,
            status: SubscriptionStatus.Canceled,
            at: new Date(T0.getTime() + 60_000),
          }),
        )

        expect(outcome).toBe("applied")
        expect((await billing.get(groupId))?.status).toBe(SubscriptionStatus.Canceled)
      },
    )

    await t.step(
      "the end of a group's old subscription does not end the new one that replaced it",
      async () => {
        const { groupId } = await seedGroup(sql)
        await billing.applyEvent(
          event({
            id: "evt_f1",
            reference: groupId,
            customerId: "cus_f",
            subscriptionId: "sub_new",
          }),
        )

        const outcome = await billing.applyEvent(
          event({
            id: "evt_f2",
            reference: groupId,
            customerId: "cus_f",
            subscriptionId: "sub_old",
            type: BillingEventType.SubscriptionCanceled,
            status: SubscriptionStatus.Canceled,
            at: new Date(T0.getTime() + 60_000),
          }),
        )

        expect(outcome).toBe("stale")
        expect(await billing.get(groupId)).toMatchObject({
          providerSubscriptionId: "sub_new",
          status: SubscriptionStatus.Active,
        })
      },
    )

    await t.step("an event that names no group of this app is kept and ignored", async () => {
      const outcome = await billing.applyEvent(
        event({ id: "evt_g1", reference: crypto.randomUUID(), customerId: "cus_unknown" }),
      )
      const payment: BillingEvent = {
        id: "evt_g2",
        type: BillingEventType.PaymentSucceeded,
        occurredAt: T0,
        payment: {
          invoiceId: "in_1",
          customerId: "cus_unknown",
          subscriptionId: null,
          amount: 900,
          currency: "EUR",
          decimals: 2,
        },
      }

      expect(outcome).toBe("ignored")
      expect(await billing.applyEvent(payment)).toBe("ignored")
      expect(await billing.applyEvent(payment)).toBe("duplicate")
    })

    await t.step(
      "a failure while applying rolls back the stored event id, so the retry applies in full",
      async () => {
        const { groupId } = await seedGroup(sql)
        await sql`
          ALTER TABLE billing_customers
          ADD CONSTRAINT test_refuse_customer CHECK (provider_customer_id <> 'cus_refused')
        `
        try {
          await expect(
            billing.applyEvent(
              event({ id: "evt_h1", reference: groupId, customerId: "cus_refused" }),
            ),
          ).rejects.toThrow()
        } finally {
          await sql`ALTER TABLE billing_customers DROP CONSTRAINT test_refuse_customer`
        }

        expect(await billing.get(groupId)).toBeNull()
        expect(
          await billing.applyEvent(
            event({ id: "evt_h1", reference: groupId, customerId: "cus_refused" }),
          ),
        ).toBe("applied")
      },
    )
  })
})
