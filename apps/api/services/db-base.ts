import { DbServiceBase, type RowCache, type Sql, type Transaction } from "@spy4x/server/db"
import type { AuthSessionRecord, AuthStore } from "@spy4x/server/auth"
import { createPostgresAuthStore, createPostgresSessionStore } from "@spy4x/server/auth/postgres"
import type { SessionStore } from "@spy4x/server/sign-in"
import type { User, UserBase } from "@domain/identity"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"

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
  /** Cache for `users` rows. Defaults to none. */
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

  /**
   * The `@spy4x/server` auth store over `auth_users` and `auth_keys`. Built per access, like
   * `group`, so inside `begin()` it writes through the transaction.
   */
  get authStore(): AuthStore {
    return createPostgresAuthStore(joinable(this.sql))
  }

  /** The `@spy4x/server` session store over `auth_sessions`. Built per access, like `group`. */
  get sessionStore(): SessionStore<AuthSessionRecord> {
    return createPostgresSessionStore(this.sql)
  }

  get user() {
    const cache = this.userCache
    return {
      ...this.buildMethods<User, UserBase, Partial<UserBase>>(`users`, cache),
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
      deleteConfirmed: async (userId: number): Promise<boolean> =>
        (await sql`
          DELETE FROM user_totp WHERE user_id = ${userId} AND confirmed_at IS NOT NULL
          RETURNING user_id
        `).length === 1,
    }
  }
}

/**
 * The client the auth store is given. The store opens its own transaction with `sql.begin` for
 * each write. A transaction handle has no `begin`, so inside `DbServiceBase.begin()` the handle is
 * given one that opens a savepoint instead: the store's writes then commit or roll back with the
 * surrounding transaction, and a refused write rolls back only its own savepoint.
 */
function joinable(sql: Sql): Sql {
  if (typeof (sql as { begin?: unknown }).begin === "function") return sql
  const transaction = sql as unknown as Transaction
  return new Proxy(sql, {
    get(target, property, receiver) {
      if (property === "begin") {
        return <T>(body: (tx: Transaction) => T | Promise<T>) => transaction.savepoint(body)
      }
      return Reflect.get(target, property, receiver)
    },
  })
}
