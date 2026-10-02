/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { BillingEventType, createStripeBilling } from "@spy4x/billing"
import {
  DEV_PRO_PRICE_ID,
  DEV_WEBHOOK_SECRET,
  stripeSignature,
  subscriptionEvent,
} from "./billing.ts"

Deno.test("subscriptionEvent is signed so that the Stripe adapter accepts it as the event it names", async () => {
  const stripe = createStripeBilling({
    secretKey: "sk_test_unused",
    webhookSecret: DEV_WEBHOOK_SECRET,
    plans: [{ planId: "pro", priceId: DEV_PRO_PRICE_ID }],
    fetch: () => Promise.reject(new Error("no network")),
  })
  const body = subscriptionEvent({
    eventId: "evt_9",
    reference: "group-1",
    type: "customer.subscription.updated",
    status: "past_due",
  })

  const parsed = await stripe.parseEvent(new TextEncoder().encode(body), {
    "Stripe-Signature": await stripeSignature(body),
  })

  expect(parsed).toMatchObject({
    ok: true,
    event: {
      id: "evt_9",
      type: BillingEventType.SubscriptionUpdated,
      subscription: { reference: "group-1", planId: "pro", status: 3 },
    },
  })
})
