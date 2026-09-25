import { loadConfig } from "@spy4x/server/config"
import { type } from "arktype"

const envSchema = type({
  ENV: "'dev' | 'prod'",
  AUTH_COOKIE_SECRET: "string > 0",
  AUTH_PEPPER: "string > 0",
  AUTH_TOTP: "string > 0",
  DEV_EMAIL: "string > 0",
  TIMEZONE: "string > 0",
  RATE_LIMITER_WINDOW_MS: "string.integer.parse",
  RATE_LIMITER_STRICT_LIMIT: "string.integer.parse",
  RATE_LIMITER_LIMIT: "string.integer.parse",
  DOMAIN: "string > 0",
  KV_HOSTNAME: "string > 0",
  KV_PORT: "string.integer.parse",
})

const env = loadConfig(envSchema)
// loadConfig names a failing variable but not the rule it broke, so this one says it outright.
if (env.AUTH_COOKIE_SECRET.length < 32) {
  throw new Error("AUTH_COOKIE_SECRET must be at least 32 characters (openssl rand -hex 32)")
}

export class Config {
  env = env.ENV
  authCookieSecret = env.AUTH_COOKIE_SECRET
  authPepper = env.AUTH_PEPPER
  authTotp = env.AUTH_TOTP
  devEmail = env.DEV_EMAIL
  vapidKeysPath = "./vapid.json"
  timeZone = env.TIMEZONE
  authSaltRounds = 12 // balance between security and performance
  authSessionLength = 32
  authSessionDurationMin = 60 * 24 * 30 * 2 // 2 months
  rateLimiter = {
    windowMs: env.RATE_LIMITER_WINDOW_MS,
    strictLimit: env.RATE_LIMITER_STRICT_LIMIT,
    limit: env.RATE_LIMITER_LIMIT,
  }

  // Web App Configuration
  domain = env.DOMAIN
  webAppUrl = `http${this.isDev ? "" : "s"}://${this.domain}`

  kv = {
    hostname: env.KV_HOSTNAME,
    port: env.KV_PORT,
  }

  get isDev() {
    return this.env === "dev"
  }
  get isProd() {
    return this.env === "prod"
  }
}

export const config = new Config()
