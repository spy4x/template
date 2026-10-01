/// <reference lib="deno.ns" />
/**
 * Resets a development database: drops it, creates it again, applies every migration
 * (`db:migrate`) and seeds the demo data (`db:seed`).
 *
 * Usage, with the same `DB_*` values the other `db:*` tasks read (and `AUTH_PEPPER` and
 * `SEED_PASSWORD` for the seed):
 * `ENV=dev deno task db:reset` asks for confirmation; `deno task db:reset --yes` does not.
 *
 * It refuses, before it touches anything, unless all of these hold:
 *
 * - `ENV` is `dev`;
 * - `DB_HOST` is `localhost`, `127.0.0.1` or `db`, the Compose service name of the development
 *   database;
 * - `DB_NAME` is not the `DB_NAME` in `infra/envs/.env.prod`. A machine without that file has
 *   nothing to compare against, so this guard passes there.
 *
 * Refusals never print a host or a database name, so a production value cannot reach a log.
 *
 * @module
 */

import postgres from "postgres"
import { parseEnvValues } from "./env-file.ts"

/** Where the production values live. Only `DB_NAME` is read, only inside this script. */
export const PROD_ENV_PATH = "./infra/envs/.env.prod"

/** Hosts a reset may target: this machine, and the Compose service name of the dev database. */
export const ALLOWED_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "db"]

/** Raised when a guard refuses the reset. The message never carries a host or a name. */
export class ResetRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ResetRefusedError"
  }
}

/** Reads `DB_NAME` out of `.env.prod` content, or `undefined` when it is not set. */
export function readProdDbName(content: string | undefined): string | undefined {
  if (content === undefined) return undefined
  return parseEnvValues(content, PROD_ENV_PATH).DB_NAME || undefined
}

/**
 * Checks the three guards.
 *
 * @throws {ResetRefusedError} When `ENV` is not `dev`, the host is not local, the name is missing
 *   or the name matches `prodDbName`.
 */
export function checkGuards(
  env: Record<string, string | undefined>,
  prodDbName: string | undefined,
): void {
  if (env.ENV !== "dev") throw new ResetRefusedError("ENV must be dev")
  if (!ALLOWED_HOSTS.includes(env.DB_HOST ?? "")) {
    throw new ResetRefusedError("the database host is not local (localhost, 127.0.0.1 or db)")
  }
  if (!env.DB_NAME) throw new ResetRefusedError("DB_NAME is not set")
  if (prodDbName !== undefined && env.DB_NAME === prodDbName) {
    throw new ResetRefusedError("the database name matches production")
  }
}

/** The steps a reset runs, replaceable so tests need no database. */
export interface ResetSteps {
  /** Asks the person to confirm `target`; resolves true to go on. */
  confirm(target: string): boolean | Promise<boolean>
  recreate(env: Record<string, string | undefined>): Promise<void>
  migrate(): Promise<void>
  seed(): Promise<void>
}

/**
 * Runs the guards, asks for confirmation unless `yes`, then recreates, migrates and seeds.
 * Returns false when the person declined; nothing has changed then.
 *
 * @throws {ResetRefusedError} When a guard refuses; no step has run then.
 */
export async function runReset(
  env: Record<string, string | undefined>,
  prodEnvContent: string | undefined,
  options: { yes: boolean },
  steps: ResetSteps,
): Promise<boolean> {
  checkGuards(env, readProdDbName(prodEnvContent))
  const target = `${env.DB_NAME} on ${env.DB_HOST}:${env.DB_PORT || "5432"}`
  if (!options.yes && !(await steps.confirm(target))) return false
  await steps.recreate(env)
  await steps.migrate()
  await steps.seed()
  return true
}

/**
 * Drops the database named by `DB_NAME` (closing its open connections) and creates it empty,
 * connecting through the server's `postgres` maintenance database.
 */
export async function recreateDatabase(env: Record<string, string | undefined>): Promise<void> {
  const name = env.DB_NAME!
  const sql = postgres({
    host: env.DB_HOST,
    port: Number(env.DB_PORT || "5432"),
    user: env.DB_USER,
    password: env.DB_PASS,
    database: "postgres",
    max: 1,
    connect_timeout: 5,
    onnotice: () => {},
  })
  try {
    await sql`DROP DATABASE IF EXISTS ${sql(name)} WITH (FORCE)`
    await sql`CREATE DATABASE ${sql(name)}`
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function runTask(task: string): Promise<void> {
  const { code } = await new Deno.Command("deno", {
    args: ["task", task],
    stdout: "inherit",
    stderr: "inherit",
  }).output()
  if (code !== 0) throw new Error(`deno task ${task} failed (exit ${code})`)
}

async function main(): Promise<void> {
  const env = Deno.env.toObject()
  let prodEnv: string | undefined
  try {
    prodEnv = await Deno.readTextFile(PROD_ENV_PATH)
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
  }
  try {
    const done = await runReset(env, prodEnv, { yes: Deno.args.includes("--yes") }, {
      confirm: (target) => {
        const answer = prompt(`Drop and recreate ${target}? All its data is lost. [y/N]`)
        return answer?.trim().toLowerCase() === "y"
      },
      recreate: recreateDatabase,
      migrate: () => runTask("db:migrate"),
      seed: () => runTask("db:seed"),
    })
    console.log(done ? "✅ Database reset and seeded." : "Cancelled. Nothing changed.")
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : error}`)
    Deno.exit(1)
  }
}

if (import.meta.main) await main()
