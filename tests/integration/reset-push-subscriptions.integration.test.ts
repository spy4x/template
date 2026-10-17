/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import type postgres from "postgres"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn } from "../../apps/api/services/sign-in.ts"
import { createPushTokenStore } from "../../apps/api/services/push-token-store.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { issuePasswordReset } from "../../libs/server/auth/password-reset.ts"
import { insertUser, withSchema } from "./group-team.ts"

/**
 * A password reset removes every push subscription of the account (#409), against a real Postgres
 * built from schema.sql. The case it closes: somebody signs up first with the owner's address and
 * switches notifications on in their own browser; after the owner takes the account back with a
 * reset link, that browser must not get the account's notifications any more. Needs "DB_HOST",
 * "DB_USER", "DB_PASS" and "DB_NAME" (recipe in docs/handoff.md); it fails when they are missing.
 */

// Test-only secrets, long enough for the package's 32-character minimum.
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"
const EMAIL = "owner@example.com"

/** The sign-in service over the real stores, and the user id of an account signed up with EMAIL. */
async function signedUp(sql: postgres.Sql) {
  const db = new AppDbBase({ sql })
  const signIn = createSignIn({
    db,
    pepper: PEPPER,
    cookieSecret: COOKIE_SECRET,
    secureCookie: false,
    sessionMinutes: 60,
    totpIssuer: "example.test",
  })
  // Sign-up sets a cookie, so it runs inside a request.
  let userId: number | null = null
  await new Hono<APIContext>().post("/", async (c) => {
    userId = (await signIn.signUp(c, EMAIL, "Squatter-0123", uuidV7()))?.user.id ?? null
    return c.body(null, 204)
  }).request("/", { method: "POST" })
  if (userId === null) throw new Error("The sign-up was refused")
  return { db, signIn, userId: userId as number }
}

/** Stores a push subscription for `userId` on a device of its own. */
async function subscribe(sql: postgres.Sql, userId: number): Promise<void> {
  const deviceId = uuidV7()
  await createPushTokenStore(sql).upsert({
    userId,
    deviceId,
    endpoint: `https://push.example/${deviceId}`,
    auth: "auth",
    p256dh: "p256dh",
  })
}

async function liveSubscriptions(sql: postgres.Sql, userId: number): Promise<number> {
  return (await createPushTokenStore(sql).listByUser(userId)).length
}

async function isProven(sql: postgres.Sql, userId: number): Promise<boolean> {
  const [key] = await sql<{ provenAt: Date | null }[]>`
    SELECT proven_at FROM auth_keys WHERE user_id = ${userId} AND email = ${EMAIL}
  `
  if (!key) throw new Error("The account has no key for the address")
  return key.provenAt !== null
}

Deno.test("a reset that proves the address removes every push subscription of the account and none of another account's", async () => {
  await withSchema(async (sql) => {
    const { db, signIn, userId } = await signedUp(sql)
    const stranger = await insertUser(sql)
    // Whoever signed up with the address switches notifications on in two browsers.
    await subscribe(sql, userId)
    await subscribe(sql, userId)
    await subscribe(sql, stranger)
    expect(await isProven(sql, userId)).toBe(false)

    const issued = await issuePasswordReset(db.authStore, EMAIL)
    if (!issued) throw new Error("No reset was issued")
    expect(await signIn.resetPassword(issued.email, issued.code, "Owner-0123456")).toBe(true)

    expect(await isProven(sql, userId)).toBe(true)
    expect(await liveSubscriptions(sql, userId)).toBe(0)
    expect(await liveSubscriptions(sql, stranger)).toBe(1)
  })
})

Deno.test("a reset of an address proven before removes every push subscription of the account too", async () => {
  await withSchema(async (sql) => {
    const { db, signIn, userId } = await signedUp(sql)
    const first = await issuePasswordReset(db.authStore, EMAIL)
    if (!first) throw new Error("No reset was issued")
    expect(await signIn.resetPassword(first.email, first.code, "Owner-0123456")).toBe(true)
    expect(await isProven(sql, userId)).toBe(true)
    // The owner switches notifications on after the first reset; the second reset is the one
    // under test.
    await subscribe(sql, userId)
    expect(await liveSubscriptions(sql, userId)).toBe(1)

    const second = await issuePasswordReset(db.authStore, EMAIL)
    if (!second) throw new Error("No second reset was issued")
    expect(await signIn.resetPassword(second.email, second.code, "Owner-6543210")).toBe(true)

    expect(await liveSubscriptions(sql, userId)).toBe(0)
  })
})
