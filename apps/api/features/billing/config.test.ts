import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { createEnvReader } from "@spy4x/server/config"
import { GroupRole } from "@domain/groups"
import {
  BillingGetQuery,
  BillingStatus,
  DEFAULT_GRACE_DAYS,
  type StoredSubscription,
} from "@domain/billing"
import { DEV_PRO_PRICE_ID, DEV_WEBHOOK_SECRET } from "../../../../e2e/fixtures/billing.ts"
import {
  BillingConfigError,
  BillingMode,
  billingSettingsOf,
  createFakeBilling,
  createPlanOf,
  createSeatPriced,
  FAKE_PRO_PRICE_ID,
  FAKE_WEBHOOK_SECRET,
  readBillingSetup,
} from "./config.ts"
import { createBillingGetHandler } from "./handlers.ts"

const STRIPE_KEYS = {
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
  STRIPE_PRICE_PRO: "price_placeholder",
}

describe("billing configuration", () => {
  it("starts with billing off in production when no billing variable is set", () => {
    const setup = readBillingSetup(createEnvReader({}), "prod")

    expect(setup).toEqual({
      mode: BillingMode.Off,
      provider: null,
      graceDays: DEFAULT_GRACE_DAYS,
      trialRequiresCard: true,
    })
  })

  it("starts with the development provider in development when no billing variable is set", () => {
    const setup = readBillingSetup(createEnvReader({}), "dev")

    expect(setup.mode).toBe(BillingMode.Fake)
    expect(setup.provider).not.toBeNull()
  })

  it("stops start-up when Stripe is asked for without its keys, naming each missing one", () => {
    const env = createEnvReader({
      BILLING_PROVIDER: "stripe",
      STRIPE_SECRET_KEY: "sk_test_x",
    })

    expect(() => readBillingSetup(env, "prod")).toThrow(
      new BillingConfigError(
        "BILLING_PROVIDER=stripe needs STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO (see docs/billing.md)",
      ),
    )
  })

  it("runs Stripe when it has every key", () => {
    const env = createEnvReader({ BILLING_PROVIDER: "stripe", ...STRIPE_KEYS })

    const setup = readBillingSetup(env, "prod")

    expect(setup.mode).toBe(BillingMode.Stripe)
    expect(setup.provider).not.toBeNull()
  })

  it("refuses the development provider in production", () => {
    const env = createEnvReader({ BILLING_PROVIDER: "fake" })

    expect(() => readBillingSetup(env, "prod")).toThrow(BillingConfigError)
  })

  it("refuses an unknown provider name", () => {
    const env = createEnvReader({ BILLING_PROVIDER: "paypal" })

    expect(() => readBillingSetup(env, "prod")).toThrow(BillingConfigError)
  })

  it("keeps billing off when asked to, even with Stripe's keys present", () => {
    const env = createEnvReader({ BILLING_PROVIDER: "off", ...STRIPE_KEYS })

    expect(readBillingSetup(env, "prod")).toMatchObject({ mode: BillingMode.Off, provider: null })
  })

  it("reads the grace period for failed payments in whole days, seven when unset or blank", () => {
    const days = (value?: string) =>
      readBillingSetup(
        createEnvReader(value === undefined ? {} : { BILLING_GRACE_DAYS: value }),
        "dev",
      )
        .graceDays

    expect(days()).toBe(7)
    expect(days("")).toBe(7)
    expect(days("0")).toBe(0)
    expect(days("14")).toBe(14)
    expect(days("90")).toBe(90)
  })

  it("stops start-up on a grace period that is not a whole number of days from 0 to 90", () => {
    for (const value of ["-1", "1.5", "7d", "91", "1e1", " 7"]) {
      const env = createEnvReader({ BILLING_GRACE_DAYS: value })

      expect(() => readBillingSetup(env, "prod")).toThrow(
        new BillingConfigError("BILLING_GRACE_DAYS must be a whole number of days from 0 to 90"),
      )
    }
  })

  it("reads whether a trial asks for a card, yes when unset or blank", () => {
    const requiresCard = (value?: string) =>
      readBillingSetup(
        createEnvReader(value === undefined ? {} : { BILLING_TRIAL_REQUIRES_CARD: value }),
        "dev",
      ).trialRequiresCard

    expect([requiresCard(), requiresCard(""), requiresCard("true"), requiresCard("false")])
      .toEqual([true, true, true, false])
  })

  it("stops start-up on a trial card setting that is not true or false", () => {
    for (const value of ["yes", "0", "FALSE", " false"]) {
      const env = createEnvReader({ BILLING_TRIAL_REQUIRES_CARD: value })

      expect(() => readBillingSetup(env, "prod")).toThrow(
        new BillingConfigError("BILLING_TRIAL_REQUIRES_CARD must be true or false"),
      )
    }
  })

  it("hands the billing handlers the trial card setting the setup read", () => {
    const settings = (value: string) =>
      billingSettingsOf(
        readBillingSetup(createEnvReader({ BILLING_TRIAL_REQUIRES_CARD: value }), "dev"),
      )

    expect(settings("false").trialRequiresCard).toBe(false)
    expect(settings("true").trialRequiresCard).toBe(true)
  })

  describe("the API's plan clock, as the command bus and the billing read are wired", () => {
    const DAY = 24 * 60 * 60 * 1000
    const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
    /** A Pro subscription whose first payment failed `days` days before the system clock's now. */
    const pastDue = (days: number) => ({
      get: () =>
        Promise.resolve<StoredSubscription>({
          groupId,
          providerSubscriptionId: "sub_1",
          planId: "pro",
          status: BillingStatus.PastDue,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          pastDueSince: new Date(Date.now() - days * DAY),
          trialEnd: null,
          quantity: 1,
          everActive: true,
        }),
    })
    const setup = (graceDays?: string) =>
      readBillingSetup(
        createEnvReader(graceDays === undefined ? {} : { BILLING_GRACE_DAYS: graceDays }),
        "dev",
      )
    const billingRead = async (days: number, graceDays?: string) => {
      const configured = setup(graceDays)
      const handler = createBillingGetHandler({
        billing: {
          ...pastDue(days),
          lockedRoleOf: () => Promise.resolve(null),
          customerOf: () => Promise.resolve("cus_1"),
          membersOf: () => Promise.resolve(1),
          handedOver: () => Promise.resolve(false),
        },
        groups: { roleOf: () => Promise.resolve(GroupRole.OWNER) },
        provider: configured.provider,
        webAppUrl: "https://app.example.com",
        log: () => {},
        ...billingSettingsOf(configured),
      })
      const actor = { userId: 1 } as BillingGetQuery["data"]["actor"]
      return (await handler(new BillingGetQuery({ actor, groupId }))).billing.planId
    }

    it("gives the plan check the free plan for a group past due for eight days", async () => {
      expect(await createPlanOf(pastDue(8), setup())(groupId)).toBe("free")
      expect(await createPlanOf(pastDue(1), setup())(groupId)).toBe("pro")
    })

    it("gives the plan check the grace period the setup read", async () => {
      expect(await createPlanOf(pastDue(8), setup("10"))(groupId)).toBe("pro")
    })

    it("shows the billing read the free plan for a group past due for eight days", async () => {
      expect(await billingRead(8)).toBe("free")
      expect(await billingRead(1)).toBe("pro")
      expect(await billingRead(8, "10")).toBe("pro")
    })
  })

  it("shares its webhook secret and Pro price with the e2e fixture that signs events", () => {
    expect([FAKE_WEBHOOK_SECRET, FAKE_PRO_PRICE_ID]).toEqual([DEV_WEBHOOK_SECRET, DEV_PRO_PRICE_ID])
  })

  it("answers a seat change in development with the asked quantity on the Pro plan", async () => {
    const result = await createFakeBilling("price_dev").updateQuantity({
      subscriptionId: "sub_dev",
      quantity: 4,
      idempotencyKey: "seats:1:4",
    })

    expect(result).toMatchObject({
      ok: true,
      value: { id: "sub_dev", quantity: 4, planId: "pro", priceId: "price_dev" },
    })
  })

  describe("the price confirmation a new invitation needs", () => {
    const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
    const subscription = (planId: string, status: BillingStatus): StoredSubscription => ({
      groupId,
      providerSubscriptionId: "sub_1",
      planId,
      status,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      pastDueSince: null,
      trialEnd: null,
      quantity: 2,
      everActive: true,
    })
    const seatPriced = (
      stored: StoredSubscription | null,
      role: GroupRole | null,
      enabled = true,
    ) =>
      createSeatPriced(
        { get: () => Promise.resolve(stored) },
        () => Promise.resolve(role),
        enabled,
      )(groupId, 1)

    it("asks the owner and an admin of a group on a live per-member plan", async () => {
      const pro = subscription("pro", BillingStatus.Active)
      expect(await seatPriced(pro, GroupRole.OWNER)).toBe(true)
      expect(await seatPriced(pro, GroupRole.ADMIN)).toBe(true)
      expect(await seatPriced(subscription("pro", BillingStatus.PastDue), GroupRole.OWNER))
        .toBe(true)
    })

    it("asks nobody when billing is off, the group pays nothing or the plan is canceled", async () => {
      const pro = subscription("pro", BillingStatus.Active)
      expect(await seatPriced(pro, GroupRole.OWNER, false)).toBe(false)
      expect(await seatPriced(null, GroupRole.OWNER)).toBe(false)
      expect(await seatPriced(subscription("pro", BillingStatus.Canceled), GroupRole.OWNER))
        .toBe(false)
    })

    it("tells a viewer, an editor or a stranger nothing of the group's bill", async () => {
      const pro = subscription("pro", BillingStatus.Active)
      expect(await seatPriced(pro, GroupRole.EDITOR)).toBe(false)
      expect(await seatPriced(pro, GroupRole.VIEWER)).toBe(false)
      expect(await seatPriced(pro, null)).toBe(false)
    })
  })
})
