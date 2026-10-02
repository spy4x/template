/**
 * Proving an e-mail address with a one-time code (#140): where an account's address stands, the
 * address change that waits for its code, and the one check that later features ask before they
 * trust an address.
 *
 * The codes are `@spy4x/server/auth/email-code`'s: 48 random bits as 8 base64url characters, stored
 * only as a SHA-256 of the address and the code, 5 guesses per code, 10 minutes, deleted when they
 * match. The store compares the hashes with SQL `=`; the time that takes tells a guesser nothing
 * about the code, since they would need a preimage of the hash. Asking again replaces the code and
 * keeps its guess count, so asking never buys more guesses.
 *
 * Reads no environment and imports no singleton: the API and the worker both use it.
 *
 * @module
 */

import type { Sql } from "@spy4x/server/db"
import type { AuthKey, AuthSessionRecord, AuthStore } from "@spy4x/server/auth"
import { normalizeEmail } from "@spy4x/server/auth"
import { createEmailCodeSignIn, DEFAULT_CODE_TTL_MINUTES } from "@spy4x/server/auth/email-code"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import type { SessionManager } from "@spy4x/server/sign-in"
import type { EmailStatus } from "@domain/identity"

/** How long a mailed code works. */
export const EMAIL_CODE_TTL_MINUTES = DEFAULT_CODE_TTL_MINUTES

/** The user's password key: every account here has exactly one. `null` when it is gone. */
export async function passwordKeyOf(store: AuthStore, userId: number): Promise<AuthKey | null> {
  const keys = await store.listKeys(userId)
  return keys.find((key) => key.method === PASSWORD_METHOD) ?? null
}

/** The `email_changes` table: one new address per user, waiting for its code. */
export type EmailChanges = ReturnType<typeof emailChanges>

/** {@link EmailChanges} over `sql`, a pool or a transaction. */
export function emailChanges(sql: Sql) {
  return {
    /** The address the user asked to move to, or `null`. */
    find: async (userId: number): Promise<string | null> =>
      (await sql<{ email: string }[]>`
        SELECT email FROM email_changes WHERE user_id = ${userId}
      `)[0]?.email ?? null,
    /** Records `email`, already normalised, replacing an earlier request. */
    save: async (userId: number, email: string): Promise<void> => {
      await sql`
        INSERT INTO email_changes (user_id, email) VALUES (${userId}, ${email})
        ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, created_at = now()
      `
    },
    remove: async (userId: number): Promise<void> => {
      await sql`DELETE FROM email_changes WHERE user_id = ${userId}`
    },
  }
}

/** Where the user's address stands: the one they sign in with, its proof, and a pending change. */
export async function readEmailStatus(
  changes: Pick<EmailChanges, "find">,
  store: AuthStore,
  userId: number,
): Promise<EmailStatus> {
  const key = await passwordKeyOf(store, userId)
  return {
    email: key?.email ?? null,
    proven: key?.email != null && key.provenAt !== null,
    pending: await changes.find(userId),
  }
}

/**
 * Issues a code for `email` and hands it to `send`, which mails it. The raw code exists only in
 * that call. A rejection of `send` reaches the caller; the code is issued by then and simply
 * replaced by the next one.
 */
export async function sendEmailCode(
  store: AuthStore,
  email: string,
  send: (email: string, code: string) => Promise<void>,
): Promise<void> {
  await createEmailCodeSignIn({ store, sessions: NO_SESSIONS, sendCode: send }).requestCode(email)
}

/**
 * The user who owns `email` because a code or a reset link proved it, or `null`: an unproven claim
 * owns nothing. Anything that trusts an address to name a person asks this first: an invitation
 * by address (#131) and linking a Google or GitHub account by its address (#141).
 */
export async function provenAddressOwner(store: AuthStore, email: unknown): Promise<number | null> {
  const address = normalizeEmail(email)
  return address === null ? null : await store.findUserIdByProvenEmail(address)
}

/**
 * `createEmailCodeSignIn` requires a session manager, but `requestCode` never creates a session:
 * the worker, which sends the codes, holds no session pepper. Any use of this one is a bug.
 */
const NO_SESSIONS = new Proxy({}, {
  get() {
    throw new Error("sending an e-mail code must not create a session")
  },
}) as SessionManager<AuthSessionRecord>
