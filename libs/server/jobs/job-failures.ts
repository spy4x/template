import { JobPublisher, type JobPublisherOptions, type OutboxEvent } from "@spy4x/server/outbox"

/**
 * How the worker retries a failing outbox row: the waits double from one second up to fifteen
 * minutes, and the twentieth attempt starts about two and a half hours after the first. A mail
 * server or a billing provider that is down for an hour or two therefore loses no job, and once it
 * is back the job runs within fifteen minutes.
 */
export const JOB_RETRY = {
  maxAttempts: 20,
  baseRetryDelayMs: 1_000,
  maxRetryDelayMs: 15 * 60_000,
} as const

/** The text of whatever a job threw, for a log line. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Options of {@link ReportingJobPublisher}. */
export interface ReportingJobPublisherOptions extends JobPublisherOptions {
  /** The processor's own `maxAttempts`: a failure on that attempt is the last. */
  maxAttempts: number
  /** Told every failed attempt. Gets the row's kind, aggregate and id, and the error's message. */
  log: (line: string) => void
}

/**
 * The worker's `JobPublisher`, with no failing row silent: every failed attempt, of a job or of
 * any other row, is logged with the row's kind and the error's message, and the attempt after
 * which the processor gives the row up is logged as abandoned. The error is thrown on, so the
 * processor still retries.
 *
 * A row the processor gave up for another reason, such as a worker that died mid-run each time,
 * logs nothing here.
 */
export class ReportingJobPublisher extends JobPublisher {
  readonly #jobType: string
  readonly #maxAttempts: number
  readonly #log: (line: string) => void

  constructor({ maxAttempts, log, ...options }: ReportingJobPublisherOptions) {
    super(options)
    this.#jobType = options.aggregateType
    this.#maxAttempts = maxAttempts
    this.#log = log
  }

  override async publish(event: OutboxEvent): Promise<void> {
    try {
      await super.publish(event)
    } catch (error) {
      const noun = event.aggregateType === this.#jobType ? "job" : "outbox row"
      const what = `${noun} ${event.eventKind} (${event.aggregateType} ${event.aggregateId})`
      const text = errorText(error)
      this.#log(
        event.attemptCount >= this.#maxAttempts
          ? `error: ${what} abandoned after ${event.attemptCount} attempts: ${text}`
          : `warn: ${what} failed, attempt ${event.attemptCount} of ${this.#maxAttempts}: ${text}`,
      )
      throw error
    }
  }
}

/** One part of the nightly cleanup: a name for the log and what it does. */
export type CleanupStep = readonly [name: string, run: () => Promise<void>]

/**
 * The nightly cleanup as a job: runs every step in order, each on its own, so a step that throws
 * stops no other. Each failure is logged with the step's name and the error's message, and the job
 * then fails, so the processor retries the whole list; every step only removes what is due, so a
 * rerun of one that succeeded finds nothing.
 *
 * On the processor's last attempt (`maxAttempts`) the job ends normally whatever failed: a
 * repeating job that fails its last attempt writes no next run, and the cleanup would stop for
 * good. The steps that still fail are logged and tried again the next night.
 */
export function cleanupJob(
  steps: readonly CleanupStep[],
  maxAttempts: number,
  log: (line: string) => void,
): (event: OutboxEvent) => Promise<void> {
  return async (event) => {
    const failed: string[] = []
    for (const [name, run] of steps) {
      try {
        await run()
      } catch (error) {
        failed.push(name)
        log(`error: nightly cleanup step "${name}" failed: ${errorText(error)}`)
      }
    }
    if (failed.length === 0) return
    const names = failed.map((name) => `"${name}"`).join(", ")
    if (event.attemptCount >= maxAttempts) {
      log(
        `error: nightly cleanup gave up on ${names} after ${event.attemptCount} attempts; the next run is tomorrow`,
      )
      return
    }
    throw new Error(`nightly cleanup: ${failed.length} step(s) failed: ${names}`)
  }
}
