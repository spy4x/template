import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { createEnvReader } from "@spy4x/server/config"
import { DEFAULT_GRACE_DAYS } from "@domain/billing"
import { DEV_PRO_PRICE_ID, DEV_WEBHOOK_SECRET } from "../../../../e2e/fixtures/billing.ts"
import {
  BillingConfigError,
  BillingMode,
  FAKE_PRO_PRICE_ID,
  FAKE_WEBHOOK_SECRET,
  readBillingSetup,
} from "./config.ts"

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

  it("shares its webhook secret and Pro price with the e2e fixture that signs events", () => {
    expect([FAKE_WEBHOOK_SECRET, FAKE_PRO_PRICE_ID]).toEqual([DEV_WEBHOOK_SECRET, DEV_PRO_PRICE_ID])
  })
})
