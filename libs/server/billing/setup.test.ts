import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { createEnvReader, type EnvReader } from "@spy4x/server/config"
import { DEFAULT_GRACE_DAYS } from "@domain/billing"
import { DEV_PRO_PRICE_ID, DEV_WEBHOOK_SECRET } from "../../../e2e/fixtures/billing.ts"
import {
  BillingConfigError,
  BillingMode,
  createFakeBilling,
  FAKE_PRO_PRICE_ID,
  FAKE_WEBHOOK_SECRET,
  readBillingSetup,
} from "./setup.ts"

const STRIPE_KEYS = {
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
  STRIPE_PRICE_PRO: "price_placeholder",
}

/** The API's options: it verifies Stripe's webhooks. */
const API = { webhooks: true }
/** The worker's options: it changes subscriptions and verifies no webhook. */
const WORKER = { webhooks: false }

describe("billing configuration", () => {
  it("starts with billing off in production when no billing variable is set", () => {
    const setup = readBillingSetup(createEnvReader({}), "prod", API)

    expect(setup).toEqual({
      mode: BillingMode.Off,
      provider: null,
      graceDays: DEFAULT_GRACE_DAYS,
      trialRequiresCard: true,
    })
  })

  it("starts with the development provider in development when no billing variable is set", () => {
    const setup = readBillingSetup(createEnvReader({}), "dev", API)

    expect(setup.mode).toBe(BillingMode.Fake)
    expect(setup.provider).not.toBeNull()
  })

  it("stops a process that verifies webhooks when Stripe lacks a key, the webhook secret included", () => {
    const env = createEnvReader({
      BILLING_PROVIDER: "stripe",
      STRIPE_SECRET_KEY: "sk_test_x",
    })

    expect(() => readBillingSetup(env, "prod", API)).toThrow(
      new BillingConfigError(
        "BILLING_PROVIDER=stripe needs STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO (see docs/billing.md)",
      ),
    )
  })

  it("runs Stripe when it has every key", () => {
    const env = createEnvReader({ BILLING_PROVIDER: "stripe", ...STRIPE_KEYS })

    const setup = readBillingSetup(env, "prod", API)

    expect(setup.mode).toBe(BillingMode.Stripe)
    expect(setup.provider).not.toBeNull()
  })

  it("refuses the development provider in production", () => {
    const env = createEnvReader({ BILLING_PROVIDER: "fake" })

    expect(() => readBillingSetup(env, "prod", API)).toThrow(BillingConfigError)
  })

  it("refuses an unknown provider name", () => {
    const env = createEnvReader({ BILLING_PROVIDER: "paypal" })

    expect(() => readBillingSetup(env, "prod", API)).toThrow(BillingConfigError)
  })

  it("keeps billing off when asked to, even with Stripe's keys present", () => {
    const env = createEnvReader({ BILLING_PROVIDER: "off", ...STRIPE_KEYS })

    expect(readBillingSetup(env, "prod", API)).toMatchObject({
      mode: BillingMode.Off,
      provider: null,
    })
  })

  it("reads the grace period for failed payments in whole days, seven when unset or blank", () => {
    const days = (value?: string) =>
      readBillingSetup(
        createEnvReader(value === undefined ? {} : { BILLING_GRACE_DAYS: value }),
        "dev",
        API,
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

      expect(() => readBillingSetup(env, "prod", API)).toThrow(
        new BillingConfigError("BILLING_GRACE_DAYS must be a whole number of days from 0 to 90"),
      )
    }
  })

  it("reads whether a trial asks for a card, yes when unset or blank", () => {
    const requiresCard = (value?: string) =>
      readBillingSetup(
        createEnvReader(value === undefined ? {} : { BILLING_TRIAL_REQUIRES_CARD: value }),
        "dev",
        API,
      ).trialRequiresCard

    expect([requiresCard(), requiresCard(""), requiresCard("true"), requiresCard("false")])
      .toEqual([true, true, true, false])
  })

  it("stops start-up on a trial card setting that is not true or false", () => {
    for (const value of ["yes", "0", "FALSE", " false"]) {
      const env = createEnvReader({ BILLING_TRIAL_REQUIRES_CARD: value })

      expect(() => readBillingSetup(env, "prod", API)).toThrow(
        new BillingConfigError("BILLING_TRIAL_REQUIRES_CARD must be true or false"),
      )
    }
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

  describe("a process that verifies no webhook, as the worker", () => {
    it("runs Stripe on the secret key and the Pro price alone", () => {
      const env = createEnvReader({
        BILLING_PROVIDER: "stripe",
        STRIPE_SECRET_KEY: "sk_test_x",
        STRIPE_PRICE_PRO: "price_placeholder",
      })

      const setup = readBillingSetup(env, "prod", WORKER)

      expect(setup.mode).toBe(BillingMode.Stripe)
      expect(setup.provider).not.toBeNull()
    })

    it("stops start-up when Stripe lacks the secret key or the Pro price, naming each", () => {
      const env = createEnvReader({ BILLING_PROVIDER: "stripe", STRIPE_WEBHOOK_SECRET: "whsec_x" })

      expect(() => readBillingSetup(env, "prod", WORKER)).toThrow(
        new BillingConfigError(
          "BILLING_PROVIDER=stripe needs STRIPE_SECRET_KEY, STRIPE_PRICE_PRO (see docs/billing.md)",
        ),
      )
    })

    it("never reads the webhook secret, even when it is set", () => {
      const env = createEnvReader({ BILLING_PROVIDER: "stripe", ...STRIPE_KEYS })
      const read: string[] = []
      const recording: EnvReader = {
        ...env,
        get: (name: string) => {
          read.push(name)
          return env.get(name)
        },
      }

      readBillingSetup(recording, "prod", WORKER)

      expect(read).toContain("STRIPE_SECRET_KEY")
      expect(read).not.toContain("STRIPE_WEBHOOK_SECRET")
    })
  })
})
