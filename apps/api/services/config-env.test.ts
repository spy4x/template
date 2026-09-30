/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { createEnvReader } from "@spy4x/server/config"
import { readApiEnv } from "./config-env.ts"

const REQUIRED_ENV: Record<string, string> = {
  ENV: "dev",
  AUTH_COOKIE_SECRET: "test-only-cookie-secret-0123456789abcdef",
  AUTH_PEPPER: "test-only-pepper-0123456789abcdef",
  AUTH_TOTP: "test-only-totp",
  DEV_EMAIL: "dev@example.test",
  TIMEZONE: "UTC",
  RATE_LIMITER_WINDOW_MS: "1000",
  RATE_LIMITER_STRICT_LIMIT: "10",
  RATE_LIMITER_LIMIT: "10",
  RATE_LIMITER_OTP_WINDOW_MS: "1000",
  RATE_LIMITER_OTP_LIMIT: "10",
  DOMAIN: "app.localhost",
  KV_HOSTNAME: "kv",
  KV_PORT: "6379",
}

Deno.test("the API environment is refused without KV_PASSWORD, and the error names it", () => {
  expect(() => readApiEnv(createEnvReader(REQUIRED_ENV))).toThrow(`KV_PASSWORD`)
})

Deno.test("the API environment is refused when KV_PASSWORD is blank", () => {
  expect(() => readApiEnv(createEnvReader({ ...REQUIRED_ENV, KV_PASSWORD: `` }))).toThrow(
    `KV_PASSWORD`,
  )
})

Deno.test("the API environment carries KV_PASSWORD through", () => {
  const env = readApiEnv(createEnvReader({ ...REQUIRED_ENV, KV_PASSWORD: `a-test-password` }))
  expect(env.KV_PASSWORD).toBe(`a-test-password`)
})
