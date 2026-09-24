/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { requireDbConnection } from "./db-connection.ts"

const DB_VARS = ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASS", "DB_NAME"] as const

/** Runs `body` with the given `DB_*` variables set (or deleted, for `undefined`), then restores. */
function withDbEnv(overrides: Partial<Record<typeof DB_VARS[number], string>>, body: () => void) {
  const previous = new Map(DB_VARS.map((name) => [name, Deno.env.get(name)]))
  try {
    for (const name of DB_VARS) {
      const value = overrides[name]
      if (value === undefined) Deno.env.delete(name)
      else Deno.env.set(name, value)
    }
    body()
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) Deno.env.delete(name)
      else Deno.env.set(name, value)
    }
  }
}

Deno.test("requireDbConnection names every DB_* variable when none are set", () => {
  withDbEnv({}, () => {
    expect(() => requireDbConnection()).toThrow(
      "integration test needs DB_HOST, DB_USER, DB_PASS, DB_NAME (recipe in HANDOFF.md)",
    )
  })
})

Deno.test("requireDbConnection names only the variables that are missing", () => {
  withDbEnv({ DB_HOST: "127.0.0.1", DB_NAME: "template_test" }, () => {
    expect(() => requireDbConnection()).toThrow(
      "integration test needs DB_USER, DB_PASS (recipe in HANDOFF.md)",
    )
  })
})

Deno.test("requireDbConnection returns settings once every variable is set", () => {
  withDbEnv(
    {
      DB_HOST: "127.0.0.1",
      DB_PORT: "5433",
      DB_USER: "tester",
      DB_PASS: "secret",
      DB_NAME: "template_test",
    },
    () => {
      expect(requireDbConnection()).toEqual({
        host: "127.0.0.1",
        port: 5433,
        user: "tester",
        pass: "secret",
        db: "template_test",
        connect_timeout: 5,
      })
    },
  )
})

Deno.test("requireDbConnection defaults DB_PORT to 5432", () => {
  withDbEnv(
    { DB_HOST: "127.0.0.1", DB_USER: "tester", DB_PASS: "secret", DB_NAME: "template_test" },
    () => {
      expect(requireDbConnection().port).toBe(5432)
    },
  )
})

Deno.test("requireDbConnection names a single missing variable", () => {
  withDbEnv({ DB_HOST: "127.0.0.1", DB_USER: "tester", DB_NAME: "template_test" }, () => {
    expect(() => requireDbConnection()).toThrow(
      "integration test needs DB_PASS (recipe in HANDOFF.md)",
    )
  })
})
