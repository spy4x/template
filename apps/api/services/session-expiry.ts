/** What the hourly session-expiry run needs. `index.ts` passes the app's singletons. */
export interface SessionExpiryDependencies {
  expireSessions(): Promise<unknown>
  log(...data: unknown[]): void
  intervalMs: number
}

/**
 * Runs `expireSessions` every `intervalMs`. A failed run (for example the database is down) is
 * logged and the next tick tries again: an error thrown inside a timer would otherwise end the
 * whole API process and drop every open WebSocket. Returns a function that stops the timer.
 */
export function startSessionExpiry(
  { expireSessions, log, intervalMs }: SessionExpiryDependencies,
): () => void {
  const timer = setInterval(async () => {
    try {
      await expireSessions()
    } catch (error) {
      log(`error: session expiry failed, retrying next tick`, error)
    }
  }, intervalMs)
  return () => clearInterval(timer)
}
