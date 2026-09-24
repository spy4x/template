import { AuthAudit, AuthAuditBase, UserPushToken, UserPushTokenBase } from "@domain/identity"
import postgres from "postgres"
import { createSqlFromEnv, type Sql } from "@spy4x/server/db"
import { publicAPICache } from "./cache.ts"
import { AppDbBase } from "./db-base.ts"
// import { getLatestMetrics } from "../routes/metric.ts"

/**
 * The client every table method and the group repository run against.
 *
 * `DB_PORT` is optional so existing environments that omit it keep the 5432 default,
 * but it is honoured when set - `.env.example` and CI both define it.
 */
export const sql: Sql = (() => {
  const client = createSqlFromEnv(Deno.env.toObject(), {
    transform: postgres.camel,
    applicationName: "app-backend",
    // The driver's own default (postgres@3.4.7 src/index.js:449) was 10, not the
    // package's default of 15; compose limits Postgres to max_connections=30 and both
    // this pool and the worker's draw from it, so the old ceiling is kept explicitly.
    max: 10,
  })
  if (!client) {
    throw new Error("Missing environment variable: DB_HOST")
  }
  return client
})()

export class DbService extends AppDbBase {
  constructor() {
    super({ sql, userCache: publicAPICache.user })
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
