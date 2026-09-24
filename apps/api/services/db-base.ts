import { DbServiceBase } from "@spy4x/server/db"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"

/**
 * The part of `DbService` that needs nothing but a `sql` client - no cache, no config, no
 * `Deno.env` read. Split out so `tests/integration/db-group-transaction.integration.test.ts`
 * can construct the exact class `apps/api/services/db.ts` uses for `db.group`, instead of a
 * lookalike copy that only guards itself: a copy caught nothing when a reviewer cached
 * `group` in the real `DbService` and left this test's own `TestDb` untouched.
 */
export class AppDbBase extends DbServiceBase {
  /**
   * Built per access on purpose. `DbServiceBase.begin()` derives the transactional
   * service with `Object.create(this)` and rebinds `sql`, so a cached repository
   * would keep the pool connection and silently escape the transaction.
   */
  get group(): PostgresGroupRepository {
    return new PostgresGroupRepository(this.sql)
  }
}
