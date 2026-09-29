/// <reference lib="deno.ns" />
import postgres from "postgres"
import { createSqlFromEnv } from "@spy4x/server/db"
import {
  LoggingOutboxPublisher,
  OutboxProcessor,
  PostgresOutboxRepository,
} from "@spy4x/server/outbox"
import { shutdownSignal, ShutdownSignalError } from "@spy4x/platform/server/shutdown-signal"

const sql = createSqlFromEnv(Deno.env.toObject(), {
  transform: postgres.camel,
  applicationName: "app-backend",
  // The driver's own default (postgres@3.4.7 src/index.js:449) was 10, not the
  // package's default of 15; compose limits Postgres to max_connections=30 and both
  // this pool and the api's draw from it, so the old ceiling is kept explicitly.
  max: 10,
})
if (!sql) {
  console.error("❌ Missing environment variable: DB_HOST")
  Deno.exit(1)
}

// Aborts once, on the first SIGINT or SIGTERM, and removes both listeners itself.
const signal = shutdownSignal()

console.log("Worker started")

const processor = new OutboxProcessor(
  new PostgresOutboxRepository(sql),
  new LoggingOutboxPublisher(),
)

try {
  await processor.run(signal)
} finally {
  await sql.end({ timeout: 5 })
  const reason = signal.reason instanceof ShutdownSignalError ? ` on ${signal.reason.signal}` : ""
  console.log(`Worker stopped${reason}`)
}
