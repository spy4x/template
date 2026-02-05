import {
  User,
  UserBase,
  AuthAudit,
  AuthAuditBase,
  UserKey,
  UserKeyKind,
  UserPushToken,
  UserPushTokenBase,
  UserSession,
  UserSessionBase,
} from "@shared/types"
import { DbServiceBase } from "@server/db"
import { publicAPICache } from "./cache.ts"
import type { GithubActionRun, GithubWebhookEvent } from "@api/services/github/types.ts"
import { GithubActionStatus, GithubWebhookStatus } from "@api/services/github/types.ts"
// import { getLatestMetrics } from "../routes/metric.ts"

export class DbService extends DbServiceBase {
  githubWebhookEvent = {
    createOne: async (params: {
      deliveryId: string
      event: string
      action?: string | null
      repoFullName?: string | null
      payload: unknown
      status?: GithubWebhookStatus
      error?: string | null
    }): Promise<GithubWebhookEvent> => {
      const created = (
        await this.sql<GithubWebhookEvent[]>`
          INSERT INTO github_webhook_events
            (delivery_id, event, action, repo_full_name, payload, status, error)
          VALUES (
            ${params.deliveryId},
            ${params.event},
            ${params.action ?? null},
            ${params.repoFullName ?? null},
            ${JSON.stringify(params.payload)},
            ${params.status ?? GithubWebhookStatus.RECEIVED},
            ${params.error ?? null}
          )
          ON CONFLICT (delivery_id) DO NOTHING
          RETURNING *`
      )[0]
      if (created) return created
      return (
        await this.sql<GithubWebhookEvent[]>`
          SELECT * FROM github_webhook_events WHERE delivery_id = ${params.deliveryId} LIMIT 1`
      )[0]
    },
    updateStatus: async (params: {
      id: number
      status: GithubWebhookStatus
      error?: string | null
    }): Promise<GithubWebhookEvent> => {
      const updated = (
        await this.sql<GithubWebhookEvent[]>`
          UPDATE github_webhook_events
          SET status = ${params.status}, error = ${params.error ?? null}
          WHERE id = ${params.id}
          RETURNING *`
      )[0]
      return updated
    },
    claimBatch: async (params: { limit: number }): Promise<GithubWebhookEvent[]> => {
      return await this.sql<GithubWebhookEvent[]>`
        UPDATE github_webhook_events
        SET status = ${GithubWebhookStatus.PROCESSING}
        WHERE id IN (
          SELECT id FROM github_webhook_events
          WHERE status = ${GithubWebhookStatus.RECEIVED}
          ORDER BY received_at ASC
          LIMIT ${params.limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *`
    },
  }

  githubActionRun = {
    createOne: async (params: {
      webhookEventId?: number | null
      actionKind: number
      command?: string | null
      args?: unknown | null
      status?: GithubActionStatus
      stdout?: string | null
      stderr?: string | null
    }): Promise<GithubActionRun> => {
      const created = (
        await this.sql<GithubActionRun[]>`
          INSERT INTO github_action_runs
            (webhook_event_id, action_kind, command, args, status, stdout, stderr)
          VALUES (
            ${params.webhookEventId ?? null},
            ${params.actionKind},
            ${params.command ?? null},
            ${params.args ? JSON.stringify(params.args) : null},
            ${params.status ?? GithubActionStatus.QUEUED},
            ${params.stdout ?? null},
            ${params.stderr ?? null}
          )
          RETURNING *`
      )[0]
      return created
    },
    updateOne: async (params: {
      id: number
      status: GithubActionStatus
      stdout?: string | null
      stderr?: string | null
    }): Promise<GithubActionRun> => {
      const updated = (
        await this.sql<GithubActionRun[]>`
          UPDATE github_action_runs
          SET updated_at = NOW(), status = ${params.status},
            stdout = ${params.stdout ?? null}, stderr = ${params.stderr ?? null}
          WHERE id = ${params.id}
          RETURNING *`
      )[0]
      return updated
    },
    findLatestByIssue: async (params: {
      repoFullName: string
      issueNumber: number
    }): Promise<GithubActionRun | null> => {
      return (
        await this.sql<GithubActionRun[]>`
          SELECT * FROM github_action_runs
          WHERE args->>'repoFullName' = ${params.repoFullName}
            AND args->>'issueNumber' = ${String(params.issueNumber)}
          ORDER BY created_at DESC
          LIMIT 1`
      )[0] ?? null
    },
  }
  user = {
    ...this.buildMethods<User, UserBase, Partial<UserBase>>(`users`, publicAPICache.user),
  }

  userSession = {
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
        await publicAPICache.userSession.set(created.id, created)
      }
      return created
    },
    findOne: async ({ id }: { id: number }): Promise<null | UserSession> => {
      return publicAPICache.userSession.wrap(
        id,
        async () =>
          (await this.sql<UserSession[]>`SELECT * FROM user_sessions WHERE id = ${id}`)[0],
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
        await publicAPICache.userSession.set(updated.id, updated)
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

  userKey = {
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
        await publicAPICache.userKey.set(found.id, found)
      }
      return found
    },
    findById: async (id: number): Promise<UserKey | null> => {
      return publicAPICache.userKey.wrap(
        id,
        async () => (await this.sql<UserKey[]>`SELECT * FROM user_keys WHERE id = ${id}`)[0],
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
        await publicAPICache.userKey.set(created.id, created)
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
        await publicAPICache.userKey.set(updated.id, updated)
      }
      return updated
    },
    deleteOne: async (params: { id: number }): Promise<void> => {
      const deleted = await this.sql<UserKey[]>`
            DELETE FROM user_keys
            WHERE id = ${params.id}
            RETURNING *`
      if (deleted) {
        await publicAPICache.userKey.delete(params.id)
      }
    },
  }

  userPushToken = {
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

  authAudit = {
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

  githubInstallation = {
    findByInstallationId: async (installationId: number) => {
      return (
        await this.sql<Array<{
          id: number
          userId: number
          installationId: number
          accountLogin: string
          accountType: number
          reposAccess: number
          suspended: boolean
          createdAt: Date
          updatedAt: Date
        }>>`
          SELECT * FROM github_installations
          WHERE installation_id = ${installationId}
          LIMIT 1
        `
      )[0] ?? null
    },
    findByUserId: async (userId: number) => {
      return await this.sql<Array<{
        id: number
        userId: number
        installationId: number
        accountLogin: string
        accountType: number
        reposAccess: number
        suspended: boolean
        createdAt: Date
        updatedAt: Date
        repoCount: number
      }>>`
        SELECT 
          gi.*,
          COUNT(gr.id)::int as repo_count
        FROM github_installations gi
        LEFT JOIN github_repos gr ON gr.installation_id = gi.id
        WHERE gi.user_id = ${userId}
        GROUP BY gi.id
        ORDER BY gi.created_at DESC
      `
    },
    suspend: async (id: number) => {
      return (
        await this.sql<Array<{
          id: number
          userId: number
          installationId: number
          accountLogin: string
          accountType: number
          reposAccess: number
          suspended: boolean
          createdAt: Date
          updatedAt: Date
        }>>`
          UPDATE github_installations
          SET suspended = TRUE, updated_at = CURRENT_TIMESTAMP
          WHERE id = ${id}
          RETURNING *
        `
      )[0] ?? null
    },
    suspendByInstallationId: async (installationId: number) => {
      return (
        await this.sql<Array<{
          id: number
          userId: number
          installationId: number
          accountLogin: string
          accountType: number
          reposAccess: number
          suspended: boolean
          createdAt: Date
          updatedAt: Date
        }>>`
          UPDATE github_installations
          SET suspended = TRUE, updated_at = CURRENT_TIMESTAMP
          WHERE installation_id = ${installationId}
          RETURNING *
        `
      )[0] ?? null
    },
    upsert: async (params: {
      userId: number | null
      installationId: number
      accountLogin: string
      accountType: number
      reposAccess: number
    }) => {
      // user_id has NOT NULL constraint, skip if null (will link later via OAuth)
      if (!params.userId) {
        console.log(`⚠️  Skip upsert installation ${params.installationId} - no user_id`)
        return null
      }
      return (
        await this.sql<Array<{
          id: number
          userId: number
          installationId: number
          accountLogin: string
          accountType: number
          reposAccess: number
          suspended: boolean
          createdAt: Date
          updatedAt: Date
        }>>`
          INSERT INTO github_installations
            (user_id, installation_id, account_login, account_type, repos_access, suspended)
          VALUES (
            ${params.userId},
            ${params.installationId},
            ${params.accountLogin},
            ${params.accountType},
            ${params.reposAccess},
            FALSE
          )
          ON CONFLICT (installation_id)
          DO UPDATE SET
            user_id = ${params.userId},
            account_login = ${params.accountLogin},
            account_type = ${params.accountType},
            repos_access = ${params.reposAccess},
            suspended = FALSE,
            updated_at = CURRENT_TIMESTAMP
          RETURNING *
        `
      )[0] ?? null
    },
  }

  githubInstallationToken = {
    findByInstallationId: async (installationId: number) => {
      return (
        await this.sql<Array<{
          id: number
          installationId: number
          token: string
          expiresAt: Date
          createdAt: Date
        }>>`
          SELECT * FROM github_installation_tokens
          WHERE installation_id = ${installationId}
          LIMIT 1
        `
      )[0] ?? null
    },
    upsert: async (params: {
      installationId: number
      token: string
      expiresAt: Date
    }) => {
      return (
        await this.sql<Array<{
          id: number
          installationId: number
          token: string
          expiresAt: Date
          createdAt: Date
        }>>`
          INSERT INTO github_installation_tokens
            (installation_id, token, expires_at)
          VALUES (${params.installationId}, ${params.token}, ${params.expiresAt})
          ON CONFLICT (installation_id)
          DO UPDATE SET
            token = ${params.token},
            expires_at = ${params.expiresAt},
            created_at = CURRENT_TIMESTAMP
          RETURNING *
        `
      )[0]
    },
  }

  githubRepo = {
    findByFullName: async (repoFullName: string) => {
      return (
        await this.sql<Array<{
          id: number
          installationId: number
          repoId: number
          repoFullName: string
          private: boolean
          webhookEnabled: boolean
          createdAt: Date
        }>>`
          SELECT * FROM github_repos
          WHERE repo_full_name = ${repoFullName}
          LIMIT 1
        `
      )[0] ?? null
    },
    findByUserId: async (userId: number) => {
      return await this.sql<Array<{
        id: number
        installationId: number
        repoId: number
        repoFullName: string
        private: boolean
        webhookEnabled: boolean
        createdAt: Date
      }>>`
        SELECT gr.*
        FROM github_repos gr
        INNER JOIN github_installations gi ON gi.id = gr.installation_id
        WHERE gi.user_id = ${userId}
        ORDER BY gr.created_at DESC
      `
    },
    upsert: async (params: {
      installationId: number
      repoId: number
      repoFullName: string
      private: boolean
    }) => {
      return (
        await this.sql<Array<{
          id: number
          installationId: number
          repoId: number
          repoFullName: string
          private: boolean
          webhookEnabled: boolean
          createdAt: Date
        }>>`
          INSERT INTO github_repos
            (installation_id, repo_id, repo_full_name, private)
          VALUES (
            ${params.installationId},
            ${params.repoId},
            ${params.repoFullName},
            ${params.private}
          )
          ON CONFLICT (repo_id)
          DO UPDATE SET
            installation_id = ${params.installationId},
            repo_full_name = ${params.repoFullName},
            private = ${params.private}
          RETURNING *
        `
      )[0]
    },
    deleteByRepoId: async (repoId: number) => {
      await this.sql`
        DELETE FROM github_repos
        WHERE repo_id = ${repoId}
      `
    },
  }
}

export const db = new DbService()
await db.connect()
console.log(`✅ Connected to DB`)
