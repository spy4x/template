import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { createEnvReader } from "@spy4x/server/config"
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

    expect(setup).toEqual({ mode: BillingMode.Off, provider: null })
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

    expect(readBillingSetup(env, "prod")).toEqual({ mode: BillingMode.Off, provider: null })
  })

  it("shares its webhook secret and Pro price with the e2e fixture that signs events", () => {
    expect([FAKE_WEBHOOK_SECRET, FAKE_PRO_PRICE_ID]).toEqual([DEV_WEBHOOK_SECRET, DEV_PRO_PRICE_ID])
  })
})
