/// <reference lib="deno.ns" />

const REQUIRED_DB_ENV = ["DB_HOST", "DB_USER", "DB_PASS", "DB_NAME"] as const

export interface DbConnectionSettings {
  host: string
  port: number
  user: string
  pass: string
  db: string
  connect_timeout: number
}

/**
 * Postgres connection settings for the integration tier, read from `DB_HOST`, `DB_PORT`,
 * `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in HANDOFF.md). Throws, naming every variable that
 * is missing, instead of letting a test mark itself `ignore` or silently connect to whatever
 * Postgres the shell's own environment happens to point at.
 *
 * `connect_timeout` is pinned to 5 seconds: the driver's own default took 60 seconds to report
 * an unreachable host in testing, which reads as a hang in a test run.
 */
export function requireDbConnection(): DbConnectionSettings {
  const missing = REQUIRED_DB_ENV.filter((name) => !Deno.env.get(name))
  if (missing.length) {
    throw new Error(`integration test needs ${missing.join(", ")} (recipe in HANDOFF.md)`)
  }
  return {
    host: Deno.env.get("DB_HOST")!,
    port: Number(Deno.env.get("DB_PORT") || "5432"),
    user: Deno.env.get("DB_USER")!,
    pass: Deno.env.get("DB_PASS")!,
    db: Deno.env.get("DB_NAME")!,
    connect_timeout: 5,
  }
}
