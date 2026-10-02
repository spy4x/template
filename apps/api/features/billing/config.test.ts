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
  createPlanOf,
  FAKE_PRO_PRICE_ID,
  FAKE_WEBHOOK_SECRET,
  planClockOf,
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

    expect(setup).toEqual({ mode: BillingMode.Off, provider: null, graceDays: DEFAULT_GRACE_DAYS })
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
        },
        groups: { roleOf: () => Promise.resolve(GroupRole.OWNER) },
        provider: configured.provider,
        webAppUrl: "https://app.example.com",
        log: () => {},
        ...planClockOf(configured),
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
})
