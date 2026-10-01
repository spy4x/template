import type { Sql } from "@spy4x/server/db"
import type { PushSubscriptionStore } from "@spy4x/integrations/push"

/** One stored Web Push subscription: a single browser on a single device of one user. */
export interface PushTokenRecord {
  id: number
  userId: number
  deviceId: string
  endpoint: string
  auth: string
  p256dh: string
  createdAt: Date
  updatedAt: Date
}

/**
 * What `WebPushService` needs from storage. `deleteByEndpoint` is the half of the library's
 * `PushSubscriptionStore` the sender calls for a subscription the push service reports gone.
 */
export interface PushTokenStore extends Pick<PushSubscriptionStore, "deleteByEndpoint"> {
  /** Live subscriptions of one user, newest first. */
  listByUser(userId: number): Promise<PushTokenRecord[]>
  /** Creates the user's subscription for this device, or replaces the one already there. */
  upsert(input: {
    userId: number
    deviceId: string
    endpoint: string
    auth: string
    p256dh: string
  }): Promise<PushTokenRecord>
  /** Marks the user's subscription for this device deleted. Other users' rows are never touched. */
  remove(input: { userId: number; deviceId: string }): Promise<void>
}

/**
 * The store over `user_push_tokens`. Needs a client built with `postgres.camel` (as `db.ts` does),
 * so columns come back as `userId`, `deviceId` and so on. Reads and writes go straight to
 * Postgres, never through a cache: a subscription that was removed must not be sent to.
 */
export function createPushTokenStore(sql: Sql): PushTokenStore {
  return {
    async listByUser(userId) {
      return await sql<PushTokenRecord[]>`
        SELECT id, user_id, device_id, endpoint, auth, p256dh, created_at, updated_at
        FROM user_push_tokens
        WHERE deleted_at IS NULL AND user_id = ${userId}
        ORDER BY created_at DESC, id DESC`
    },
    async upsert({ userId, deviceId, endpoint, auth, p256dh }) {
      const rows = await sql<PushTokenRecord[]>`
        INSERT INTO user_push_tokens (user_id, device_id, endpoint, auth, p256dh)
        VALUES (${userId}, ${deviceId}, ${endpoint}, ${auth}, ${p256dh})
        ON CONFLICT (user_id, device_id) WHERE deleted_at IS NULL
        DO UPDATE SET endpoint = EXCLUDED.endpoint, auth = EXCLUDED.auth,
          p256dh = EXCLUDED.p256dh, updated_at = NOW()
        RETURNING id, user_id, device_id, endpoint, auth, p256dh, created_at, updated_at`
      return rows[0]
    },
    async remove({ userId, deviceId }) {
      await sql`
        UPDATE user_push_tokens
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE deleted_at IS NULL AND user_id = ${userId} AND device_id = ${deviceId}`
    },
    async deleteByEndpoint(userId, endpoint) {
      await sql`
        UPDATE user_push_tokens
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE deleted_at IS NULL AND user_id = ${userId} AND endpoint = ${endpoint}`
    },
  }
}
