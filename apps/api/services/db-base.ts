import { DbServiceBase, type RowCache, type Sql } from "@spy4x/server/db"
import type { AuthSessionRecord, AuthStore } from "@spy4x/server/auth"
import { createPostgresAuthStore, createPostgresSessionStore } from "@spy4x/server/auth/postgres"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import type { SessionStore } from "@spy4x/server/sign-in"
import type { AuthAuditBase, User, UserBase } from "@domain/identity"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { PostgresGroupActivityRepository } from "@server/groups/postgres-activity-repository.ts"
import { PostgresNoteRepository } from "@server/notes/postgres-note-repository.ts"
import { PostgresBillingRepository } from "@server/billing/postgres-billing-repository.ts"
import { emailChanges } from "@server/auth/email-verification.ts"

/** A user's authenticator-app enrolment, one row of `user_totp`. */
export interface UserTotp {
  userId: number
  /** Base32 secret from `generateTotpSecret`. */
  secret: string
  /** `null` while enrolment is not finished. */
  confirmedAt: Date | null
  /** Time step of the last accepted code, or `null` when none was accepted yet. */
  lastAcceptedStep: number | null
}

/** A cache that stores nothing: every read goes to the database. */
const noCache: RowCache<User> = {
  wrap: (_key, compute) => compute(),
  set: () => Promise.resolve(),
  delete: () => Promise.resolve(),
}

/** Options for {@link AppDbBase}. */
export interface AppDbBaseOptions {
  sql: Sql
  /**
   * Cache for `users` rows, read only through `user.findOneCached` (display data). Defaults to
   * none. Nothing that decides authentication or a role reads it: see `user.findOne`.
   */
  userCache?: RowCache<User>
}

/**
 * The part of `DbService` that needs nothing but a `sql` client and an optional user cache - no
 * config, no `Deno.env` read. Split out so the integration tests can construct the exact class
 * `apps/api/services/db.ts` uses for `db.group`, `db.user` and the sign-in stores, instead of a
 * lookalike copy that only guards itself: a copy caught nothing when a reviewer cached `group` in
 * the real `DbService` and left the test's own `TestDb` untouched.
 */
export class AppDbBase extends DbServiceBase {
  /**
   * Not a `#private` field: `begin()` hands its callback an `Object.create(this)` clone, and a
   * `#private` field cannot be read through a clone's prototype chain.
   */
  private readonly userCache: RowCache<User>

  constructor(options: AppDbBaseOptions) {
    super({ sql: options.sql })
    this.userCache = options.userCache ?? noCache
  }

  /**
   * Built per access on purpose. `DbServiceBase.begin()` derives the transactional
   * service with `Object.create(this)` and rebinds `sql`, so a cached repository
   * would keep the pool connection and silently escape the transaction.
   */
  get group(): PostgresGroupRepository {
    return new PostgresGroupRepository(this.sql)
  }

  /** The read side of a group's activity log. Built per access, like `group`. */
  get groupActivity(): PostgresGroupActivityRepository {
    return new PostgresGroupActivityRepository(this.sql)
  }

  /** The notes repository. Built per access, like `group`, so inside `begin()` it uses the transaction. */
  get note(): PostgresNoteRepository {
    return new PostgresNoteRepository(this.sql)
  }

  /** Each group's subscription and customer. Built per access, like `group`. */
  get billing(): PostgresBillingRepository {
    return new PostgresBillingRepository(this.sql)
  }

  /**
   * The `@spy4x/server` auth store over `auth_users` and `auth_keys`. Built per access, like
   * `group`, so inside `begin()` it writes through the transaction: given a transaction handle, the
   * store runs its multi-statement writes in a savepoint of it (spy4x/ts-libs#161).
   */
  get authStore(): AuthStore {
    return createPostgresAuthStore(this.sql)
  }

  /** The `@spy4x/server` session store over `auth_sessions`. Built per access, like `group`. */
  get sessionStore(): SessionStore<AuthSessionRecord> {
    return createPostgresSessionStore(this.sql)
  }

  /**
   * Locks a password key until the transaction ends: the user's, or the one whose subject is the
   * address. A password reset and an address move both take this lock first, so one waits for the
   * other and neither copies a password hash the other is replacing (#140). Inside `begin()` only.
   */
  async lockPasswordKey(where: { userId: number } | { subject: string }): Promise<void> {
    if ("userId" in where) {
      await this.sql`
        SELECT 1 FROM auth_keys
        WHERE method = ${PASSWORD_METHOD} AND user_id = ${where.userId}
        FOR UPDATE
      `
    } else {
      await this.sql`
        SELECT 1 FROM auth_keys
        WHERE method = ${PASSWORD_METHOD} AND subject = ${where.subject}
        FOR UPDATE
      `
    }
  }

  /**
   * The `auth_audits` rows. Built per access, like `group`: each row is written inside the
   * transaction of the action it records, so the action and its row are kept or undone together.
   */
  get authAudit() {
    const sql = this.sql
    return {
      /**
       * Writes one row. The client sends the IP and the user agent, so both are cut to their
       * column width: a long header must never fail the action the row records.
       */
      insert: async (row: AuthAuditBase): Promise<void> => {
        const ip = row.ip?.slice(0, 45) ?? null
        const userAgent = row.userAgent?.slice(0, 300) ?? null
        await sql`
          INSERT INTO auth_audits (user_id, event_type, identifier, ip, user_agent)
          VALUES (${row.userId}, ${row.eventType}, ${row.identifier}, ${ip}, ${userAgent})
        `
      },
    }
  }

  /** The address change waiting for its code. Built per access, like `group`. */
  get emailChange(): ReturnType<typeof emailChanges> {
    return emailChanges(this.sql)
  }

  get user() {
    const cache = this.userCache
    const cached = this.buildMethods<User, UserBase, Partial<UserBase>>(`users`, cache)
    const fresh = this.buildMethods<User, UserBase, Partial<UserBase>>(`users`, noCache)
    return {
      ...cached,
      /**
       * One row straight from Postgres. Everything that decides authentication or a role reads
       * through this (`mfa`, `role`): Valkey is a separate service that another process may be able
       * to write to, so what it holds must never decide who is allowed in. It costs one indexed
       * query by primary key per call.
       */
      findOne: fresh.findOne,
      /**
       * The same row through the Valkey cache, up to 30 days old or forged. For display only:
       * never let `mfa` or `role` from this row decide anything.
       */
      findOneCached: cached.findOne,
      /** Creates the profile row of a new auth user; `users.id` is the auth user's id. */
      createForAuthUser: (id: number, data: UserBase): Promise<User> =>
        this.createOne<User>(
          cache,
          this.sql<User[]>`
            INSERT INTO users ${this.sql(this.sanitize({ id, ...data }))}
            RETURNING *
          `,
        ),
    }
  }

  get userTotp() {
    const sql = this.sql
    const columns = () =>
      sql`
        user_id AS "userId", secret, confirmed_at AS "confirmedAt",
        last_accepted_step AS "lastAcceptedStep"
      `
    return {
      find: async (userId: number): Promise<UserTotp | null> =>
        (await sql<UserTotp[]>`SELECT ${columns()} FROM user_totp WHERE user_id = ${userId}`)[0] ??
          null,
      /** Starts (or restarts) an unfinished enrolment. Never touches a confirmed one. */
      savePending: async (userId: number, secret: string): Promise<boolean> =>
        (await sql`
          INSERT INTO user_totp (user_id, secret) VALUES (${userId}, ${secret})
          ON CONFLICT (user_id) DO UPDATE
            SET secret = EXCLUDED.secret, last_accepted_step = NULL, updated_at = NOW()
            WHERE user_totp.confirmed_at IS NULL
          RETURNING user_id
        `).length === 1,
      /**
       * Finishes enrolment with the step of the code that proved it. Conditional, so a step that
       * is not later than the last accepted one changes nothing.
       */
      confirm: async (userId: number, step: number): Promise<boolean> =>
        (await sql`
          UPDATE user_totp
          SET confirmed_at = NOW(), last_accepted_step = ${step}, updated_at = NOW()
          WHERE user_id = ${userId} AND confirmed_at IS NULL
            AND (last_accepted_step IS NULL OR last_accepted_step < ${step})
          RETURNING user_id
        `).length === 1,
      /**
       * Records the step of an accepted code on a confirmed enrolment. Conditional, so of two
       * requests carrying the same code only one succeeds.
       */
      acceptStep: async (userId: number, step: number): Promise<boolean> =>
        (await sql`
          UPDATE user_totp SET last_accepted_step = ${step}, updated_at = NOW()
          WHERE user_id = ${userId} AND confirmed_at IS NOT NULL
            AND (last_accepted_step IS NULL OR last_accepted_step < ${step})
          RETURNING user_id
        `).length === 1,
      /** Removes the enrolment, finished or not. */
      remove: async (userId: number): Promise<void> => {
        await sql`DELETE FROM user_totp WHERE user_id = ${userId}`
      },
      deleteConfirmed: async (userId: number): Promise<boolean> =>
        (await sql`
          DELETE FROM user_totp WHERE user_id = ${userId} AND confirmed_at IS NOT NULL
          RETURNING user_id
        `).length === 1,
    }
  }
}
