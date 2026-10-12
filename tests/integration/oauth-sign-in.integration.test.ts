/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import postgres from "postgres"
import { AuthAuditEventType, type SignInMethodsResponse, UserMFAStatus } from "@domain/identity"
import {
  GITHUB_EMAILS_ENDPOINT,
  GITHUB_TOKEN_ENDPOINT,
  GITHUB_USER_ENDPOINT,
} from "@spy4x/server/auth/oauth-github"
import { GOOGLE_TOKEN_ENDPOINT, GOOGLE_USERINFO_ENDPOINT } from "@spy4x/server/auth/oauth-google"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn } from "../../apps/api/services/sign-in.ts"
import { enabledOAuthProviders } from "../../apps/api/services/oauth-providers.ts"
import { createOAuthRoute } from "../../apps/api/routes/auth-oauth.ts"
import { createMutationGuards } from "../../apps/api/middlewares/mutation-guards.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/**
 * Sign-in with Google and GitHub (#141) and the question before a provider signs anyone up (#142),
 * through the real routes and sign-in against a real Postgres. The provider is a fake `fetch`: it
 * answers the token and profile requests from a table, and any other request fails the test, so
 * nothing here reaches the network.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

const MIGRATIONS_DIR = "libs/server/db/migrations"
// Test-only secrets, long enough for the package's 32-character minimum.
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"
const PASSWORD = "Passw0rd!"
const ORIGIN = "https://app.example.test"

/** Runs `body` against a fresh schema with every migration applied, and drops the schema after. */
async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `oauth_test_${uuidV7().replaceAll("-", "")}`
  const sql = postgres({
    ...settings,
    max: 10,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    const names = [...Deno.readDirSync(MIGRATIONS_DIR)].map((entry) => entry.name).sort()
    for (const name of names) {
      await sql.unsafe(await Deno.readTextFile(`${MIGRATIONS_DIR}/${name}`))
    }
    await body(sql)
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
}

/** A person as a provider knows them. The authorization `code` of the fake names one. */
interface ProviderPerson {
  /** The provider's id of the account: Google's `sub`, GitHub's numeric `id`. */
  sub: string
  email?: string
  /** Whether the provider says the address is verified. */
  verified?: boolean
}

/** Answers Google's and GitHub's token and profile requests from `people`, keyed by code. */
function fakeProviders(people: Record<string, ProviderPerson>) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  /** The person the request's bearer token (the code it was traded for) names. */
  const personOf = (request: Request) =>
    people[(request.headers.get("authorization") ?? "").replace(/^Bearer /, "")]
  return async (request: Request): Promise<Response> => {
    const url = request.url.split("?")[0]
    if (url === GOOGLE_TOKEN_ENDPOINT || url === GITHUB_TOKEN_ENDPOINT) {
      const code = new URLSearchParams(await request.text()).get("code") ?? ""
      return people[code]
        ? json({ access_token: code, token_type: "bearer" })
        : json({ error: "invalid_grant" }, 400)
    }
    const person = personOf(request)
    if (!person) return json({ error: "unauthorized" }, 401)
    if (url === GOOGLE_USERINFO_ENDPOINT) {
      return json({ sub: person.sub, email: person.email, email_verified: person.verified })
    }
    if (url === GITHUB_USER_ENDPOINT) return json({ id: Number(person.sub) })
    if (url === GITHUB_EMAILS_ENDPOINT) {
      return json(
        person.email ? [{ email: person.email, primary: true, verified: person.verified }] : [],
      )
    }
    throw new Error(`the test reached for the network: ${request.url}`)
  }
}

const pass = (_c: unknown, next: () => Promise<void>) => next()

/** The real provider routes and sign-in over `sql`, with the fake providers and a clock to move. */
function buildApp(
  sql: postgres.Sql,
  people: Record<string, ProviderPerson>,
  on: ("google" | "github")[] = ["google", "github"],
) {
  let now = Date.now()
  const db = new AppDbBase({ sql })
  const credentials = { clientId: "test-client-id", clientSecret: "test-client-secret" }
  const signIn = createSignIn({
    db,
    pepper: PEPPER,
    cookieSecret: COOKIE_SECRET,
    secureCookie: false,
    sessionMinutes: 60,
    totpIssuer: "example.test",
    oauth: {
      providers: enabledOAuthProviders(Object.fromEntries(on.map((id) => [id, credentials]))),
      origin: ORIGIN,
      fetch: fakeProviders(people),
      clock: { now: () => now },
    },
  })
  const app = new Hono<APIContext>()
  app.use(signIn.auth.parseAuth)
  app.route(
    "/auth",
    createOAuthRoute({
      signIn,
      emit: () => {},
      mutationGuards: createMutationGuards(ORIGIN),
      rateLimits: { strictByIp: pass, normal: pass },
      origin: ORIGIN,
    }),
  )
  // The password sign-up and sign-in, for accounts that exist before a provider is used.
  app.post("/password/sign-up", async (c) => {
    const { email } = await c.req.json()
    const result = await signIn.signUp(c, email, PASSWORD)
    return result ? c.json(result.user) : c.json({ error: "refused" }, 401)
  })
  app.post("/password/sign-in", async (c) => {
    const { email } = await c.req.json()
    const result = await signIn.signIn(c, email, PASSWORD)
    return result ? c.json(result.user) : c.json({ error: "refused" }, 401)
  })
  return { app, db, sql, advance: (ms: number) => now += ms }
}

type App = ReturnType<typeof buildApp>

/** A browser: it keeps the cookies the app sets and sends them back. */
function browser({ app }: App) {
  const cookies = new Map<string, string>()
  const send = async (method: string, path: string, body?: unknown): Promise<Response> => {
    const response = await app.request(`http://local${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "sec-fetch-site": "same-origin",
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
        "x-real-ip": "203.0.113.42",
        cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(";")
      const name = pair.slice(0, pair.indexOf("="))
      const value = pair.slice(pair.indexOf("=") + 1)
      const gone = value === "" || attributes.some((entry) => /^\s*max-age=0$/i.test(entry))
      if (gone) cookies.delete(name)
      else cookies.set(name, value)
    }
    return response
  }
  return {
    cookies,
    get: (path: string) => send("GET", path),
    post: (path: string, body: unknown = {}) => send("POST", path, body),
    delete: (path: string) => send("DELETE", path),
    /**
     * Goes to the provider and comes back as the person `code` names: follows `startUrl` (the
     * start route, or the address a link request answered) and returns the callback's answer.
     */
    async through(provider: "google" | "github", code: string, start?: string): Promise<Response> {
      const at = start ?? (await send("GET", `/auth/${provider}/start`)).headers.get("location")
      if (!at) throw new Error(`the ${provider} flow did not start`)
      const state = new URL(at).searchParams.get("state")
      return await send("GET", `/auth/${provider}/callback?code=${code}&state=${state}`)
    },
  }
}

/** Where a redirect goes, without the origin. */
function target(response: Response): string {
  expect(response.status).toBe(302)
  return (response.headers.get("location") ?? "").replace(ORIGIN, "")
}

/** How many accounts exist, in the auth tables and as profiles. */
async function accounts(sql: postgres.Sql): Promise<{ authUsers: number; profiles: number }> {
  const [row] = await sql`
    SELECT (SELECT count(*)::int FROM auth_users) AS auth_users,
           (SELECT count(*)::int FROM users) AS profiles`
  return { authUsers: row.authUsers, profiles: row.profiles }
}

/** The audit events of `userId`, oldest first, with what each names. */
async function audit(sql: postgres.Sql, userId: number): Promise<[AuthAuditEventType, string][]> {
  const rows = await sql`
    SELECT event_type, identifier FROM auth_audits WHERE user_id = ${userId} ORDER BY id`
  return rows.map((row) => [row.eventType, row.identifier])
}

/** A password account whose address is proven, signed in on `visitor`. Returns its user id. */
async function provenPasswordAccount(
  app: App,
  visitor: ReturnType<typeof browser>,
  email: string,
): Promise<number> {
  const response = await visitor.post("/password/sign-up", { email })
  expect(response.status).toBe(200)
  const { id } = await response.json()
  const [key] = await app.db.authStore.listKeys(id)
  await app.db.authStore.proveKey(key.id, new Date())
  return id
}

async function methodsOf(visitor: ReturnType<typeof browser>): Promise<SignInMethodsResponse> {
  const response = await visitor.get("/auth/methods")
  expect(response.status).toBe(200)
  return await response.json()
}

const ADA: ProviderPerson = { sub: "1001", email: "ada@example.com", verified: true }

Deno.test("only a provider with credentials is listed and can be started", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA }, ["google"])
    const visitor = browser(app)

    expect(await (await visitor.get("/auth/providers")).json()).toEqual({ providers: ["google"] })
    expect((await visitor.get("/auth/github/start")).status).toBe(404)
    expect((await visitor.get("/auth/github/callback?code=ada&state=x")).status).toBe(404)
    const started = await visitor.get("/auth/google/start")
    const provider = new URL(started.headers.get("location")!)
    expect(provider.origin).toBe("https://accounts.google.com")
    expect(provider.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/google/callback`)
  })
})

Deno.test("a first Google sign-in creates nothing until the person confirms the new account", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const visitor = browser(app)

    expect(target(await visitor.through("google", "ada"))).toBe("/sign-up/confirm")
    expect(await accounts(sql)).toEqual({ authUsers: 0, profiles: 0 })
    const pending = await (await visitor.get("/auth/sign-up/pending")).json()
    expect(pending.provider).toBe("google")
    expect(pending.email).toBe("ada@example.com")
    // Not signed in yet.
    expect((await visitor.get("/auth/methods")).status).toBe(401)

    const confirmed = await visitor.post("/auth/sign-up/confirm")

    expect(confirmed.status).toBe(201)
    const user = await confirmed.json()
    expect(await accounts(sql)).toEqual({ authUsers: 1, profiles: 1 })
    expect(await audit(sql, user.id)).toEqual([[
      AuthAuditEventType.SIGNED_UP,
      "ada@example.com",
    ]])
    const [{ groups }] = await sql`
      SELECT count(*)::int AS groups FROM group_members WHERE user_id = ${user.id}`
    expect(groups).toBe(1)
    expect((await methodsOf(visitor)).methods.map((method) => [method.kind, method.current]))
      .toEqual([["google", true]])
    // The question is answered: nothing waits any more.
    expect((await visitor.get("/auth/sign-up/pending")).status).toBe(204)
  })
})

Deno.test("a returning person is matched by the provider's id, not by the address", async () => {
  await withSchema(async (sql) => {
    const people = { ada: { ...ADA } }
    const app = buildApp(sql, people)
    const first = browser(app)
    await first.through("google", "ada")
    const user = await (await first.post("/auth/sign-up/confirm")).json()
    // The person changes the address at the provider; the id stays.
    people.ada.email = "countess@example.com"

    const later = browser(app)
    expect(target(await later.through("google", "ada"))).toBe("/")

    expect(await accounts(sql)).toEqual({ authUsers: 1, profiles: 1 })
    expect((await methodsOf(later)).methods).toHaveLength(1)
    expect((await audit(sql, user.id)).at(-1)).toEqual([
      AuthAuditEventType.SIGNED_IN,
      "oauth:google",
    ])
  })
})

Deno.test("GitHub signs a person up with its verified primary address", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const visitor = browser(app)

    expect(target(await visitor.through("github", "ada"))).toBe("/sign-up/confirm")
    expect((await visitor.post("/auth/sign-up/confirm")).status).toBe(201)

    expect((await methodsOf(visitor)).methods.map((method) => [method.kind, method.email]))
      .toEqual([["github", "ada@example.com"]])
  })
})

Deno.test("going back creates nothing and the question cannot be answered afterwards", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const visitor = browser(app)
    await visitor.through("google", "ada")
    const held = new Map(visitor.cookies)

    expect((await visitor.post("/auth/sign-up/cancel")).status).toBe(200)

    expect((await visitor.get("/auth/sign-up/pending")).status).toBe(204)
    expect((await visitor.post("/auth/sign-up/confirm")).status).toBe(400)
    expect(await accounts(sql)).toEqual({ authUsers: 0, profiles: 0 })

    // Even a browser that kept the cookie: the held sign-up expires after ten minutes.
    const keeper = browser(app)
    for (const [name, value] of held) keeper.cookies.set(name, value)
    app.advance(10 * 60_000 + 1000)
    expect((await keeper.get("/auth/sign-up/pending")).status).toBe(204)
    expect((await keeper.post("/auth/sign-up/confirm")).status).toBe(400)
    expect(await accounts(sql)).toEqual({ authUsers: 0, profiles: 0 })
  })
})

Deno.test("a confirmed sign-up cannot be confirmed a second time", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const visitor = browser(app)
    await visitor.through("google", "ada")
    const held = new Map(visitor.cookies)
    expect((await visitor.post("/auth/sign-up/confirm")).status).toBe(201)

    const replay = browser(app)
    for (const [name, value] of held) replay.cookies.set(name, value)

    expect((await replay.post("/auth/sign-up/confirm")).status).toBe(400)
    expect((await replay.get("/auth/methods")).status).toBe(401)
    expect(await accounts(sql)).toEqual({ authUsers: 1, profiles: 1 })
  })
})

Deno.test("a provider address that is not verified never links to the account that owns it", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, {
      impostor: { sub: "666", email: "ada@example.com", verified: false },
    })
    const owner = browser(app)
    const ownerId = await provenPasswordAccount(app, owner, "ada@example.com")
    const visitor = browser(app)

    // Asked like a stranger, never let into the owner's account.
    expect(target(await visitor.through("google", "impostor"))).toBe("/sign-up/confirm")

    expect((await visitor.get("/auth/methods")).status).toBe(401)
    expect((await app.db.authStore.listKeys(ownerId)).map((key) => key.method)).toEqual([
      "password",
    ])
    expect(await accounts(sql)).toEqual({ authUsers: 1, profiles: 1 })
  })
})

Deno.test("a verified provider address signs in to the account that owns it and links the provider", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const ownerId = await provenPasswordAccount(app, browser(app), "ada@example.com")
    const visitor = browser(app)

    expect(target(await visitor.through("google", "ada"))).toBe("/")

    expect(await accounts(sql)).toEqual({ authUsers: 1, profiles: 1 })
    const listed = await methodsOf(visitor)
    expect(listed.methods.map((method) => [method.kind, method.current, method.canUnlink]))
      .toEqual([["password", false, false], ["google", true, true]])
    expect(listed.available).toEqual(["github"])
    expect((await audit(sql, ownerId)).slice(-2)).toEqual([
      [AuthAuditEventType.SIGN_IN_METHOD_LINKED, "oauth:google"],
      [AuthAuditEventType.SIGNED_IN, "oauth:google"],
    ])
  })
})

Deno.test("a callback whose state is not this browser's signs nobody in", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    await provenPasswordAccount(app, browser(app), "ada@example.com")
    const attacker = browser(app)
    const started = await attacker.get("/auth/google/start")
    const state = new URL(started.headers.get("location")!).searchParams.get("state")

    // The attacker's link, opened in a browser that never started the flow.
    const victim = browser(app)
    const answer = await victim.get(`/auth/google/callback?code=ada&state=${state}`)

    expect(target(answer)).toBe("/sign-in?oauth=failed")
    expect((await victim.get("/auth/methods")).status).toBe(401)
  })
})

Deno.test("a provider that refuses the code signs nobody in", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const visitor = browser(app)

    expect(target(await visitor.through("google", "nobody"))).toBe("/sign-in?oauth=failed")

    expect(await accounts(sql)).toEqual({ authUsers: 0, profiles: 0 })
    expect((await visitor.get("/auth/sign-up/pending")).status).toBe(204)
  })
})

Deno.test("a provider sign-in returns to the page it was started for, and never to another site", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    await provenPasswordAccount(app, browser(app), "ada@example.com")

    const reader = browser(app)
    const started = await reader.get(`/auth/google/start?next=${encodeURIComponent("/notes/abc")}`)
    expect(target(await reader.through("google", "ada", started.headers.get("location")!)))
      .toBe("/notes/abc")

    for (const next of ["//evil.example", "https://evil.example/", "/api/auth/sign-out"]) {
      const lured = browser(app)
      const begun = await lured.get(`/auth/google/start?next=${encodeURIComponent(next)}`)
      const answer = await lured.through("google", "ada", begun.headers.get("location")!)
      expect(answer.headers.get("location")).toBe(`${ORIGIN}/`)
    }
  })
})

Deno.test("a provider sign-in to an account with two-factor on still owes the code", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const ownerId = await provenPasswordAccount(app, browser(app), "ada@example.com")
    await sql`UPDATE users SET mfa = ${UserMFAStatus.CONFIGURED} WHERE id = ${ownerId}`
    const visitor = browser(app)
    const started = await visitor.get(`/auth/google/start?next=${encodeURIComponent("/notes")}`)

    const answer = await visitor.through("google", "ada", started.headers.get("location")!)

    expect(target(answer)).toBe("/totp?next=%2Fnotes")
    // The session exists but is not let past the second factor.
    expect((await visitor.get("/auth/methods")).status).toBe(401)
  })
})

Deno.test("the profile links a provider whose verified address is the account's own", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const owner = browser(app)
    const ownerId = await provenPasswordAccount(app, owner, "ada@example.com")
    const [{ before }] = await sql`SELECT count(*)::int AS before FROM auth_sessions`

    const link = await owner.post("/auth/methods/google/link")
    expect(link.status).toBe(200)
    const answer = await owner.through("google", "ada", (await link.json()).url)

    expect(target(answer)).toBe("/?oauth=linked")
    const listed = await methodsOf(owner)
    // Still the password session: linking signs nobody in again.
    expect(listed.methods.map((method) => [method.kind, method.current]))
      .toEqual([["password", true], ["google", false]])
    const [{ after }] = await sql`SELECT count(*)::int AS after FROM auth_sessions`
    expect(after).toBe(before)
    expect((await audit(sql, ownerId)).at(-1)).toEqual([
      AuthAuditEventType.SIGN_IN_METHOD_LINKED,
      "oauth:google",
    ])
  })
})

Deno.test("linking a provider account with another address links nothing and creates nothing", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, {
      other: { sub: "2002", email: "someone-else@example.com", verified: true },
    })
    const owner = browser(app)
    await provenPasswordAccount(app, owner, "ada@example.com")

    const link = await owner.post("/auth/methods/google/link")
    const answer = await owner.through("google", "other", (await link.json()).url)

    expect(target(answer)).toBe("/?oauth=link-mismatch")
    expect((await methodsOf(owner)).methods.map((method) => method.kind)).toEqual(["password"])
    expect(await accounts(sql)).toEqual({ authUsers: 1, profiles: 1 })
    // No question is left open in this browser either.
    expect((await owner.get("/auth/sign-up/pending")).status).toBe(204)
  })
})

Deno.test("linking a provider account that signs in to another account changes neither", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, {
      ada: ADA,
      bob: { sub: "3003", email: "bob@example.com", verified: true },
    })
    const bob = browser(app)
    await bob.through("google", "bob")
    const bobUser = await (await bob.post("/auth/sign-up/confirm")).json()
    const ada = browser(app)
    const adaId = await provenPasswordAccount(app, ada, "ada@example.com")
    const [{ before }] = await sql`SELECT count(*)::int AS before FROM auth_sessions`

    const link = await ada.post("/auth/methods/google/link")
    const answer = await ada.through("google", "bob", (await link.json()).url)

    expect(target(answer)).toBe("/?oauth=link-other-account")
    // Ada is still Ada, with her one method, and no session of Bob's was left behind.
    expect((await methodsOf(ada)).methods.map((method) => method.kind)).toEqual(["password"])
    expect((await app.db.authStore.listKeys(adaId)).length).toBe(1)
    expect((await app.db.authStore.listKeys(bobUser.id)).length).toBe(1)
    const [{ after }] = await sql`SELECT count(*)::int AS after FROM auth_sessions`
    expect(after).toBe(before)
  })
})

Deno.test("a link belongs to the person who started it", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const owner = browser(app)
    await provenPasswordAccount(app, owner, "ada@example.com")
    const link = await owner.post("/auth/methods/google/link")
    const { url } = await link.json()
    // Signed out before the provider answered: only the flow's cookie is left.
    const signedOut = browser(app)
    for (const [name, value] of owner.cookies) {
      if (name.startsWith("oauth_state_")) signedOut.cookies.set(name, value)
    }

    expect(target(await signedOut.through("google", "ada", url))).toBe("/?oauth=failed")

    expect((await methodsOf(owner)).methods.map((method) => method.kind)).toEqual(["password"])
    expect((await signedOut.get("/auth/methods")).status).toBe(401)
  })
})

Deno.test("starting a link needs a signed-in person and a request from the app itself", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })

    expect((await browser(app).post("/auth/methods/google/link")).status).toBe(401)

    const owner = browser(app)
    await provenPasswordAccount(app, owner, "ada@example.com")
    const forged = await app.app.request("http://local/auth/methods/google/link", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
        cookie: [...owner.cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      },
    })
    expect(forged.status).toBe(403)
  })
})

Deno.test("unlinking a provider ends the sessions that signed in with it and keeps the others", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const withPassword = browser(app)
    const ownerId = await provenPasswordAccount(app, withPassword, "ada@example.com")
    const withGoogle = browser(app)
    await withGoogle.through("google", "ada")
    const google = (await methodsOf(withGoogle)).methods.find((method) => method.kind === "google")!

    const answer = await withPassword.delete(`/auth/methods/${google.id}`)

    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({ signedOut: false })
    expect((await withGoogle.get("/auth/methods")).status).toBe(401)
    expect((await methodsOf(withPassword)).methods.map((method) => method.kind))
      .toEqual(["password"])
    expect((await audit(sql, ownerId)).at(-1)).toEqual([
      AuthAuditEventType.SIGN_IN_METHOD_UNLINKED,
      "oauth:google",
    ])
  })
})

Deno.test("unlinking the method this device signed in with signs it out", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    await provenPasswordAccount(app, browser(app), "ada@example.com")
    const withGoogle = browser(app)
    await withGoogle.through("google", "ada")
    const google = (await methodsOf(withGoogle)).methods.find((method) => method.current)!

    const answer = await withGoogle.delete(`/auth/methods/${google.id}`)

    expect(await answer.json()).toEqual({ signedOut: true })
    expect((await withGoogle.get("/auth/methods")).status).toBe(401)
  })
})

Deno.test("the last sign-in method cannot be unlinked", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const visitor = browser(app)
    await visitor.through("google", "ada")
    const user = await (await visitor.post("/auth/sign-up/confirm")).json()
    // GitHub vouches for the same address, so it links to the same account.
    expect(target(await visitor.through("github", "ada"))).toBe("/")
    const [google, github] = (await methodsOf(visitor)).methods
    expect([google.kind, google.canUnlink, github.kind, github.canUnlink])
      .toEqual(["google", true, "github", true])

    expect((await visitor.delete(`/auth/methods/${google.id}`)).status).toBe(200)
    const last = await visitor.delete(`/auth/methods/${github.id}`)

    expect(last.status).toBe(409)
    expect((await app.db.authStore.listKeys(user.id)).map((key) => key.method)).toEqual([
      "oauth:github",
    ])
    expect((await methodsOf(visitor)).methods.map((method) => [method.kind, method.canUnlink]))
      .toEqual([["github", false]])
  })
})

Deno.test("the password and another person's method cannot be unlinked", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, {
      ada: ADA,
      bob: { sub: "3003", email: "bob@example.com", verified: true },
    })
    const ada = browser(app)
    const adaId = await provenPasswordAccount(app, ada, "ada@example.com")
    await browser(app).through("google", "ada")
    const bob = browser(app)
    await bob.through("google", "bob")
    await bob.post("/auth/sign-up/confirm")
    const [bobKey] = (await methodsOf(bob)).methods
    const password = (await methodsOf(ada)).methods.find((method) => method.kind === "password")!

    expect((await ada.delete(`/auth/methods/${password.id}`)).status).toBe(404)
    expect((await ada.delete(`/auth/methods/${bobKey.id}`)).status).toBe(404)
    expect((await ada.delete(`/auth/methods/not-a-number`)).status).toBe(404)

    expect((await app.db.authStore.listKeys(adaId)).map((key) => key.method)).toEqual([
      "password",
      "oauth:google",
    ])
    expect((await methodsOf(bob)).methods).toHaveLength(1)
  })
})
