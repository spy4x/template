import { Hono } from "hono"

interface HealthChecks {
  isDbConnected: () => Promise<boolean>
  isCacheConnected: () => Promise<boolean>
}

/**
 * `GET /` reports the database and the cache. With the database down it answers 503 and
 * `status: "down"`: nothing works. With only Valkey down it stays 200 and says `"degraded"`: the
 * API still serves from Postgres, and a container restart would not bring Valkey back.
 */
export function createHealthRoute(checks: HealthChecks): Hono {
  return new Hono().get("/", async (c) => {
    const [isDbConnected, isCacheConnected] = await Promise.all([
      checks.isDbConnected(),
      checks.isCacheConnected(),
    ])
    const status = !isDbConnected ? "down" : isCacheConnected ? "ok" : "degraded"
    return c.json({
      status,
      isDbConnected,
      isCacheConnected,
      date: Date.now(),
    }, isDbConnected ? 200 : 503)
  })
}
