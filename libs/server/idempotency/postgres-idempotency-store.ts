import type postgres from "postgres"
import {
  type BeginOutcome,
  IDEMPOTENCY_LEASE_SECONDS,
  IDEMPOTENCY_RETENTION_DAYS,
  type IdempotencyClaim,
  type IdempotencyStore,
} from "./idempotency.ts"

const STARTED = 1
const DONE = 2

interface StoredKeyRow extends postgres.Row {
  commandName: string
  requestHash: string
  status: number
  result: unknown
  leaseExpired: boolean
}

/** {@link IdempotencyStore} over the `idempotency_keys` table. */
export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(private readonly sql: postgres.Sql) {}

  async begin(claim: IdempotencyClaim): Promise<BeginOutcome> {
    const { userId, key, commandName, requestHash } = claim
    // A key past its retention is forgotten here too, so the seven days hold even before a sweep.
    await this.sql`
      DELETE FROM idempotency_keys
      WHERE user_id = ${userId}
        AND key = ${key}
        AND created_at < now() - make_interval(days => ${IDEMPOTENCY_RETENTION_DAYS}::int)
    `
    // A row released between the insert and the read is claimable again, so look twice.
    for (let attempt = 0; attempt < 3; attempt++) {
      const inserted = await this.sql`
        INSERT INTO idempotency_keys (user_id, key, command_name, request_hash, status)
        VALUES (${userId}, ${key}, ${commandName}, ${requestHash}, ${STARTED})
        ON CONFLICT (user_id, key) DO NOTHING
        RETURNING 1 AS claimed
      `
      if (inserted.length > 0) return { status: "claimed" }

      const row = (
        await this.sql<StoredKeyRow[]>`
          SELECT
            command_name AS "commandName",
            request_hash AS "requestHash",
            status,
            result,
            updated_at < now() - make_interval(secs => ${IDEMPOTENCY_LEASE_SECONDS}::int)
              AS "leaseExpired"
          FROM idempotency_keys
          WHERE user_id = ${userId} AND key = ${key}
        `
      )[0]
      if (!row) continue
      if (row.commandName !== commandName || row.requestHash !== requestHash) {
        return { status: "reused" }
      }
      if (row.status === DONE) return { status: "replay", result: row.result }
      if (!row.leaseExpired) return { status: "in_progress" }

      // The first run died. Only one retry may take its claim over.
      const taken = await this.sql`
        UPDATE idempotency_keys
        SET updated_at = now()
        WHERE user_id = ${userId}
          AND key = ${key}
          AND status = ${STARTED}
          AND updated_at < now() - make_interval(secs => ${IDEMPOTENCY_LEASE_SECONDS}::int)
        RETURNING 1 AS claimed
      `
      return taken.length > 0 ? { status: "claimed" } : { status: "in_progress" }
    }
    return { status: "in_progress" }
  }

  async complete(userId: number, key: string, result: unknown): Promise<void> {
    await this.sql`
      UPDATE idempotency_keys
      SET status = ${DONE},
          result = ${JSON.stringify(result ?? null)}::text::jsonb,
          updated_at = now()
      WHERE user_id = ${userId} AND key = ${key} AND status = ${STARTED}
    `
  }

  async release(userId: number, key: string): Promise<void> {
    await this.sql`
      DELETE FROM idempotency_keys
      WHERE user_id = ${userId} AND key = ${key} AND status = ${STARTED}
    `
  }

  async sweep(): Promise<number> {
    const removed = await this.sql`
      DELETE FROM idempotency_keys
      WHERE created_at < now() - make_interval(days => ${IDEMPOTENCY_RETENTION_DAYS}::int)
    `
    return removed.count
  }
}
