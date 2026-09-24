import { Hono } from "hono"
import { APIContext } from "../_types.ts"
import { validate } from "@spy4x/validation"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { authUsernameSchema } from "@domain/identity"
import { db, sql } from "@api/services/db.ts"
import type { Transaction } from "@spy4x/server/db"

export const devRoute = new Hono<APIContext>()
  .post("/cleanup-user", async (c) => {
    if (Deno.env.get("ENV") !== "dev") {
      return c.json({ error: "Not allowed" }, 403)
    }
    let body: unknown = null
    try {
      body = await c.req.json()
    } catch (_error) {
      body = null
    }
    const validation = validate(authUsernameSchema, body)
    if (validation.error) {
      return c.json({ error: validation.error.description }, 400)
    }
    const { username } = validation.data
    const key = await db.authStore.findKey(PASSWORD_METHOD, username)
    if (!key) {
      return c.json({ success: true })
    }
    const userId = key.userId
    await sql.begin(async (tx: Transaction) => {
      await tx`DELETE FROM auth_audits WHERE user_id = ${userId}`
      await tx`DELETE FROM user_push_tokens WHERE user_id = ${userId}`
      // Deleting the auth user also deletes its keys, sessions, profile row and TOTP enrolment.
      await tx`DELETE FROM auth_users WHERE id = ${userId}`
    })
    return c.json({ success: true })
  })
