/// <reference lib="deno.ns" />
import { sql } from "@server/db"
import { LoggingOutboxPublisher, OutboxProcessor, PostgresOutboxRepository } from "@server/outbox"

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
