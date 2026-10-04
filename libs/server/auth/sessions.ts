/**
 * The signed-in devices of a person (#151), over the `auth_sessions` rows of `@spy4x/server`'s
 * session store. The package's store creates, checks and signs out sessions; this module adds what
 * the template shows about them and the two ways a person ends them from another device.
 *
 * - **What a session remembers.** A device name and the address with its last part hidden
 *   (`./session-device.ts`), written once right after the session is created, and the last time it
 *   was used, written at most once every {@link LAST_USED_RESOLUTION_MS}.
 * - **Ending a session deletes its row.** Every statement that ends one names the user, so a
 *   person can end only their own sessions; someone else's session and a missing one look the same.
 *   Without its row the session fails every check at once, and the realtime hub closes its socket
 *   on the next check.
 *
 * Reads no environment and imports no singleton.
 *
 * @module
 */

import type postgres from "postgres"
import { SessionStatus } from "@spy4x/server/sign-in"
import { DEVICE_NAME_MAX_LENGTH } from "./session-device.ts"

/** How stale `last_used_at` may get before a request writes it again: five minutes. */
export const LAST_USED_RESOLUTION_MS = 5 * 60_000

/** What a session remembers about the device that signed in. */
export interface SessionDevice {
  deviceName: string
  /** The address with its last part hidden, or `null` when the request had none. */
  ipHint: string | null
}

/** One live session of a person, as their devices list shows it. */
export interface SessionListRow extends SessionDevice {
  id: number
  createdAt: Date
  lastUsedAt: Date
}

/** Records the device on a session just created; inside the transaction that created it. */
export async function recordSessionDevice(
  sql: postgres.Sql,
  sessionId: number,
  device: SessionDevice,
): Promise<void> {
  await sql`
    UPDATE auth_sessions
    SET device_name = ${device.deviceName.slice(0, DEVICE_NAME_MAX_LENGTH)},
      ip_hint = ${device.ipHint?.slice(0, 45) ?? null},
      last_used_at = now()
    WHERE id = ${sessionId}
  `
}

/**
 * Records that the session was used now, unless it was already recorded within
 * {@link LAST_USED_RESOLUTION_MS}: most requests match no row and write nothing.
 */
export async function touchSession(sql: postgres.Sql, sessionId: number): Promise<void> {
  await sql`
    UPDATE auth_sessions SET last_used_at = now()
    WHERE id = ${sessionId}
      AND last_used_at < now() - make_interval(secs => ${LAST_USED_RESOLUTION_MS / 1000})
  `
}

/** The user's sessions that can still act: active and not expired, last used first. */
export async function listLiveSessions(
  sql: postgres.Sql,
  userId: number,
): Promise<SessionListRow[]> {
  const rows = await sql<SessionListRow[]>`
    SELECT id, device_name AS "deviceName", ip_hint AS "ipHint", created_at AS "createdAt",
      last_used_at AS "lastUsedAt"
    FROM auth_sessions
    WHERE user_id = ${userId} AND status = ${SessionStatus.Active} AND expires_at > now()
    ORDER BY last_used_at DESC, id DESC
  `
  return rows.map((row) => ({
    id: row.id,
    deviceName: row.deviceName,
    ipHint: row.ipHint,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  }))
}

/**
 * Deletes session `sessionId` when it belongs to `userId`. `false` when no such session of this
 * user exists, which is also the answer for another user's session.
 */
export async function deleteOwnSession(
  sql: postgres.Sql,
  userId: number,
  sessionId: number,
): Promise<boolean> {
  const rows = await sql`
    DELETE FROM auth_sessions WHERE id = ${sessionId} AND user_id = ${userId} RETURNING id
  `
  return rows.length > 0
}

/** Deletes every session of `userId` except `keepId`. Returns how many it deleted. */
export async function deleteOtherSessions(
  sql: postgres.Sql,
  userId: number,
  keepId: number,
): Promise<number> {
  const rows = await sql`
    DELETE FROM auth_sessions WHERE user_id = ${userId} AND id <> ${keepId} RETURNING id
  `
  return rows.length
}
