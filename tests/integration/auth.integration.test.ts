/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import postgres from "postgres"
import * as OTPAuth from "@hectorm/otpauth"
import { AUTH_POSTGRES_SCHEMA } from "@spy4x/server/auth/postgres"
import {
  createPasswordHasher,
  type PasswordHasher,
  SecondFactorStatus,
  SessionStatus,
} from "@spy4x/server/sign-in"
import { UserMFAStatus } from "@domain/identity"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn, type SignIn } from "../../apps/api/services/sign-in.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import {
  consumePasswordReset,
  issuePasswordReset,
  PASSWORD_RESET_PURPOSE,
} from "../../libs/server/auth/password-reset.ts"
import { sha256Hex } from "@spy4x/platform/tokens"
import { requireDbConnection } from "./db-connection.ts"

/**
 * Sign-up, sign-in, sign-out and the authenticator app against a real Postgres, through the exact
 * `createSignIn` and `AppDbBase` the API runs, and the migration onto the package's tables.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

const AUTH_MIGRATION = "2026_09_24_0001_auth_package_tables.sql"
/** Drops the group kind, so a group is inserted without it. */
const KIND_MIGRATION = "2026_10_07_0001_group_kind_removed.sql"
const MASTER_MIGRATIONS = [
  "2026_01_26_0001_init.sql",
  "2026_01_26_0002_auth_profiles_audit.sql",
  "2026_01_27_0001_drop_user_profiles.sql",
  "2026_08_18_0001_group_core.sql",
  "2026_08_18_0002_personal_group_backfill.sql",
]
// Test-only secrets, long enough for the package's 32-character minimum.
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"

interface CountRow extends postgres.Row {
  count: number
}

/** Runs `body` against a fresh schema with `migrations` applied, and drops the schema after. */
async function withSchema(
  migrations: string[],
  body: (sql: postgres.Sql) => Promise<void>,
): Promise<void> {
  const settings = requireDbConnection()
  const admin = postgres({ ...settings, max: 1 })
  const schema = `auth_test_${crypto.randomUUID().replaceAll("-", "")}`
  const sql = postgres({
    ...settings,
    max: 25,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    for (const migration of migrations) await applyMigration(sql, migration)
    await body(sql)
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
}

async function applyMigration(sql: postgres.Sql, name: string): Promise<void> {
  await sql.unsafe(await Deno.readTextFile(`libs/server/db/migrations/${name}`))
}

/** A test app with the routes the API mounts, over `createSignIn`, and a one-user cookie jar. */
function buildApp(signIn: SignIn) {
  const app = new Hono<APIContext>()
  app.use(signIn.auth.parseAuth)
  app.post("/sign-up", async (c) => {
    const { email, password, groupId } = await c.req.json()
    const result = await signIn.signUp(c, email, password, groupId)
    return result ? c.json(result.user) : c.json({ error: "refused" }, 401)
  })
  app.post("/sign-in", async (c) => {
    const { login, password } = await c.req.json()
    const result = await signIn.signIn(c, login, password)
    if (!result) return c.json({ error: "refused" }, 401)
    return c.json(
      result.user,
      result.session.secondFactor === SecondFactorStatus.Pending ? 202 : 200,
    )
  })
  app.post("/sign-out", async (c) => {
    await signIn.signOut(c)
    return c.json({ success: true })
  })
  app.get("/me", signIn.auth.isAuthenticated2FA, (c) => c.json(c.get("auth")!.user))
  app.post("/totp/start", signIn.auth.isAuthenticated1FA, async (c) => {
    return c.json(await signIn.connectTotpStart(c.get("auth")!))
  })
  app.post("/totp/finish", signIn.auth.isAuthenticated1FA, async (c) => {
    const { otp } = await c.req.json()
    const ok = await signIn.connectTotpFinish(c.get("auth")!, otp)
    return ok ? c.json({ success: true }) : c.json({ error: "Code is incorrect" }, 400)
  })
  app.post("/totp/check", signIn.auth.isAuthenticated1FA, async (c) => {
    const { otp } = await c.req.json()
    const ok = await signIn.checkTotp(c.get("auth")!, otp)
    return ok ? c.json(c.get("auth")!.user) : c.json({ error: "Invalid token" }, 401)
  })
  app.post("/totp/disconnect", signIn.auth.isAuthenticated2FA, async (c) => {
    const ok = await signIn.disconnectTotp(c.get("auth")!)
    return ok ? c.json({ success: true }) : c.json({ error: "OTP already disabled" }, 400)
  })
  app.post("/password/change", signIn.auth.isAuthenticated2FA, async (c) => {
    const { password, newPassword } = await c.req.json()
    const ok = await signIn.changePassword(c, c.get("auth")!, password, newPassword)
    return ok ? c.json({ success: true }) : c.json({ error: "Invalid password" }, 400)
  })

  let cookies = new Map<string, string>()
  const request = async (method: string, path: string, body?: unknown): Promise<Response> => {
    const headers = new Headers({ "content-type": "application/json" })
    if (cookies.size) {
      headers.set("cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "))
    }
    const response = await app.request(`http://local${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";")
      const [name, value] = [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]
      if (value === "") cookies.delete(name)
      else cookies.set(name, value)
    }
    return response
  }
  return {
    request,
    saveCookies: () => new Map(cookies),
    restoreCookies: (saved: Map<string, string>) => {
      cookies = new Map(saved)
    },
  }
}

function buildSignIn(sql: postgres.Sql, hasher?: PasswordHasher): SignIn {
  return createSignIn({
    hasher,
    db: new AppDbBase({ sql }),
    pepper: PEPPER,
    cookieSecret: COOKIE_SECRET,
    secureCookie: false,
    sessionMinutes: 60,
    totpIssuer: "example.test",
  })
}

function totpCode(secret: string, timestamp: number): string {
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  }).generate({ timestamp })
}

/** The session id inside a jar's signed `sessionIdToken` cookie (`<id>:<token>.<signature>`). */
function sessionIdOf(cookies: Map<string, string>): number {
  return Number(decodeURIComponent(cookies.get("sessionIdToken")!).split(":")[0])
}

async function signUpRowCounts(sql: postgres.Sql): Promise<number[]> {
  const rows = await sql<CountRow[]>`
    SELECT COUNT(*)::int AS count FROM auth_users
    UNION ALL SELECT COUNT(*)::int FROM auth_keys
    UNION ALL SELECT COUNT(*)::int FROM users
    UNION ALL SELECT COUNT(*)::int FROM groups
    UNION ALL SELECT COUNT(*)::int FROM group_members
    UNION ALL SELECT COUNT(*)::int FROM auth_sessions
  `
  return rows.map((row: CountRow) => row.count)
}

Deno.test("the auth migration carries the package schema verbatim", async () => {
  const migration = await Deno.readTextFile(`libs/server/db/migrations/${AUTH_MIGRATION}`)
  expect(migration).toContain(AUTH_POSTGRES_SCHEMA)
})

Deno.test("sign-up, sign-in and sign-out through the package tables", async (t) => {
  await withSchema([...MASTER_MIGRATIONS, AUTH_MIGRATION, KIND_MIGRATION], async (sql) => {
    const signIn = buildSignIn(sql)

    await t.step("sign-up creates auth user, key, profile, group and session", async () => {
      const client = buildApp(signIn)
      const before = await signUpRowCounts(sql)
      const response = await client.request("POST", "/sign-up", {
        email: "  Alice@Example.com  ",
        password: "Passw0rd!",
      })
      expect(response.status).toBe(200)
      const user = await response.json()
      expect(await signUpRowCounts(sql)).toEqual(before.map((count) => count + 1))
      const [key] = await sql<
        { userId: number; email: string; secret: string; provenAt: Date | null }[]
      >`
        SELECT user_id AS "userId", email, secret, proven_at AS "provenAt" FROM auth_keys
        WHERE subject = 'alice@example.com'
      `
      expect(key.userId).toBe(user.id)
      // The address is kept on the key, normalised, and unproven until a reset link proves it.
      expect(key.email).toBe("alice@example.com")
      expect(key.provenAt).toBeNull()
      expect(key.secret).toMatch(/^pbkdf2-sha256\$600000\$/)
      expect((await client.request("GET", "/me")).status).toBe(200)
    })

    await t.step("a taken address is refused and writes nothing", async () => {
      const before = await signUpRowCounts(sql)
      const response = await buildApp(signIn).request("POST", "/sign-up", {
        email: "ALICE@example.com",
        password: "Passw0rd!",
      })
      expect(response.status).toBe(401)
      expect(await signUpRowCounts(sql)).toEqual(before)
    })

    await t.step("accepts an eight-unit password of four code points at sign-up", async () => {
      // Four emoji: 8 UTF-16 units, so the route rule "8 <= string" allows it; 4 code points.
      const response = await buildApp(signIn).request("POST", "/sign-up", {
        email: "emoji-pass@example.com",
        password: "😀😀😀😀",
      })
      expect(response.status).toBe(200)
    })

    await t.step("sign-up that fails half-way leaves no rows", async () => {
      // The personal group insert fails on a group id that is already taken, after the auth
      // user, the key and the profile row were written in the same transaction.
      const [taken] = await sql<{ id: string }[]>`SELECT id FROM groups LIMIT 1`
      const before = await signUpRowCounts(sql)
      await expect(
        buildApp(signIn).request("POST", "/sign-up", {
          email: "half-way@example.com",
          password: "Passw0rd!",
          groupId: taken.id,
        }).then(async (response) => {
          if (response.status === 500) throw new Error(await response.text())
          return response
        }),
      ).rejects.toThrow()
      expect(await signUpRowCounts(sql)).toEqual(before)
      const retry = await buildApp(signIn).request("POST", "/sign-up", {
        email: "half-way@example.com",
        password: "Passw0rd!",
      })
      expect(retry.status).toBe(200)
    })

    await t.step("20 concurrent normalised sign-ups create one complete account", async () => {
      const before = await signUpRowCounts(sql)
      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          buildApp(signIn).request("POST", "/sign-up", {
            email: index % 2 ? "  ConcurrentUser@Example.com  " : "concurrentuser@example.com",
            password: "Passw0rd!",
          })),
      )
      expect(responses.filter((response) => response.status === 200).length).toBe(1)
      expect(responses.filter((response) => response.status === 401).length).toBe(19)
      expect(await signUpRowCounts(sql)).toEqual(before.map((count) => count + 1))
    })

    await t.step("sign-in with the right password starts a session", async () => {
      const client = buildApp(signIn)
      const response = await client.request("POST", "/sign-in", {
        login: " ALICE@example.com",
        password: "Passw0rd!",
      })
      expect(response.status).toBe(200)
      expect((await client.request("GET", "/me")).status).toBe(200)
    })

    await t.step("sign-in with a wrong password or unknown user is refused", async () => {
      const client = buildApp(signIn)
      const sessionsBefore = await sql<CountRow[]>`SELECT COUNT(*)::int AS count FROM auth_sessions`
      for (
        const credentials of [
          { login: "alice@example.com", password: "wrong-password" },
          { login: "nobody@example.com", password: "Passw0rd!" },
          { login: "nobody", password: "Passw0rd!" },
        ]
      ) {
        expect((await client.request("POST", "/sign-in", credentials)).status).toBe(401)
      }
      expect((await client.request("GET", "/me")).status).toBe(401)
      const sessionsAfter = await sql<CountRow[]>`SELECT COUNT(*)::int AS count FROM auth_sessions`
      expect(sessionsAfter[0].count).toBe(sessionsBefore[0].count)
    })

    await t.step("a missing account costs one password verification too", async () => {
      // Counts calls to the real hasher, so a refusal that skips the verification shows up.
      const real = createPasswordHasher({ pepper: PEPPER })
      let verifications = 0
      const counting: PasswordHasher = {
        hash: (password) => real.hash(password),
        verify: (password, stored) => {
          verifications += 1
          // A cheap dummy would still be one call; the stored value must be a full-cost hash.
          expect(stored).toMatch(/^pbkdf2-sha256\$600000\$/)
          return real.verify(password, stored)
        },
      }
      const client = buildApp(buildSignIn(sql, counting))
      // An address and a username each take their own path; both cost the same.
      for (const login of ["alice@example.com", "nobody@example.com", "nobody", "   "]) {
        const before = verifications
        const password = login === "alice@example.com" ? "wrong-password" : "Passw0rd!"
        expect((await client.request("POST", "/sign-in", { login, password })).status).toBe(401)
        expect({ login, verifications: verifications - before }).toEqual({
          login,
          verifications: 1,
        })
      }
    })

    await t.step("an auth user without a profile row gets no session", async () => {
      const db = new AppDbBase({ sql })
      await db.authStore.createUserWithKey({
        method: "password",
        subject: "no-profile",
        email: null,
        secret: await createPasswordHasher({ pepper: PEPPER }).hash("Passw0rd!"),
        provenAt: null,
      })
      const sessionsBefore = await sql<CountRow[]>`SELECT COUNT(*)::int AS count FROM auth_sessions`
      const client = buildApp(signIn)
      const response = await client.request("POST", "/sign-in", {
        login: "no-profile",
        password: "Passw0rd!",
      })
      expect(response.status).toBe(401)
      expect(client.saveCookies().size).toBe(0)
      const sessionsAfter = await sql<CountRow[]>`SELECT COUNT(*)::int AS count FROM auth_sessions`
      expect(sessionsAfter[0].count).toBe(sessionsBefore[0].count)
    })

    await t.step("sign-out ends the session, not only the cookie", async () => {
      const client = buildApp(signIn)
      await client.request("POST", "/sign-in", {
        login: "alice@example.com",
        password: "Passw0rd!",
      })
      const signedIn = client.saveCookies()
      expect((await client.request("GET", "/me")).status).toBe(200)
      // What a live socket asks with the session id alone.
      expect((await signIn.entitledSession(sessionIdOf(signedIn)))?.user.id).toBeGreaterThan(0)

      const response = await client.request("POST", "/sign-out")
      expect(response.status).toBe(200)
      expect(client.saveCookies().size).toBe(0)
      expect(await signIn.entitledSession(sessionIdOf(signedIn))).toBeNull()

      // The browser dropped the cookie; a copy of it must not work any more either.
      client.restoreCookies(signedIn)
      expect((await client.request("GET", "/me")).status).toBe(401)
      const [session] = await sql<{ status: number }[]>`
        SELECT status FROM auth_sessions WHERE id = ${sessionIdOf(signedIn)}
      `
      expect(session.status).toBe(SessionStatus.SignedOut)
    })

    await t.step("a session past its expiry is no longer entitled, before any sweep", async () => {
      const client = buildApp(signIn)
      await client.request("POST", "/sign-in", {
        login: "alice@example.com",
        password: "Passw0rd!",
      })
      const id = sessionIdOf(client.saveCookies())
      expect(await signIn.entitledSession(id)).not.toBeNull()

      await sql`UPDATE auth_sessions SET expires_at = now() - interval '1 minute' WHERE id = ${id}`

      expect(await signIn.entitledSession(id)).toBeNull()
      expect((await client.request("GET", "/me")).status).toBe(401)
    })

    await t.step("an unknown session is not entitled", async () => {
      expect(await signIn.entitledSession(2_000_000_000)).toBeNull()
    })
  })
})

Deno.test("username accounts and the password reset link", async (t) => {
  await withSchema([...MASTER_MIGRATIONS, AUTH_MIGRATION, KIND_MIGRATION], async (sql) => {
    const signIn = buildSignIn(sql)
    const db = new AppDbBase({ sql })
    const ann = { email: "ann@example.com", password: "Passw0rd!" }
    expect((await buildApp(signIn).request("POST", "/sign-up", ann)).status).toBe(200)

    await t.step("an account made before addresses still signs in with its username", async () => {
      const legacy = { email: "legacy@example.com", password: "Passw0rd!" }
      expect((await buildApp(signIn).request("POST", "/sign-up", legacy)).status).toBe(200)
      // What a username sign-up wrote: the username as subject, and no address.
      await sql`
        UPDATE auth_keys SET subject = 'legacyuser', email = NULL
        WHERE subject = 'legacy@example.com'
      `

      const client = buildApp(signIn)
      const response = await client.request("POST", "/sign-in", {
        login: "  LegacyUser ",
        password: "Passw0rd!",
      })
      expect(response.status).toBe(200)
      expect((await client.request("GET", "/me")).status).toBe(200)
      // A username account has no address, so no link can be sent for it.
      expect(await issuePasswordReset(db.authStore, "legacyuser", new Date())).toBe(null)
    })

    await t.step("the link sets the new password and signs out every session", async () => {
      const first = buildApp(signIn)
      const second = buildApp(signIn)
      const login = { login: ann.email, password: ann.password }
      expect((await first.request("POST", "/sign-in", login)).status).toBe(200)
      expect((await second.request("POST", "/sign-in", login)).status).toBe(200)
      const issued = (await issuePasswordReset(db.authStore, " Ann@Example.com", new Date()))!
      const stored = await sql<{ secretHash: string }[]>`SELECT secret_hash FROM auth_challenges`
      expect(stored.length).toBe(1)
      expect(stored[0].secretHash).not.toContain(issued.code)

      expect(await signIn.resetPassword("ANN@example.com", issued.code, "N3w-Passw0rd")).toBe(true)

      expect((await first.request("GET", "/me")).status).toBe(401)
      expect((await second.request("GET", "/me")).status).toBe(401)
      const client = buildApp(signIn)
      expect((await client.request("POST", "/sign-in", login)).status).toBe(401)
      const renewed = { login: ann.email, password: "N3w-Passw0rd" }
      expect((await client.request("POST", "/sign-in", renewed)).status).toBe(200)
      const [key] = await sql<{ provenAt: Date | null }[]>`
        SELECT proven_at AS "provenAt" FROM auth_keys WHERE subject = ${ann.email}
      `
      expect(key.provenAt).not.toBeNull()
    })

    await t.step("the same link never works twice", async () => {
      const issued = (await issuePasswordReset(db.authStore, ann.email, new Date()))!
      expect(await signIn.resetPassword(ann.email, issued.code, "Once-Passw0rd")).toBe(true)
      expect(await signIn.resetPassword(ann.email, issued.code, "Twice-Passw0rd")).toBe(false)
      const client = buildApp(signIn)
      const twice = { login: ann.email, password: "Twice-Passw0rd" }
      expect((await client.request("POST", "/sign-in", twice)).status).toBe(401)
    })

    await t.step("a link past its 30 minutes is refused and changes nothing", async () => {
      const issued = (await issuePasswordReset(db.authStore, ann.email, new Date()))!
      await sql`UPDATE auth_challenges SET expires_at = now() - interval '1 second'`
      expect(await signIn.resetPassword(ann.email, issued.code, "Late-Passw0rd")).toBe(false)
      const client = buildApp(signIn)
      const late = { login: ann.email, password: "Late-Passw0rd" }
      expect((await client.request("POST", "/sign-in", late)).status).toBe(401)
    })

    await t.step("a fresh link works after wrong guesses at the previous one", async () => {
      // A stranger who knows the address guesses at the live link, more often than any small cap.
      await issuePasswordReset(db.authStore, ann.email, new Date())
      for (let guess = 0; guess < 10; guess++) {
        expect(await consumePasswordReset(db.authStore, ann.email, `wrong-${guess}`)).toBe(false)
      }

      // The owner asks again before the first link expires; the new link must still work.
      const fresh = (await issuePasswordReset(db.authStore, ann.email, new Date()))!
      expect(await signIn.resetPassword(ann.email, fresh.code, "Fresh-Passw0rd")).toBe(true)
    })

    await t.step("a link for a key without an address is refused and changes nothing", async () => {
      // A username account whose username looks like an address: no link is ever sent for it, so
      // a challenge under its name must not reset it either.
      await sql`
        UPDATE auth_keys SET subject = 'olduser@example.com', email = NULL
        WHERE subject = 'legacyuser'
      `
      const code = "code-for-a-key-without-an-address"
      await db.authStore.issueChallenge({
        purpose: PASSWORD_RESET_PURPOSE,
        subject: "olduser@example.com",
        secretHash: await sha256Hex(code),
        expiresAt: new Date(Date.now() + 60_000),
        now: new Date(),
      })

      expect(await signIn.resetPassword("olduser@example.com", code, "Taken-Passw0rd")).toBe(false)
      const client = buildApp(signIn)
      const old = { login: "olduser@example.com", password: "Passw0rd!" }
      expect((await client.request("POST", "/sign-in", old)).status).toBe(200)
    })
  })
})

Deno.test("authenticator-app enrolment, second factor and replay", async (t) => {
  await withSchema([...MASTER_MIGRATIONS, AUTH_MIGRATION, KIND_MIGRATION], async (sql) => {
    const signIn = buildSignIn(sql)
    const signUpBody = { email: "totp-user@example.com", password: "Passw0rd!" }
    const credentials = { login: signUpBody.email, password: signUpBody.password }
    const enrolling = buildApp(signIn)
    expect((await enrolling.request("POST", "/sign-up", signUpBody)).status).toBe(200)
    // Only a proven address may turn on a second factor (#140).
    const [key] = await sql<{ id: number }[]>`
      SELECT id FROM auth_keys WHERE subject = ${signUpBody.email}
    `
    await new AppDbBase({ sql }).authStore.proveKey(key.id, new Date())
    let secret = ""
    let enrolmentCode = ""

    await t.step("enrolment returns a QR code and a secret, and marks it unfinished", async () => {
      const response = await enrolling.request("POST", "/totp/start")
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.error).toBe(null)
      expect(body.qrcode).toContain("<svg")
      expect(body.secret).toMatch(/^[A-Z2-7]{32}$/)
      secret = body.secret
      const again = await (await enrolling.request("POST", "/totp/start")).json()
      expect(again.secret).toBe(secret)
      const [user] = await sql<{ mfa: number }[]>`SELECT mfa FROM users`
      expect(user.mfa).toBe(UserMFAStatus.CONFIGURATION_NOT_FINISHED)
    })

    await t.step("a wrong code does not finish enrolment", async () => {
      const wrong = totpCode(secret, Date.now() + 10 * 60_000)
      expect((await enrolling.request("POST", "/totp/finish", { otp: wrong })).status).toBe(400)
    })

    await t.step("the right code finishes enrolment and signs out other sessions", async () => {
      const other = buildApp(signIn)
      expect((await other.request("POST", "/sign-in", credentials)).status).toBe(200)
      enrolmentCode = totpCode(secret, Date.now())
      const response = await enrolling.request("POST", "/totp/finish", { otp: enrolmentCode })
      expect(response.status).toBe(200)
      const [user] = await sql<{ mfa: number }[]>`SELECT mfa FROM users`
      expect(user.mfa).toBe(UserMFAStatus.CONFIGURED)
      expect((await enrolling.request("GET", "/me")).status).toBe(200)
      // The other session would owe the second factor now anyway, so look at the row itself.
      const [otherSession] = await sql<{ status: number }[]>`
        SELECT status FROM auth_sessions WHERE id = ${sessionIdOf(other.saveCookies())}
      `
      expect(otherSession.status).toBe(SessionStatus.SignedOut)
      expect((await other.request("POST", "/totp/start")).status).toBe(401)
      expect(await signIn.entitledSession(sessionIdOf(other.saveCookies()))).toBeNull()
      expect(
        (await signIn.entitledSession(sessionIdOf(enrolling.saveCookies())))?.user.mfa,
      ).toBe(UserMFAStatus.CONFIGURED)
    })

    await t.step("a new sign-in owes the second factor and refuses a replayed code", async () => {
      const client = buildApp(signIn)
      expect((await client.request("POST", "/sign-in", credentials)).status).toBe(202)
      const owed = await client.request("GET", "/me")
      expect(owed.status).toBe(401)
      expect(await owed.json()).toEqual({ error: "Need to pass 2FA" })
      const owingId = sessionIdOf(client.saveCookies())
      expect(await signIn.entitledSession(owingId)).toBeNull()

      // The code that finished enrolment is still inside the time window, and is refused.
      const replay = await client.request("POST", "/totp/check", { otp: enrolmentCode })
      expect(replay.status).toBe(401)
      expect((await client.request("GET", "/me")).status).toBe(401)

      // The next step's code is accepted once, and only once.
      const next = totpCode(secret, Date.now() + 30_000)
      expect((await client.request("POST", "/totp/check", { otp: next })).status).toBe(200)
      expect((await client.request("GET", "/me")).status).toBe(200)
      expect(await signIn.entitledSession(owingId)).not.toBeNull()

      const again = buildApp(signIn)
      expect((await again.request("POST", "/sign-in", credentials)).status).toBe(202)
      expect((await again.request("POST", "/totp/check", { otp: next })).status).toBe(401)
    })

    await t.step("a not-required session of a user with TOTP still owes the factor", async () => {
      // A session created before enrolment, or written by hand, says the factor is not required;
      // the user has TOTP now, so the guard must still ask for it.
      const client = buildApp(signIn)
      expect((await client.request("POST", "/sign-in", credentials)).status).toBe(202)
      await sql`
        UPDATE auth_sessions SET second_factor = ${SecondFactorStatus.NotRequired}
        WHERE id = ${sessionIdOf(client.saveCookies())}
      `
      const response = await client.request("GET", "/me")
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: "Need to pass 2FA" })
    })

    let password = credentials.password

    await t.step("a password change keeps the second factor given on the new session", async () => {
      const response = await enrolling.request("POST", "/password/change", {
        password,
        newPassword: "N3w-Passw0rd!",
      })
      expect(response.status).toBe(200)
      password = "N3w-Passw0rd!"
      const [session] = await sql<{ secondFactor: number }[]>`
        SELECT second_factor AS "secondFactor" FROM auth_sessions
        WHERE id = ${sessionIdOf(enrolling.saveCookies())}
      `
      expect(session.secondFactor).toBe(SecondFactorStatus.Completed)
      expect((await enrolling.request("GET", "/me")).status).toBe(200)
    })

    await t.step("disconnecting lets the user's pending sessions through", async () => {
      const pending = buildApp(signIn)
      const signedIn = await pending.request("POST", "/sign-in", {
        login: credentials.login,
        password,
      })
      expect(signedIn.status).toBe(202)
      expect((await pending.request("GET", "/me")).status).toBe(401)
      // Another user's pending session must stay pending.
      const other = buildApp(signIn)
      const otherCredentials = { email: "totp-bystander@example.com", password: "Passw0rd!" }
      expect((await other.request("POST", "/sign-up", otherCredentials)).status).toBe(200)
      const [bystander] = await sql<{ id: number }[]>`
        SELECT id FROM auth_sessions WHERE id = ${sessionIdOf(other.saveCookies())}
      `
      await sql`
        UPDATE auth_sessions SET second_factor = ${SecondFactorStatus.Pending}
        WHERE id = ${bystander.id}
      `

      const response = await enrolling.request("POST", "/totp/disconnect")
      expect(response.status).toBe(200)
      const [user] = await sql<{ mfa: number }[]>`
        SELECT mfa FROM users WHERE id = (
          SELECT user_id FROM auth_sessions WHERE id = ${sessionIdOf(pending.saveCookies())}
        )
      `
      expect(user.mfa).toBe(UserMFAStatus.NOT_CONFIGURED)
      expect(await sql`SELECT 1 FROM user_totp`).toHaveLength(0)
      const [cleared] = await sql<{ secondFactor: number; status: number }[]>`
        SELECT second_factor AS "secondFactor", status FROM auth_sessions
        WHERE id = ${sessionIdOf(pending.saveCookies())}
      `
      expect(cleared).toEqual({
        secondFactor: SecondFactorStatus.NotRequired,
        status: SessionStatus.Active,
      })
      expect((await pending.request("GET", "/me")).status).toBe(200)
      const [untouched] = await sql<{ secondFactor: number }[]>`
        SELECT second_factor AS "secondFactor" FROM auth_sessions WHERE id = ${bystander.id}
      `
      expect(untouched.secondFactor).toBe(SecondFactorStatus.Pending)
      expect((await enrolling.request("POST", "/totp/disconnect")).status).toBe(400)
    })
  })
})

Deno.test("the auth migration applies on top of the previous schema", async () => {
  await withSchema(MASTER_MIGRATIONS, async (sql) => {
    // A user signed up under the previous schema: profile, password key, a TOTP key, a session, the
    // personal group, an audit row and a push token.
    const [old] = await sql<{ id: number; createdAt: Date }[]>`
      INSERT INTO users (first_name, last_name, mfa) VALUES ('Old', 'User', 3)
      RETURNING id, created_at
    `
    const [key] = await sql<{ id: number }[]>`
      INSERT INTO user_keys (user_id, kind, identification, secret)
      VALUES (${old.id}, 1, 'olduser', 'abc:def') RETURNING id
    `
    await sql`
      INSERT INTO user_keys (user_id, kind, identification, secret)
      VALUES (${old.id}, 3, 'olduser', 'JBSWY3DPEHPK3PXP')
    `
    await sql`
      INSERT INTO user_sessions (token, user_id, key_id, expires_at)
      VALUES ('token', ${old.id}, ${key.id}, NOW() + INTERVAL '1 day')
    `
    await applyMigration(sql, "2026_08_18_0002_personal_group_backfill.sql")
    await sql`
      INSERT INTO auth_audits (user_id, event_type, identifier) VALUES (${old.id}, 1, 'olduser')
    `
    await sql`
      INSERT INTO user_push_tokens (user_id, device_id, endpoint, auth, p256dh)
      VALUES (${old.id}, 'device', 'https://push.example.test', 'auth', 'key')
    `

    await applyMigration(sql, AUTH_MIGRATION)
    // Every later migration runs before the next sign-up, as a deploy applies them in order.
    await applyMigration(sql, KIND_MIGRATION)

    const [authUser] = await sql<{ id: number; createdAt: Date }[]>`
      SELECT id, created_at FROM auth_users
    `
    expect(authUser).toEqual({ id: old.id, createdAt: old.createdAt })
    const [user] = await sql<{ firstName: string; mfa: number }[]>`
      SELECT first_name, mfa FROM users WHERE id = ${old.id}
    `
    expect(user).toEqual({ firstName: "Old", mfa: UserMFAStatus.NOT_CONFIGURED })
    const kept = await sql<CountRow[]>`
      SELECT COUNT(*)::int AS count FROM groups WHERE owner_user_id = ${old.id}
      UNION ALL SELECT COUNT(*)::int FROM auth_audits WHERE user_id = ${old.id}
      UNION ALL SELECT COUNT(*)::int FROM user_push_tokens WHERE user_id = ${old.id}
    `
    expect(kept.map((row: CountRow) => row.count)).toEqual([1, 1, 1])
    const [dropped] = await sql<{ keys: string | null; sessions: string | null }[]>`
      SELECT to_regclass('user_keys')::text AS keys, to_regclass('user_sessions')::text AS sessions
    `
    expect(dropped).toEqual({ keys: null, sessions: null })

    // The old password no longer signs in; signing up again makes a new user after the old id.
    const signIn = buildSignIn(sql)
    const client = buildApp(signIn)
    const refused = await client.request("POST", "/sign-in", {
      login: "olduser",
      password: "Passw0rd!",
    })
    expect(refused.status).toBe(401)
    const signedUp = await client.request("POST", "/sign-up", {
      email: "olduser@example.com",
      password: "Passw0rd!",
    })
    expect(signedUp.status).toBe(200)
    expect((await signedUp.json()).id).toBeGreaterThan(old.id)
  })
})
