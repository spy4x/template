/// <reference lib="deno.ns" />
import postgres from "postgres"
import { createSqlFromEnv } from "@spy4x/server/db"
import {
  LoggingOutboxPublisher,
  OutboxProcessor,
  PostgresOutboxRepository,
} from "@spy4x/server/outbox"

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

const signals: Deno.Signal[] = ["SIGINT", "SIGTERM"]
const controller = new AbortController()

const stop = () => {
  for (const signal of signals) {
    Deno.removeSignalListener(signal, stop)
  }
  controller.abort()
}

for (const signal of signals) {
  Deno.addSignalListener(signal, stop)
}

console.log("Worker started")

const processor = new OutboxProcessor(
  new PostgresOutboxRepository(sql),
  new LoggingOutboxPublisher(),
)

try {
  await processor.run(controller.signal)
} finally {
  stop()
  await sql.end({ timeout: 5 })
  console.log("Worker stopped")
}
