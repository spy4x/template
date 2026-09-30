/**
 * The persistent count of wrong one-time codes per user, with a lock that grows per failure (#73).
 *
 * The in-memory rate limit in `middlewares/auth-rate-limits.ts` stops a burst and forgets
 * everything on restart. This counter lives in `user_totp`, so it survives a restart and a second
 * API instance sees it. Together they cap a guesser at about 380 guesses a year for one user, a
 * chance well under 1% of hitting one of the 3 codes that are valid at any moment (arithmetic in
 * the pull request of #73).
 *
 * How a check goes: {@link TotpFailures.begin} runs first and counts the check as a failure in
 * advance; a correct code then calls {@link TotpFailures.refund}, which gives that one slot back.
 * A correct code does not wipe the count: that would hand a guesser six fresh guesses every time
 * the owner signs in. A wrong code also calls {@link TotpFailures.fail}, which stamps the time.
 * After {@link QUIET_RESET_MS} without a wrong code the count starts again from 0, however often
 * the owner signed in meanwhile. Counting first, in one locked
 * transaction, means parallel guesses cannot all slip through before the first one is counted.
 * While a lock runs, every check is refused without looking at the code, a correct one included:
 * a lock that let the right code through would let a lucky guess through too. The price is that
 * someone who knows the password can keep the owner out of the code step by guessing on, up to
 * {@link MAX_LOCK_MS} at a time. There is no way out that skips the code; e-mail sign-in would be
 * one (#73, option B).
 *
 * @module
 */

import type { Sql } from "@spy4x/server/db"

/** Wrong codes allowed with no wait. */
export const FREE_FAILURES = 5

/** The wait after the first failure past {@link FREE_FAILURES}; it doubles with each one. */
export const FIRST_LOCK_MS = 15 * 60_000

/** The longest wait, one day. */
export const MAX_LOCK_MS = 24 * 60 * 60_000

/** Seven quiet days, with no failed check, set the count back to 0. */
export const QUIET_RESET_MS = 7 * 24 * 60 * 60_000

/**
 * How long the user is locked after the `failures`-th wrong code in a row: nothing up to
 * {@link FREE_FAILURES}, then {@link FIRST_LOCK_MS} doubling per failure, capped at
 * {@link MAX_LOCK_MS}.
 */
export function lockDelayMs(failures: number): number {
  if (failures <= FREE_FAILURES) return 0
  const doublings = failures - FREE_FAILURES - 1
  // 2 ** 30 is far past the cap; the guard keeps a huge count from reaching Infinity.
  return Math.min(FIRST_LOCK_MS * 2 ** Math.min(doublings, 30), MAX_LOCK_MS)
}

/** What the routes need from the counter. */
export interface TotpFailures {
  /**
   * Starts a code check for `userId`. Returns 0 when the check may run, and counts it as a failure
   * until {@link refund} runs. Returns the milliseconds to wait, without counting, while a lock is
   * running. A user with no enrolment has nothing to guess, so it always returns 0.
   */
  begin(userId: number): Promise<number>
  /**
   * Gives back the slot {@link begin} took, after a correct code. Ends the lock only when the
   * count is back to the free failures: a lock a concurrent wrong code set stays.
   */
  refund(userId: number): Promise<void>
  /** Records a wrong code: the time the count last grew, which the quiet-days reset reads. */
  fail(userId: number): Promise<void>
}

/** Options for {@link createTotpFailures}. */
export interface TotpFailuresOptions {
  sql: Sql
  /** Current time in ms. Defaults to `Date.now`; tests inject their own. */
  clock?: () => number
}

/** A row as the API's `sql` client returns it: it camel-cases column names. */
interface CounterRow {
  failedAttempts: number
  lockedUntil: Date | null
  lastFailureAt: Date | null
}

/** Builds the counter over the `user_totp` table. */
export function createTotpFailures({ sql, clock = Date.now }: TotpFailuresOptions): TotpFailures {
  return {
    begin: (userId) =>
      sql.begin(async (tx) => {
        const rows = await tx<CounterRow[]>`
          SELECT failed_attempts, locked_until, last_failure_at FROM user_totp WHERE user_id = ${userId} FOR UPDATE
        `
        const row = rows[0]
        if (row === undefined) return 0
        const now = clock()
        const lockedUntil = row.lockedUntil?.getTime() ?? 0
        if (lockedUntil > now) return lockedUntil - now
        // The reset stamps the time too, so parallel checks that arrive after a quiet spell reset
        // the count once, not once each.
        const quiet = row.lastFailureAt !== null &&
          now - row.lastFailureAt.getTime() >= QUIET_RESET_MS
        const failures = (quiet ? 0 : row.failedAttempts) + 1
        const delay = lockDelayMs(failures)
        await tx`
          UPDATE user_totp
          SET failed_attempts = ${failures},
              locked_until = ${delay === 0 ? null : new Date(now + delay)},
              last_failure_at = ${quiet ? new Date(now) : row.lastFailureAt}
          WHERE user_id = ${userId}
        `
        return 0
      }),
    refund: async (userId) => {
      await sql`
        UPDATE user_totp
        SET failed_attempts = GREATEST(failed_attempts - 1, 0),
            locked_until = CASE WHEN failed_attempts - 1 <= ${FREE_FAILURES} THEN NULL
                                ELSE locked_until END
        WHERE user_id = ${userId}
      `
    },
    fail: async (userId) => {
      await sql`
        UPDATE user_totp SET last_failure_at = ${new Date(clock())} WHERE user_id = ${userId}
      `
    },
  }
}
