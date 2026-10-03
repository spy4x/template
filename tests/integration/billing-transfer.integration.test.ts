/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import type postgres from "postgres"
import {
  BillingEventType,
  type BillingProvider,
  type CheckoutRequest,
  type PortalRequest,
  type SubscriptionEvent,
  SubscriptionStatus,
} from "@spy4x/billing"
import {
  BillingCheckoutCommand,
  BillingError,
  BillingGetQuery,
  BillingPortalCommand,
  PRO_PLAN_ID,
} from "@domain/billing"
import { GroupError } from "@domain/groups"
import { PostgresBillingRepository } from "@server/billing/postgres-billing-repository.ts"
import { queueSeatDrift, queueSeatSync, SEAT_SYNC_JOB } from "@server/billing/seat-sync.ts"
import { createOutboxProcessor } from "@server/jobs/wiring.ts"
import {
  type BillingHandlerDependencies,
  createBillingCheckoutHandler,
  createBillingGetHandler,
  createBillingPortalHandler,
} from "../../apps/api/features/billing/handlers.ts"
import { team, withSchema } from "./group-team.ts"

/**
 * A transfer of ownership of a subscribed group (#250) against a real Postgres built from
 * schema.sql: the billing handlers and the webhook repository the API uses, the worker's outbox
 * processor, and a provider that only records what it is asked. Needs "DB_HOST", "DB_USER",
 * "DB_PASS" and "DB_NAME" (recipe in docs/handoff.md); it fails when they are missing.
 */

const DAY = 24 * 60 * 60 * 1000
/** The handlers' clock: the old owner's paid period ends ten days and a half later. */
const NOW = new Date("2026-10-01T10:00:00Z")
const PERIOD_END = new Date(NOW.getTime() + 10.5 * DAY)

/** A provider that records every call and answers each one. */
function recordingProvider() {
  const checkouts: CheckoutRequest[] = []
  const portals: PortalRequest[] = []
  const seatChanges: string[] = []
  const provider = {
    createCheckout(request: CheckoutRequest) {
      checkouts.push(request)
      return Promise.resolve({ ok: true, value: { id: "cs_1", url: "https://pay.example/cs" } })
    },
    createPortalSession(request: PortalRequest) {
      portals.push(request)
      return Promise.resolve({ ok: true, value: { id: "bps_1", url: "https://pay.example/p" } })
    },
    updateQuantity(request: { subscriptionId: string }) {
      seatChanges.push(request.subscriptionId)
      return Promise.reject(new Error("the old owner's subscription must not be changed"))
    },
  } as unknown as BillingProvider
  return { provider, checkouts, portals, seatChanges }
}

let eventCount = 0

/** A webhook event of one subscription, one second after the last, as Stripe would send it. */
function subscriptionEvent(
  groupId: string,
  input: {
    type?: SubscriptionEvent["type"]
    subscriptionId: string
    customerId: string
    status?: SubscriptionStatus
    cancelAtPeriodEnd?: boolean
    trialEnd?: Date | null
    quantity: number
  },
): SubscriptionEvent {
  eventCount++
  return {
    id: `evt_transfer_${eventCount}`,
    type: input.type ?? BillingEventType.SubscriptionUpdated,
    occurredAt: new Date(NOW.getTime() - DAY + eventCount * 1000),
    subscription: {
      id: input.subscriptionId,
      customerId: input.customerId,
      status: input.status ?? SubscriptionStatus.Active,
      planId: PRO_PLAN_ID,
      priceId: "price_pro",
      currentPeriodEnd: PERIOD_END,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
      trialEnd: input.trialEnd ?? null,
      quantity: input.quantity,
      reference: groupId,
    },
  }
}

async function refusal(write: Promise<unknown>): Promise<string> {
  try {
    await write
  } catch (error) {
    if (error instanceof GroupError || error instanceof BillingError) return error.code
    throw error
  }
  throw new Error("The write was not refused")
}

async function ownerOf(sql: postgres.Sql, groupId: string): Promise<number> {
  return (await sql<{ ownerUserId: number }[]>`
    SELECT owner_user_id FROM groups WHERE id = ${groupId}
  `)[0].ownerUserId
}

/** Seat syncs of the group the worker has run. */
async function syncsRun(sql: postgres.Sql, groupId: string): Promise<number> {
  return (await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM outbox_events
    WHERE event_kind = ${SEAT_SYNC_JOB} AND aggregate_id = ${groupId} AND processed_at IS NOT NULL
  `)[0].count
}

const NO_MAIL = {
  store: {} as never,
  sender: { send: () => Promise.reject(new Error("no mail in these tests")) },
  brand: { webAppUrl: "http://app.localhost" },
  log: () => {},
}

Deno.test("transfer of a subscribed group moves its billing to the new owner", async (t) => {
  await withSchema(async (sql) => {
    const billing = new PostgresBillingRepository(sql)
    const { provider, checkouts, portals, seatChanges } = recordingProvider()
    const { repository, groupId, owner, admin, viewer } = await team(sql)
    const dependencies: BillingHandlerDependencies = {
      billing,
      groups: {
        roleOf: async (id, userId) => (await repository.getForMember(id, userId))?.role ?? null,
      },
      provider,
      webAppUrl: "https://app.example.com",
      log: () => {},
      graceDays: 7,
      trialRequiresCard: true,
      now: () => NOW,
    }
    const checkout = createBillingCheckoutHandler(dependencies)
    const portal = createBillingPortalHandler(dependencies)
    const read = createBillingGetHandler(dependencies)
    const actor = (userId: number) => ({ userId }) as BillingGetQuery["data"]["actor"]
    const checkoutAs = (userId: number) =>
      checkout(new BillingCheckoutCommand({ groupId, actor: actor(userId), planId: PRO_PLAN_ID }))
    const portalAs = (userId: number) =>
      portal(new BillingPortalCommand({ groupId, actor: actor(userId) }))
    const readAs = async (userId: number) =>
      (await read(new BillingGetQuery({ groupId, actor: actor(userId) }))).billing
    // Owner, admin, editor, viewer and "onlyHere": five members, five seats.
    const old = { subscriptionId: "sub_old", customerId: "cus_old", quantity: 5 }
    await billing.applyEvent(
      subscriptionEvent(groupId, { ...old, type: BillingEventType.SubscriptionCreated }),
    )

    await t.step("a subscription that still renews refuses the transfer", async () => {
      expect(await refusal(repository.transferOwnership(groupId, admin, owner)))
        .toBe("SUBSCRIPTION_RENEWS")
      expect(await ownerOf(sql, groupId)).toBe(owner)
      expect(await billing.customerOf(groupId)).toBe("cus_old")
    })

    await t.step(
      "once the old owner cancels it at its period's end, the transfer goes through",
      async () => {
        await billing.applyEvent(subscriptionEvent(groupId, { ...old, cancelAtPeriodEnd: true }))

        expect(await repository.transferOwnership(groupId, admin, owner)).toBe(true)

        expect(await ownerOf(sql, groupId)).toBe(admin)
        expect(await billing.handedOver(groupId)).toBe(true)
        expect(await billing.customerOf(groupId)).toBeNull()
      },
    )

    await t.step(
      "the new owner keeps the plan but never reaches the old owner's customer",
      async () => {
        expect(await readAs(admin)).toMatchObject({
          planId: PRO_PLAN_ID,
          canManage: true,
          subscribed: false,
          hasCustomer: false,
          notice: null,
        })
        expect(await refusal(portalAs(admin))).toBe("NO_SUBSCRIPTION")
        expect(portals).toEqual([])
      },
    )

    await t.step("the old owner, now an admin, manages billing no more", async () => {
      expect(await refusal(portalAs(owner))).toBe("ROLE_INSUFFICIENT")
      expect(await refusal(checkoutAs(owner))).toBe("ROLE_INSUFFICIENT")
      expect(portals).toEqual([])
      expect(checkouts).toEqual([])
    })

    await t.step("a member who leaves changes nothing on the old owner's bill", async () => {
      const processor = createOutboxProcessor(sql, NO_MAIL, provider)

      expect(await repository.leave(groupId, viewer)).toBe(true)
      // The leave queues a seat sync when the worker publishes it; the nightly drift check queues
      // none for a handed-over subscription, and a sync queued anyway changes nothing.
      expect(await queueSeatDrift(sql, NOW)).toBe(0)
      await queueSeatSync(sql, groupId)
      for (let round = 0; round < 3; round++) {
        expect((await processor.drainOnce()).failed).toBe(0)
      }

      expect(await syncsRun(sql, groupId)).toBeGreaterThanOrEqual(2)
      expect(seatChanges).toEqual([])
    })

    await t.step("the old subscription's own events keep its customer handed over", async () => {
      await billing.applyEvent(subscriptionEvent(groupId, { ...old, cancelAtPeriodEnd: true }))

      expect(await billing.handedOver(groupId)).toBe(true)
      expect(await billing.customerOf(groupId)).toBeNull()
    })

    await t.step(
      "the new owner checks out with a customer of their own, first charged when the old period ends",
      async () => {
        const { url } = await checkoutAs(admin)

        expect(url).toBe("https://pay.example/cs")
        expect(checkouts).toHaveLength(1)
        expect(checkouts[0]).not.toHaveProperty("customerId")
        expect(checkouts[0]).not.toHaveProperty("trialWithoutPaymentMethod")
        // Ten days and a half left of the old owner's period: eleven whole days.
        expect(checkouts[0].trialDays).toBe(11)
      },
    )

    await t.step(
      "the new owner's subscription takes over, and the old one's end leaves it alone",
      async () => {
        const fresh = { subscriptionId: "sub_new", customerId: "cus_new", quantity: 4 }
        await billing.applyEvent(subscriptionEvent(groupId, {
          ...fresh,
          type: BillingEventType.SubscriptionCreated,
          status: SubscriptionStatus.Trialing,
          trialEnd: new Date(NOW.getTime() + 11 * DAY),
        }))

        expect(await billing.customerOf(groupId)).toBe("cus_new")
        expect(await billing.handedOver(groupId)).toBe(false)
        expect(await readAs(admin)).toMatchObject({
          planId: PRO_PLAN_ID,
          subscribed: true,
          hasCustomer: true,
        })

        const ended = await billing.applyEvent(subscriptionEvent(groupId, {
          ...old,
          type: BillingEventType.SubscriptionCanceled,
          status: SubscriptionStatus.Canceled,
          cancelAtPeriodEnd: true,
        }))

        expect(ended).toBe("stale")
        expect((await billing.get(groupId))?.providerSubscriptionId).toBe("sub_new")
        expect(await billing.customerOf(groupId)).toBe("cus_new")
      },
    )
  })
})
