/**
 * Personal API tokens (#167) over the `api_tokens` table. The table holds a keyed hash of each
 * token, never the token: {@link hashApiToken} turns what a client presents into the value to look
 * up, so a database dump gives nobody a working token.
 *
 * Every statement that reads or ends a token for its owner names the user, so a person reaches only
 * their own tokens; someone else's token and a missing one look the same. A token that is revoked
 * has no row, and one that expired or whose owner is gone fails {@link ApiTokenRows.findLive}, so
 * either is refused on the very next request: nothing caches a token.
 *
 * Reads no environment and imports no singleton.
 *
 * @module
 */

import type postgres from "postgres"
import { newOpaqueToken, sha256Hex } from "@spy4x/platform/tokens"
import {
  API_TOKEN_PREFIX,
  API_TOKENS_MAX,
  type ApiToken,
  ApiTokenAccess,
  isApiTokenFormat,
} from "@domain/api-tokens"
import type { UserMFAStatus } from "@domain/identity"

/** How stale `last_used_at` may get before a request writes it again: five minutes. */
export const API_TOKEN_USE_RESOLUTION_MS = 5 * 60_000

/**
 * A new token: `secret` goes to the person once, `hash` is what the table keeps. `secret` is
 * {@link API_TOKEN_PREFIX} followed by the 128 random bits `newOpaqueToken` mints, and `hash` is
 * that package's `sha256Hex(raw + key)`. `key` must be at least 32 characters.
 */
export async function mintApiToken(key: string): Promise<{ secret: string; hash: string }> {
  const { raw, hash } = await newOpaqueToken(key)
  return { secret: `${API_TOKEN_PREFIX}${raw}`, hash }
}

/**
 * The value `api_tokens.token_hash` holds for `secret`: the hash {@link mintApiToken} stored, as
 * lower-case hex. Without the key, a stolen hash cannot be checked against a guess offline. `null`
 * when `secret` does not have a token's shape, so a malformed header never reaches the database.
 */
export async function hashApiToken(secret: string, key: string): Promise<string | null> {
  if (!isApiTokenFormat(secret)) return null
  return await sha256Hex(`${secret.slice(API_TOKEN_PREFIX.length)}${key}`)
}

/** A token that may act now, with what its request needs to know about its owner. */
export interface LiveApiToken {
  id: string
  userId: number
  userMfa: UserMFAStatus
  groupId: string
  access: ApiTokenAccess
}

/** What {@link ApiTokenRows.create} did. */
export type ApiTokenCreateOutcome =
  | { created: ApiToken }
  /** The person is not a member of the group, or the group is deleted. */
  | { refused: "GROUP_NOT_FOUND" }
  /** The person holds {@link API_TOKENS_MAX} live tokens already. */
  | { refused: "TOO_MANY_TOKENS" }

/** The fields a new token row is written with. */
export interface ApiTokenRowInput {
  id: string
  userId: number
  groupId: string
  name: string
  hash: string
  access: ApiTokenAccess
  expiresAt: Date | null
}

interface ApiTokenRow {
  id: string
  name: string
  groupId: string
  groupName: string
  access: number
  createdAt: Date
  expiresAt: Date | null
  lastUsedAt: Date | null
}

/** The operations on `api_tokens`, bound to one client or transaction. */
export interface ApiTokenRows {
  /**
   * Writes a token for `input.userId` in `input.groupId`, unless the person is not a member of a
   * live group there or already holds {@link API_TOKENS_MAX} live tokens. Run it inside a
   * transaction: it locks the person's `users` row, so two creates cannot both take the last slot.
   */
  create(input: ApiTokenRowInput): Promise<ApiTokenCreateOutcome>
  /** The person's live tokens: not expired, in a live group, newest first. */
  listLive(userId: number): Promise<ApiToken[]>
  /**
   * Deletes token `tokenId` when it belongs to `userId`. `false` when no such token of this user
   * exists, which is also the answer for another user's token.
   */
  deleteOwn(userId: number, tokenId: string): Promise<boolean>
  /**
   * The token whose hash is `hash`, when it may act now: not expired, and its owner's account is
   * live. `null` otherwise. Membership of the group is not checked here: the handlers check the
   * owner's role on every message, as they do for a session.
   */
  findLive(hash: string): Promise<LiveApiToken | null>
  /**
   * Records that token `tokenId` was used at `now`, unless that was already recorded within
   * {@link API_TOKEN_USE_RESOLUTION_MS}. `true` when it wrote, which is when the use is audited.
   */
  touch(tokenId: string, now?: Date): Promise<boolean>
}

/** Binds the token operations to `sql`, a client or a transaction. */
export function apiTokenRows(sql: postgres.Sql): ApiTokenRows {
  return {
    async create(input) {
      await sql`SELECT 1 FROM users WHERE id = ${input.userId} FOR UPDATE`
      const [member] = await sql`
        SELECT 1 FROM group_members
        INNER JOIN groups ON groups.id = group_members.group_id AND groups.deleted_at IS NULL
        WHERE group_members.group_id = ${input.groupId} AND group_members.user_id = ${input.userId}
      `
      if (!member) return { refused: "GROUP_NOT_FOUND" }
      const [{ count }] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM api_tokens
        WHERE user_id = ${input.userId} AND (expires_at IS NULL OR expires_at > now())
      `
      if (count >= API_TOKENS_MAX) return { refused: "TOO_MANY_TOKENS" }
      const [row] = await sql<ApiTokenRow[]>`
        WITH inserted AS (
          INSERT INTO api_tokens (id, user_id, group_id, name, token_hash, access, expires_at)
          VALUES (${input.id}, ${input.userId}, ${input.groupId}, ${input.name}, ${input.hash},
            ${input.access}, ${input.expiresAt})
          RETURNING *
        )
        SELECT inserted.id, inserted.name, inserted.group_id, groups.name AS group_name,
          inserted.access, inserted.created_at, inserted.expires_at, inserted.last_used_at
        FROM inserted INNER JOIN groups ON groups.id = inserted.group_id
      `
      return { created: toApiToken(row) }
    },

    async listLive(userId) {
      const rows = await sql<ApiTokenRow[]>`
        SELECT api_tokens.id, api_tokens.name, api_tokens.group_id, groups.name AS group_name,
          api_tokens.access, api_tokens.created_at, api_tokens.expires_at, api_tokens.last_used_at
        FROM api_tokens
        INNER JOIN groups ON groups.id = api_tokens.group_id AND groups.deleted_at IS NULL
        WHERE api_tokens.user_id = ${userId}
          AND (api_tokens.expires_at IS NULL OR api_tokens.expires_at > now())
        ORDER BY api_tokens.created_at DESC, api_tokens.id
      `
      return rows.map(toApiToken)
    },

    async deleteOwn(userId, tokenId) {
      const rows = await sql`
        DELETE FROM api_tokens WHERE id = ${tokenId} AND user_id = ${userId} RETURNING id
      `
      return rows.length > 0
    },

    async findLive(hash) {
      const [row] = await sql<LiveApiToken[]>`
        SELECT api_tokens.id, api_tokens.user_id, users.mfa AS user_mfa, api_tokens.group_id,
          api_tokens.access
        FROM api_tokens
        INNER JOIN users ON users.id = api_tokens.user_id AND users.deleted_at IS NULL
        WHERE api_tokens.token_hash = ${hash}
          AND (api_tokens.expires_at IS NULL OR api_tokens.expires_at > now())
      `
      return row
        ? {
          id: row.id,
          userId: row.userId,
          userMfa: row.userMfa,
          groupId: row.groupId,
          access: row.access,
        }
        : null
    },

    async touch(tokenId, now = new Date()) {
      const rows = await sql`
        UPDATE api_tokens SET last_used_at = ${now}
        WHERE id = ${tokenId}
          AND (last_used_at IS NULL
            OR last_used_at <= ${new Date(now.getTime() - API_TOKEN_USE_RESOLUTION_MS)})
        RETURNING id
      `
      return rows.length > 0
    },
  }
}

function toApiToken(row: ApiTokenRow): ApiToken {
  return {
    id: row.id,
    name: row.name,
    groupId: row.groupId,
    groupName: row.groupName,
    access: row.access === ApiTokenAccess.WRITE ? ApiTokenAccess.WRITE : ApiTokenAccess.READ,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }
}
