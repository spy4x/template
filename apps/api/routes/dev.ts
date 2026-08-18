import { Hono } from "hono"
import { APIContext } from "../_types.ts"
import { authUsernameSchema, UserKeyKind, validate } from "@shared/types"
import { db } from "@api/services/db.ts"
import { sql, Transaction } from "@server/db"

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
    const key = await db.userKey.findOne({
      kind: UserKeyKind.USERNAME_PASSWORD,
      identification: username,
    })
    if (!key) {
      return c.json({ success: true })
    }
    const userId = key.userId
    await sql.begin(async (tx: Transaction) => {
      await tx`DELETE FROM auth_audits WHERE user_id = ${userId}`
      await tx`DELETE FROM user_push_tokens WHERE user_id = ${userId}`
      await tx`DELETE FROM user_sessions WHERE user_id = ${userId}`
      await tx`DELETE FROM user_keys WHERE user_id = ${userId}`
      await tx`DELETE FROM users WHERE id = ${userId}`
    })
    return c.json({ success: true })
  })
