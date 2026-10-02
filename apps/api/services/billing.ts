import { systemEnv } from "@spy4x/server/config"
import { readBillingSetup } from "../features/billing/config.ts"
import { config } from "./config.ts"

/**
 * The payment provider this process runs with, read once at start-up: a billing setup that cannot
 * run (`BILLING_PROVIDER=stripe` without its keys) stops the API here, before it serves a request.
 */
export const billingSetup = readBillingSetup(systemEnv, config.isDev ? "dev" : "prod")
