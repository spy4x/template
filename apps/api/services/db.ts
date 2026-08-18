import {
  AuthAudit,
  AuthAuditBase,
  User,
  UserBase,
  UserKey,
  UserKeyKind,
  UserPushToken,
  UserPushTokenBase,
  UserSession,
  UserSessionBase,
} from "@shared/types"
import { DbServiceBase } from "@server/db"
import { publicAPICache } from "./cache.ts"
// import { getLatestMetrics } from "../routes/metric.ts"

export class DbService extends DbServiceBase {
  get user() {
    return {
      ...this.buildMethods<User, UserBase, Partial<UserBase>>(`users`, publicAPICache.user),
    }
  }

  get userSession() {
    return {
      createOne: async (params: {
        data: UserSessionBase
      }): Promise<UserSession> => {
        const created = (
          await this.sql<UserSession[]>`
            INSERT INTO user_sessions
            ${this.sql(this.sanitize(params.data))}
            RETURNING *`
        )[0]
        if (created) {
          await this.setCache(publicAPICache.userSession, created.id, created)
        }
        return created
      },
      findOne: async ({ id }: { id: number }): Promise<null | UserSession> => {
        return this.findOne(
          publicAPICache.userSession,
          id,
          this.sql<UserSession[]>`SELECT * FROM user_sessions WHERE id = ${id}`,
        )
      },
      findMany: async (params: {
        userId?: number
      }): Promise<UserSession[]> => {
        // INDEX: idx_user_sessions_by_user_id (for user_id filter)
        return await this.sql<
          UserSession[]
        >`SELECT * FROM user_sessions
      WHERE TRUE
      ${params.userId ? this.sql`AND user_id = ${params.userId}` : this.sql``}
      ORDER BY created_at DESC`
      },
      updateOne: async (params: {
        id: number
        data: Partial<UserSessionBase>
      }): Promise<UserSession> => {
        const updated = (
          await this.sql<UserSession[]>`
            UPDATE user_sessions
            SET updated_at = NOW(), ${this.sql(this.sanitize(params.data))}
            WHERE id = ${params.id}
            RETURNING *`
        )[0]
        if (updated) {
          await this.setCache(publicAPICache.userSession, updated.id, updated)
        }
        return updated
      },
      updateMany: async (params: {
        userId?: number
        expiresAt?: { lte?: Date }
        ids?: number[]
        data: Partial<UserSessionBase>
      }): Promise<UserSession[]> => {
        // INDEX: idx_user_sessions_by_user_id (for user_id), idx_user_sessions_by_expires_at (for expires_at)
        return (
          await this.sql<UserSession[]>`
            UPDATE user_sessions
            SET updated_at = NOW(), ${this.sql(this.sanitize(params.data))}
            WHERE TRUE
            ${params.userId ? this.sql`AND user_id = ${params.userId}` : this.sql``}
            ${
            params.expiresAt?.lte ? this.sql`AND expires_at <= ${params.expiresAt.lte}` : this.sql``
          }
            ${
            params.ids ? this.sql`AND id = ANY(${this.sql.array(params.ids)}::int[])` : this.sql``
          }
            RETURNING *`
        )
      },
    }
  }

  get userKey() {
    return {
      findOne: async (params: {
        id?: number
        userId?: number
        kind?: UserKeyKind
        identification?: string
      }): Promise<null | UserKey> => {
        // INDEX: idx_user_keys_by_user_id (for user_id), idx_user_keys_by_identification (for identification)
        const found = (
          await this.sql<UserKey[]>`
            SELECT *
            FROM user_keys
            WHERE TRUE
            ${params.id ? this.sql`AND id = ${params.id}` : this.sql``}
            ${params.userId ? this.sql`AND user_id = ${params.userId}` : this.sql``}
            ${params.kind !== undefined ? this.sql`AND kind = ${params.kind}` : this.sql``}
            ${
            params.identification
              ? this.sql`AND identification = ${params.identification}`
              : this.sql``
          }
            LIMIT 1`
        )[0]
        if (found) {
          await this.setCache(publicAPICache.userKey, found.id, found)
        }
        return found
      },
      findById: async (id: number): Promise<UserKey | null> => {
        return this.findOne(
          publicAPICache.userKey,
          id,
          this.sql<UserKey[]>`SELECT * FROM user_keys WHERE id = ${id}`,
        )
      },
      findMany: async (params: {
        userId?: number
        kind?: UserKeyKind
      }): Promise<UserKey[]> => {
        // INDEX: idx_user_keys_by_user_id (for user_id filter)
        return await this.sql<UserKey[]>`
        SELECT *
        FROM user_keys
        WHERE TRUE
        ${params.userId ? this.sql`AND user_id = ${params.userId}` : this.sql``}
        ${params.kind !== undefined ? this.sql`AND kind = ${params.kind}` : this.sql``}
        ORDER BY created_at DESC`
      },
      createOne: async (params: {
        userId: number
        kind: number
        identification: string
        secret: string
      }): Promise<UserKey> => {
        const created = (
          await this.sql<UserKey[]>`
            INSERT INTO user_keys (user_id, kind, identification, secret)
            VALUES (${params.userId}, ${params.kind}, ${params.identification}, ${params.secret})
            RETURNING *`
        )[0]
        if (created) {
          await this.setCache(publicAPICache.userKey, created.id, created)
        }
        return created
      },
      updateOne: async (params: {
        id: number
        data: Partial<UserKey>
      }): Promise<UserKey> => {
        const updated = (
          await this.sql<UserKey[]>`
            UPDATE user_keys
            SET updated_at = NOW(), ${this.sql(this.sanitize(params.data))}
            WHERE id = ${params.id}
            RETURNING *`
        )[0]
        if (updated) {
          await this.setCache(publicAPICache.userKey, updated.id, updated)
        }
        return updated
      },
      deleteOne: async (params: { id: number }): Promise<void> => {
        const deleted = (
          await this.sql<UserKey[]>`
            DELETE FROM user_keys
            WHERE id = ${params.id}
            RETURNING *`
        )[0]
        if (deleted) {
          await this.deleteCache(publicAPICache.userKey, params.id)
        }
      },
    }
  }

  get userPushToken() {
    return {
      ...this.buildMethods<UserPushToken, UserPushTokenBase, Partial<UserPushTokenBase>>(
        `user_push_tokens`,
        publicAPICache.userPushToken,
      ),
      findMany: async (params: { userId: number }): Promise<UserPushToken[]> => {
        return await this.sql<UserPushToken[]>`
        SELECT *
        FROM user_push_tokens
        WHERE deleted_at IS NULL AND user_id = ${params.userId}
        ORDER BY created_at DESC`
      },
      findOne: async (
        { deviceId, userId }: { deviceId: string; userId: number },
      ): Promise<null | UserPushToken> => {
        return (
          await this.sql<
            UserPushToken[]
          >`SELECT * FROM user_push_tokens WHERE deleted_at is NULL AND device_id = ${deviceId} AND user_id = ${userId}`
        )[0]
      },
      deleteOne: async (params: { deviceId: string; userId?: number }): Promise<void> => {
        await this.sql<UserPushToken[]>`
        UPDATE user_push_tokens
          SET updated_at = NOW(), deleted_at = NOW()
          WHERE device_id = ${params.deviceId} ${
          params.userId ? this.sql`AND user_id = ${params.userId}` : this.sql``
        }
          RETURNING *`
      },
      deleteByUser: async (params: { userId: number }): Promise<void> => {
        await this.sql<UserPushToken[]>`
            UPDATE user_push_tokens
            SET updated_at = NOW(), deleted_at = NOW()
            WHERE user_id = ${params.userId}
            RETURNING *`
      },
    }
  }

  get authAudit() {
    return {
      ...this.buildMethods<AuthAudit, AuthAuditBase, Partial<AuthAuditBase>>(
        `auth_audits`,
        publicAPICache.authAudit,
      ),
      findMany: async (params: { userId: number; limit?: number }): Promise<AuthAudit[]> => {
        const limit = params.limit && params.limit > 0 ? params.limit : 50
        return await this.sql<AuthAudit[]>`
        SELECT *
        FROM auth_audits
        WHERE user_id = ${params.userId}
        ORDER BY created_at DESC
        LIMIT ${limit}`
      },
    }
  }
}

export const db = new DbService()
await db.connect()
console.log(`✅ Connected to DB`)
