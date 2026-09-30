import { ConnectionLostError, RealtimeRequestError, RequestTimeoutError } from "@spy4x/realtime"

/** The two calls a socket offers. `ClientTransport` satisfies it. */
export interface CallPort {
  command(name: string, payload?: unknown, options?: { idempotencyKey?: string }): Promise<unknown>
  query(name: string, payload?: unknown): Promise<unknown>
}

export interface RetryOptions {
  /** Total tries, including the first. */
  attempts?: number
  /** Wait before try `n` is `delayMs * n`. */
  delayMs?: number
  sleep?: (ms: number) => Promise<void>
  /** Makes the key a command is sent with; called once per command, never per try. */
  newKey?: () => string
}

const DEFAULT_ATTEMPTS = 4
const DEFAULT_DELAY_MS = 1_000

/**
 * Whether the outcome of a call is unknown or the server was busy, so trying again can help: the
 * answer did not arrive in time, the socket dropped, the server gave up, or it is still running
 * the first try of the same command.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof RequestTimeoutError || error instanceof ConnectionLostError) return true
  if (error instanceof RealtimeRequestError) {
    if (error.code === "timeout") return true
    const details = error.details as { code?: unknown } | undefined
    return error.code === "conflict" && details?.code === "IN_PROGRESS"
  }
  return false
}

async function withRetry<T>(run: () => Promise<T>, options: RetryOptions): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  for (let attempt = 1;; attempt++) {
    try {
      return await run()
    } catch (error) {
      if (attempt >= attempts || !isRetryable(error)) throw error
      await sleep(delayMs * attempt)
    }
  }
}

/**
 * Sends a command with a fresh idempotency key and, when the outcome is unknown, sends it again
 * with the same key. The server runs a command once per key and answers a repeat with the first
 * result, so a retry cannot create a second group.
 */
export function sendCommand<T>(
  port: CallPort,
  name: string,
  payload: unknown,
  options: RetryOptions = {},
): Promise<T> {
  const idempotencyKey = (options.newKey ?? (() => crypto.randomUUID()))()
  return withRetry(
    async () => await port.command(name, payload, { idempotencyKey }) as T,
    options,
  )
}

/** Sends a query, trying again when the socket is down or the answer is late. */
export function sendQuery<T>(
  port: CallPort,
  name: string,
  payload?: unknown,
  options: RetryOptions = {},
): Promise<T> {
  return withRetry(async () => await port.query(name, payload) as T, options)
}
