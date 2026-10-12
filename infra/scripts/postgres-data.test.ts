/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { type PostgresDataFacts, postgresUpgradeRefusal } from "./postgres-data.ts"

const facts = (overrides: Partial<PostgresDataFacts>): PostgresDataFacts => ({
  oldDataExists: false,
  newDataExists: false,
  upgradeMarked: false,
  ...overrides,
})
const UNMOVED = facts({ oldDataExists: true })

Deno.test("deno task compose refuses to start the database beside unmoved Postgres 16 data", () => {
  for (const args of [["up", "-d", "--build"], ["start"], ["restart", "db"], ["run", "migrate"]]) {
    const refusal = postgresUpgradeRefusal(args, UNMOVED)
    expect({ args, refusal }).toEqual({ args, refusal: expect.stringContaining("Refusing to start") })
    expect(refusal).toContain("deno task db:upgrade-18")
  }
})

Deno.test("a failed upgrade's half-filled directory does not lift the refusal", () => {
  expect(postgresUpgradeRefusal(["up", "-d"], facts({ oldDataExists: true, newDataExists: true })))
    .toContain("Refusing to start")
})

Deno.test("deno task compose starts once the upgrade wrote its marker", () => {
  const upgraded = facts({ oldDataExists: true, newDataExists: true, upgradeMarked: true })
  expect(postgresUpgradeRefusal(["up", "-d"], upgraded)).toBeUndefined()
})

Deno.test("a machine with no Postgres 16 data is never refused", () => {
  expect(postgresUpgradeRefusal(["up", "-d"], facts({}))).toBeUndefined()
  expect(postgresUpgradeRefusal(["up", "-d"], facts({ newDataExists: true }))).toBeUndefined()
})

Deno.test("commands that start nothing run beside unmoved data", () => {
  for (const args of [["ps"], ["logs", "db"], ["stop"], ["down"], ["build"]]) {
    expect({ args, refusal: postgresUpgradeRefusal(args, UNMOVED) }).toEqual({
      args,
      refusal: undefined,
    })
  }
})
