import { Hono } from "hono"
import { APIContext } from "../_types.ts"
import { validate } from "@spy4x/validation"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { authUsernameSchema } from "@domain/identity"
import type { Sql, Transaction } from "@spy4x/server/db"
import type { AppDbBase } from "@api/services/db-base.ts"
import { readApiJson } from "@api/services/json-body.ts"

/** What the development-only routes need. */
export interface DevRouteDeps {
  /** Refuses every request with 403 when false, in case the route is ever mounted outside dev. */
  isDev: boolean
  /** Finds the user behind a password username. */
  db: Pick<AppDbBase, "authStore">
  /** The client the cleanup's transaction runs on. */
  sql: Sql
}

/**
 * Routes that exist only in development, for the e2e specs and local scripts.
 *
 * `POST /cleanup-user` with `{ username }` deletes that user and everything that would stop the
 * delete: the groups they own or created (with their memberships, audit and outbox events), the
 * audit and outbox events they are the actor of, and the memberships they granted in other groups.
 * It answers 200 when the username has no user, so a spec can call it before its own sign-up.
 */
export function createDevRoute(deps: DevRouteDeps) {
  return new Hono<APIContext>()
    .post("/cleanup-user", async (c) => {
      if (!deps.isDev) {
        return c.json({ error: "Not allowed" }, 403)
      }
      let body: unknown = null
      try {
        body = await readApiJson(c)
      } catch (_error) {
        body = null
      }
      const validation = validate(authUsernameSchema, body)
      if (validation.error) {
        return c.json({ error: validation.error.description }, 400)
      }
      const { username } = validation.data
      const key = await deps.db.authStore.findKey(PASSWORD_METHOD, username)
      if (!key) {
        return c.json({ success: true })
      }
      await deleteUser(deps.sql, key.userId)
      return c.json({ success: true })
    })
}

/** Deletes the user `userId` and every row that references them or a group they own. */
async function deleteUser(sql: Sql, userId: number): Promise<void> {
  await sql.begin(async (tx: Transaction) => {
    // A fresh fragment per statement: postgres.js runs a query object once.
    const owned = () =>
      tx`SELECT id FROM groups WHERE owner_user_id = ${userId} OR created_by_user_id = ${userId}`
    await tx`DELETE FROM audit_events WHERE actor_user_id = ${userId} OR group_id IN (${owned()})`
    await tx`DELETE FROM outbox_events WHERE actor_user_id = ${userId} OR group_id IN (${owned()})`
    await tx`
      DELETE FROM group_members WHERE added_by_user_id = ${userId} OR group_id IN (${owned()})
    `
    await tx`DELETE FROM groups WHERE id IN (${owned()})`
    await tx`DELETE FROM auth_audits WHERE user_id = ${userId}`
    await tx`DELETE FROM user_push_tokens WHERE user_id = ${userId}`
    // Deleting the auth user also deletes its keys, sessions, profile row and TOTP enrolment.
    await tx`DELETE FROM auth_users WHERE id = ${userId}`
  })
}
