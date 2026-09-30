/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import postgres from "postgres"
import { RedisKvStore } from "@spy4x/server/kv"
import { buildMethods } from "@spy4x/platform/cache"
import { ONE_MONTH_IN_SECONDS } from "@spy4x/platform/universal/time-constants"
import type { User } from "@domain/identity"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createCacheService } from "../../apps/api/services/cache-service.ts"
import { createSignIn } from "../../apps/api/services/sign-in.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { requireDbConnection } from "./db-connection.ts"

/**
 * A signed-in request against a real Postgres and the API's real `RedisKvStore`, while the
 * "Valkey" behind it is stopped and started again. The Valkey is a small in-process server that
 * answers `PING`, `GET`, `SET` and `DEL` (no docker needed); stopping it closes the listener and
 * every open connection, which is what the store sees when Valkey goes down.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in HANDOFF.md). It fails when they
 * are missing rather than skipping.
 */

const MIGRATIONS = [
  "2026_01_26_0001_init.sql",
  "2026_01_26_0002_auth_profiles_audit.sql",
  "2026_01_27_0001_drop_user_profiles.sql",
  "2026_08_18_0001_group_core.sql",
  "2026_08_18_0002_personal_group_backfill.sql",
  "2026_09_24_0001_auth_package_tables.sql",
]
const RETRY_MS = 50
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"

/** Parses the RESP array a Redis client sends and returns its words. */
function commandWords(text: string): string[] {
  const lines = text.split("\r\n")
  const words: string[] = []
  for (let i = 1; i < lines.length; i += 2) if (lines[i + 1] !== undefined) words.push(lines[i + 1])
  return words
}

class FakeValkey {
  #listener: Deno.Listener | null = null
  #connections = new Set<Deno.Conn>()
  readonly port: number

  /** `values` is what Valkey holds; a restart keeps it, like a restart from a snapshot. */
  private constructor(listener: Deno.Listener, readonly values: Map<string, string>) {
    this.port = (listener.addr as Deno.NetAddr).port
    this.#serve(listener)
  }

  static start(port = 0, values = new Map<string, string>()): FakeValkey {
    return new FakeValkey(Deno.listen({ hostname: "127.0.0.1", port }), values)
  }

  restart(): FakeValkey {
    return FakeValkey.start(this.port, this.values)
  }

  #serve(listener: Deno.Listener): void {
    this.#listener = listener
    ;(async () => {
      try {
        for await (const conn of listener) {
          this.#connections.add(conn)
          this.#handle(conn).catch(() => {}).finally(() => this.#connections.delete(conn))
        }
      } catch { /* listener closed */ }
    })()
  }

  async #handle(conn: Deno.Conn): Promise<void> {
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    const buffer = new Uint8Array(65536)
    for (;;) {
      const read = await conn.read(buffer)
      if (read === null) return
      const [name, key, value, ...rest] = commandWords(decoder.decode(buffer.subarray(0, read)))
      let reply = "+OK\r\n"
      if (name.toUpperCase() === "PING") reply = "+PONG\r\n"
      else if (name.toUpperCase() === "GET") {
        const found = this.values.get(key)
        reply = found === undefined ? "$-1\r\n" : `$${encoder.encode(found).length}\r\n${found}\r\n`
      } else if (name.toUpperCase() === "SET") this.values.set(key, value)
      else if (name.toUpperCase() === "DEL") {
        const deleted = [key, value, ...rest].filter((k) =>
          k !== undefined && this.values.delete(k)
        )
        reply = `:${deleted.length}\r\n`
      } else if (name.toUpperCase() === "SCAN") {
        // Always one page: `SCAN 0 MATCH <prefix>:* COUNT n` -> cursor "0" and every matching key.
        const prefix = rest[0].slice(0, -1)
        const keys = [...this.values.keys()].filter((k) => k.startsWith(prefix))
        reply = `*2\r\n$1\r\n0\r\n*${keys.length}\r\n` +
          keys.map((k) => `$${encoder.encode(k).length}\r\n${k}\r\n`).join("")
      }
      await conn.write(encoder.encode(reply))
    }
  }

  stop(): void {
    this.#listener?.close()
    for (const conn of this.#connections) {
      try {
        conn.close()
      } catch { /* already closed */ }
    }
  }
}

Deno.test("a signed-in request survives a Valkey outage and recovers after it", async () => {
  const settings = requireDbConnection()
  const admin = postgres({ ...settings, max: 1 })
  const schema = `valkey_test_${crypto.randomUUID().replaceAll("-", "")}`
  const sql = postgres({
    ...settings,
    max: 10,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  let valkey = FakeValkey.start()
  let kv: RedisKvStore | undefined
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    for (const name of MIGRATIONS) {
      await sql.unsafe(await Deno.readTextFile(`libs/server/db/migrations/${name}`))
    }
    kv = await RedisKvStore.connect("127.0.0.1", valkey.port, "api")
    const reports: string[] = []
    const cache = createCacheService(kv, (operation) => reports.push(operation), RETRY_MS)
    const userCache = buildMethods<User>(cache, "user", ONE_MONTH_IN_SECONDS)
    const db = new AppDbBase({ sql, userCache })
    const signIn = createSignIn({
      db,
      pepper: PEPPER,
      cookieSecret: COOKIE_SECRET,
      secureCookie: false,
      sessionMinutes: 60,
      totpIssuer: "example.test",
    })
    const app = new Hono<APIContext>()
    app.use(signIn.auth.parseAuth)
    app.post("/sign-up", async (c) => {
      const result = await signIn.signUp(c, "alice", "Passw0rd!")
      return result ? c.json(result.user) : c.json({ error: "refused" }, 401)
    })
    app.get("/me", signIn.auth.isAuthenticated2FA, (c) => c.json(c.get("auth")!.user))

    const signUp = await app.request("http://local/sign-up", { method: "POST" })
    expect(signUp.status).toBe(200)
    const cookie = signUp.headers.getSetCookie().map((line) => line.split(";")[0]).join("; ")
    const userId = (await signUp.json()).id as number
    const me = () => app.request("http://local/me", { headers: { cookie } })

    expect((await me()).status).toBe(200)
    expect(reports).toEqual([])

    valkey.stop()
    // The update commits to Postgres while Valkey cannot be told: its old copy must not come back.
    await db.user.updateOne({ id: userId, data: { firstName: "Changed" } })
    for (let i = 0; i < 3; i++) {
      const response = await me()
      expect(response.status).toBe(200)
      expect((await response.json()).firstName).toBe("Changed")
    }
    expect(reports.length).toBeGreaterThan(0)

    valkey = valkey.restart()
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS * 2))
    expect((await me()).status).toBe(200)
    expect((await (await me()).json()).firstName).toBe("Changed")
    expect(valkey.values.size).toBeGreaterThan(0)
    const reportsAfterRecovery = reports.length
    expect((await me()).status).toBe(200)
    expect(reports.length).toBe(reportsAfterRecovery)
  } finally {
    kv?.close()
    valkey.stop()
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
})
