/**
 * Transactional outbox drain.
 *
 * Commands write an outbox row in the same transaction as the state change, so
 * the event and the change are committed atomically. This module drains those
 * committed rows and hands them to a publisher.
 *
 * Rows carry identity only - aggregate, version, kind, group - and never a
 * payload. Consumers use them to decide that something changed and to pull the
 * authoritative state, which keeps the outbox out of the correctness path.
 */
import type postgres from "postgres"

export interface OutboxEvent {
  id: string
  eventKind: string
  aggregateType: string
  aggregateId: string
  /** BIGINT, carried as a decimal string so large values survive JSON. */
  aggregateVersion: string
  groupId: string
  actorUserId: number
  /** Includes the attempt being made now, so a first delivery reads as 1. */
  attemptCount: number
}

export interface OutboxPublisher {
  publish(event: OutboxEvent): Promise<void>
}

export interface OutboxRepository {
  claimBatch(limit: number, maxAttempts: number, leaseSeconds: number): Promise<OutboxEvent[]>
  markProcessed(id: string): Promise<void>
  scheduleRetry(
    id: string,
    delaySeconds: number,
    errorCode: string,
  ): Promise<void>
}

export interface OutboxProcessorOptions {
  /** Rows claimed per drain. */
  batchSize?: number
  /** A row is abandoned once this many attempts have been made. */
  maxAttempts?: number
  baseRetryDelayMs?: number
  maxRetryDelayMs?: number
  /**
   * How long a claimed row stays invisible to other workers. Must comfortably
   * exceed the slowest expected publish, since a lease that expires mid-publish
   * lets a second worker deliver the same event.
   */
  leaseSeconds?: number
}

export interface DrainResult {
  claimed: number
  published: number
  failed: number
}

const DEFAULTS = {
  batchSize: 50,
  maxAttempts: 10,
  baseRetryDelayMs: 1_000,
  maxRetryDelayMs: 5 * 60_000,
  leaseSeconds: 60,
} as const

/**
 * Exponential backoff on the attempt just made, so the first failure waits
 * `base` and each later one doubles up to `max`.
 */
export function retryDelayMs(
  attemptCount: number,
  baseMs: number = DEFAULTS.baseRetryDelayMs,
  maxMs: number = DEFAULTS.maxRetryDelayMs,
): number {
  const exponent = Math.max(0, attemptCount - 1)
  // Cap the exponent before shifting so a large attemptCount cannot overflow.
  const uncapped = exponent >= 32 ? Infinity : baseMs * 2 ** exponent
  return Math.min(maxMs, uncapped)
}

/** Short, stable label recorded on the row so failures are greppable. */
export function errorCodeOf(error: unknown): string {
  const name = error instanceof Error ? (error.name || "Error") : typeof error
  return name.slice(0, 64)
}

export class OutboxProcessor {
  readonly #batchSize: number
  readonly #maxAttempts: number
  readonly #baseRetryDelayMs: number
  readonly #maxRetryDelayMs: number
  readonly #leaseSeconds: number

  constructor(
    private readonly repository: OutboxRepository,
    private readonly publisher: OutboxPublisher,
    options: OutboxProcessorOptions = {},
  ) {
    this.#batchSize = options.batchSize ?? DEFAULTS.batchSize
    this.#maxAttempts = options.maxAttempts ?? DEFAULTS.maxAttempts
    this.#baseRetryDelayMs = options.baseRetryDelayMs ??
      DEFAULTS.baseRetryDelayMs
    this.#maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULTS.maxRetryDelayMs
    this.#leaseSeconds = options.leaseSeconds ?? DEFAULTS.leaseSeconds
  }

  /**
   * Claims one batch and publishes it. A failing row is rescheduled and never
   * blocks the rest of the batch, so one poisonous event cannot stall the queue.
   */
  async drainOnce(): Promise<DrainResult> {
    const events = await this.repository.claimBatch(
      this.#batchSize,
      this.#maxAttempts,
      this.#leaseSeconds,
    )
    let published = 0
    let failed = 0

    for (const event of events) {
      try {
        await this.publisher.publish(event)
        await this.repository.markProcessed(event.id)
        published++
      } catch (error) {
        failed++
        const delayMs = retryDelayMs(
          event.attemptCount,
          this.#baseRetryDelayMs,
          this.#maxRetryDelayMs,
        )
        await this.repository.scheduleRetry(
          event.id,
          delayMs / 1000,
          errorCodeOf(error),
        )
      }
    }

    return { claimed: events.length, published, failed }
  }

  /**
   * Drains until aborted, waiting `idleDelayMs` only when a drain came back
   * empty so a backlog is worked through without pausing between batches.
   */
  async run(signal: AbortSignal, idleDelayMs = 1_000): Promise<void> {
    while (!signal.aborted) {
      const result = await this.drainOnce()
      if (signal.aborted || result.claimed > 0) continue
      await new Promise<void>((resolve) => {
        const timer = setTimeout(onDone, idleDelayMs)
        function onDone() {
          clearTimeout(timer)
          signal.removeEventListener("abort", onDone)
          resolve()
        }
        signal.addEventListener("abort", onDone, { once: true })
      })
    }
  }
}

export class PostgresOutboxRepository implements OutboxRepository {
  constructor(private readonly sql: postgres.Sql) {}

  /**
   * FOR UPDATE SKIP LOCKED stops two workers claiming the same row in the same
   * instant, but it only holds for the duration of this statement. Once the
   * claim commits, the row is unlocked and still unprocessed, so a second worker
   * would happily pick it up while the first is publishing.
   *
   * Pushing available_at forward by the lease is what actually makes a claimed
   * row invisible. A worker that dies mid-publish therefore releases its rows
   * when the lease expires, rather than stranding them.
   *
   * attemptCount is incremented at claim time rather than on failure, so a row
   * that crashes the worker before it reports an outcome still burns an attempt
   * and cannot be retried forever.
   */
  async claimBatch(
    limit: number,
    maxAttempts: number,
    leaseSeconds: number,
  ): Promise<OutboxEvent[]> {
    return await this.sql<OutboxEvent[]>`
      WITH claimed AS (
        SELECT id
        FROM outbox_events
        WHERE processed_at IS NULL
          AND available_at <= now()
          AND attempt_count < ${maxAttempts}
        ORDER BY available_at, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE outbox_events AS events
      SET claimed_at = now(),
          attempt_count = events.attempt_count + 1,
          available_at = now() + (${leaseSeconds}::double precision * INTERVAL '1 second')
      FROM claimed
      WHERE events.id = claimed.id
      RETURNING
        events.id,
        events.event_kind,
        events.aggregate_type,
        events.aggregate_id,
        events.aggregate_version::text AS aggregate_version,
        events.group_id,
        events.actor_user_id,
        events.attempt_count
    `
  }

  async markProcessed(id: string): Promise<void> {
    await this.sql`
      UPDATE outbox_events
      SET processed_at = now(),
          last_error_code = NULL
      WHERE id = ${id}
    `
  }

  async scheduleRetry(
    id: string,
    delaySeconds: number,
    errorCode: string,
  ): Promise<void> {
    await this.sql`
      UPDATE outbox_events
      SET available_at = now() + (${delaySeconds}::double precision * INTERVAL '1 second'),
          last_error_code = ${errorCode}
      WHERE id = ${id}
    `
  }
}

/**
 * Default publisher until the realtime transport exists. Recording the event is
 * enough to prove the drain works end to end; see docs/design/realtime-websockets.md.
 */
export class LoggingOutboxPublisher implements OutboxPublisher {
  publish(event: OutboxEvent): Promise<void> {
    console.log(
      `outbox ${event.eventKind} ${event.aggregateType}#${event.aggregateId}` +
        ` v${event.aggregateVersion} group=${event.groupId}`,
    )
    return Promise.resolve()
  }
}
