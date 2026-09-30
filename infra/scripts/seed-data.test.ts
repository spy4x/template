/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { readSeedOptions, SeedConfigError } from "./seed-data.ts"

const PEPPER = "p".repeat(32)

Deno.test("readSeedOptions accepts the API's pepper and a sign-up-sized password", () => {
  expect(readSeedOptions({ AUTH_PEPPER: PEPPER, SEED_PASSWORD: "12345678" })).toEqual({
    pepper: PEPPER,
    password: "12345678",
  })
})

Deno.test("readSeedOptions refuses a missing or short AUTH_PEPPER", () => {
  expect(() => readSeedOptions({ SEED_PASSWORD: "12345678" })).toThrow(SeedConfigError)
  expect(() => readSeedOptions({ AUTH_PEPPER: "p".repeat(31), SEED_PASSWORD: "12345678" }))
    .toThrow(/AUTH_PEPPER/)
})

Deno.test("readSeedOptions refuses a password sign-up would refuse", () => {
  for (const password of [undefined, "1234567", "x".repeat(51)]) {
    expect(() => readSeedOptions({ AUTH_PEPPER: PEPPER, SEED_PASSWORD: password }))
      .toThrow(/SEED_PASSWORD/)
  }
})

Deno.test("readSeedOptions refuses to seed when ENV is prod", () => {
  expect(() => readSeedOptions({ ENV: "prod", AUTH_PEPPER: PEPPER, SEED_PASSWORD: "12345678" }))
    .toThrow(new SeedConfigError("ENV is prod: the demo user is for development databases only"))
  expect(readSeedOptions({ ENV: "dev", AUTH_PEPPER: PEPPER, SEED_PASSWORD: "12345678" }).pepper)
    .toBe(PEPPER)
})
