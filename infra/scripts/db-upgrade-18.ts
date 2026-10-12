/// <reference lib="deno.ns" />
/**
 * Moves a server's data from the Postgres 16 container to the Postgres 18 one.
 *
 * Usage, on the server, from the app's directory, after the files of this version are there
 * (`deno task deploy` copies them and then stops at "Starting the app", see postgres-data.ts):
 * `deno task db:upgrade-18`. The full procedure, the outage to expect and the way back are in
 * docs/postgres-18-upgrade.md.
 *
 * Postgres 18 cannot open a version 16 data directory, so this is a dump and a restore:
 *
 * 1. Build the images, while everything still runs.
 * 2. Stop the API and the worker, so nothing writes any more. The outage starts here.
 * 3. Count the rows of every table and dump the whole server with `pg_dumpall` into
 *    `.db-upgrade/`. When either fails, the API and the worker start again and nothing changed.
 * 4. Stop Postgres 16 and start Postgres 18. It gets `.volumes/postgres18`; `.volumes/postgres`
 *    is not mounted any more and is never written, renamed or deleted.
 * 5. Restore the dump, count the rows again and compare. Any difference fails the upgrade.
 * 6. Write the marker that lets `deno task compose` start the database from now on.
 * 7. Start everything: the `migrate` service applies pending migrations, then the API and the
 *    worker start. The outage ends here.
 *
 * A second run finds the marker, says so and changes nothing. A run that fails after step 3
 * leaves Postgres 18 stopped and the apps down, and `deno task compose up` refused, so a
 * half-restored database is never served.
 *
 * It reads `PROJECT`, `DB_NAME`, `DB_USER`, `ENV` and `CONTAINER_PROVIDER` from
 * `infra/envs/.env`. `psql` and `pg_dumpall` run inside the `<PROJECT>-db` container over its
 * local socket, so no password is passed.
 *
 * @module
 */

import { error, log, success } from "./+lib.ts"
import { createEnvReader, readEnvVar } from "@spy4x/server/config"
import { planCompose } from "./compose-plan.ts"
import { describeEnvFileError, readEnvFile } from "./env-file.ts"
import {
  NEW_DATA_DIR,
  OLD_DATA_DIR,
  type PostgresDataFacts,
  readPostgresDataFacts,
  UPGRADE_MARKER,
} from "./postgres-data.ts"

const ENV_FILE = `./infra/envs/.env`
const DUMP_DIR = `./.db-upgrade`
const DOC = `docs/postgres-18-upgrade.md`
/** The closing comment `pg_dumpall` writes; a dump without it was cut short. */
const DUMP_END = `-- PostgreSQL database cluster dump complete`

/** Rows per table, keyed `<database>/<schema>.<table>`. */
export type RowCounts = Record<string, number>

/**
 * Lists every difference between the tables and row counts before the dump and after the
 * restore, one line each: a table that is gone, a table that appeared, a count that changed.
 * An empty list means the two servers hold the same number of rows in the same tables.
 */
export function compareRowCounts(before: RowCounts, after: RowCounts): string[] {
  const differences: string[] = []
  for (const table of Object.keys(before).sort()) {
    if (!(table in after)) {
      differences.push(`${table}: ${before[table]} rows before, the table is missing after`)
    } else if (before[table] !== after[table]) {
      differences.push(`${table}: ${before[table]} rows before, ${after[table]} after`)
    }
  }
  for (const table of Object.keys(after).sort()) {
    if (!(table in before)) {
      differences.push(`${table}: not there before, ${after[table]} rows after`)
    }
  }
  return differences
}

/** One row per table: its name, a tab, its exact row count. Runs in one database. */
export const ROW_COUNT_SQL =
  `select format('%I.%I', schemaname, tablename) || E'\\t' || (xpath('/row/n/text()', ` +
  `query_to_xml(format('select count(*) as n from %I.%I', schemaname, tablename), ` +
  `false, true, '')))[1]::text from pg_tables ` +
  `where schemaname not in ('pg_catalog', 'information_schema') order by 1`

/**
 * Reads the output of {@link ROW_COUNT_SQL} for one database into `counts`.
 *
 * @throws {Error} When a line is not `<table><tab><number>`: a count nobody can read must not
 *   pass for a match.
 */
export function addRowCounts(counts: RowCounts, database: string, output: string): void {
  for (const line of output.split(`\n`)) {
    if (line.trim() === ``) continue
    const [table, count, ...rest] = line.split(`\t`)
    if (!table || rest.length > 0 || !/^\d+$/.test(count ?? ``)) {
      throw new Error(`Cannot read the row count of ${database} from "${line}"`)
    }
    counts[`${database}/${table}`] = Number(count)
  }
}

/**
 * The errors of a restore that mean lost data. `pg_dumpall` always writes `CREATE ROLE` for the
 * superuser and `CREATE DATABASE` for its databases; on a fresh server the superuser, its
 * database and `postgres` exist already, so those lines fail and the restore fills the existing
 * ones. Every other `ERROR:` line is returned.
 */
export function unexpectedRestoreErrors(
  stderr: string,
  dbUser: string,
  dbName: string,
): string[] {
  const expected = [
    `ERROR:  role "${dbUser}" already exists`,
    `ERROR:  database "${dbName}" already exists`,
  ]
  return stderr.split(`\n`).filter((line) =>
    /\b(ERROR|FATAL|PANIC):/.test(line) && !expected.some((known) => line.endsWith(known))
  )
}

/** What the script finds before it changes anything. */
export type UpgradeState =
  /** Postgres older than 18 runs and no Postgres 18 directory exists: the upgrade can run. */
  | `ready`
  /** The marker is there: an earlier run finished. */
  | `upgraded`
  /** The marker is there but an older Postgres runs: the server was rolled back after an upgrade. */
  | `rolled-back`
  /** Postgres 18 runs and there is no old directory: a server that started on 18. */
  | `not-needed`
  /** A Postgres 18 directory without the marker: an earlier run failed half-way. */
  | `incomplete`
  /** The database container does not answer. */
  | `no-database`

/**
 * Decides the state from the disk and from the running server's major version (`undefined` when
 * it does not answer).
 */
export function upgradeState(facts: PostgresDataFacts, major: number | undefined): UpgradeState {
  const runs18 = major !== undefined && major >= 18
  if (facts.upgradeMarked) return major === undefined || runs18 ? `upgraded` : `rolled-back`
  if (facts.newDataExists) return runs18 && !facts.oldDataExists ? `not-needed` : `incomplete`
  if (major === undefined) return `no-database`
  return runs18 ? `not-needed` : `ready`
}

/** The upgrade's steps, replaceable so the order and the failure paths are tested without a server. */
export interface UpgradeSteps {
  state(): Promise<UpgradeState>
  /** Builds the images; nothing running changes. */
  build(): Promise<void>
  stopApps(): Promise<void>
  /** Starts the API and the worker again after a failed dump. */
  startApps(): Promise<void>
  countRows(): Promise<RowCounts>
  /** Dumps the running server to a file. Throws when the dump fails or is cut short. */
  dump(): Promise<void>
  /** Stops Postgres 16 and starts Postgres 18 on its own, empty directory. */
  startPostgres18(): Promise<void>
  /** Restores the dump. Throws on any error that means lost data. */
  restore(): Promise<void>
  /** Writes the marker into the Postgres 18 directory. */
  mark(): Promise<void>
  /** Stops the database after a failed restore, so nothing serves it. */
  stopDatabase(): Promise<void>
  /** `compose up -d`: migrations, then the API, the worker and the rest. */
  startEverything(): Promise<void>
  now(): number
  log(message: string): void
}

/** The upgrade stopped. `message` says what state the server is in. */
export class UpgradeFailedError extends Error {
  override name = `UpgradeFailedError`
}

/** What a finished run reports. */
export interface UpgradeReport {
  /** False when there was nothing to do. */
  changed: boolean
  state: UpgradeState
  /** Milliseconds between stopping the apps and `compose up -d` returning. */
  downtimeMs?: number
  tables?: number
  rows?: number
}

const REFUSALS: Record<`incomplete` | `no-database` | `rolled-back`, string> = {
  incomplete:
    `${NEW_DATA_DIR} exists but an upgrade never finished in it, so it may hold part of the data. ` +
    `Nothing was changed. Roll back or start over as ${DOC} says ("When it fails").`,
  "rolled-back":
    `${NEW_DATA_DIR} holds a finished upgrade, but an older Postgres is running: this server was ` +
    `rolled back, and that directory misses everything written since. Nothing was changed. ` +
    `Move it away as ${DOC} says ("Rolling back"), then run this again.`,
  "no-database":
    `The database container does not answer, so there is nothing to dump. Nothing was changed. ` +
    `Start the stack from the last version that ran Postgres 16, then run this again.`,
}

const describe = (cause: unknown) => cause instanceof Error ? cause.message : String(cause)

/**
 * Runs the upgrade. Resolves with `changed: false` when the server is already on Postgres 18.
 *
 * @throws {UpgradeFailedError} When a state refuses the upgrade (nothing has run), when the count
 *   or the dump fails (the apps run again, nothing else changed), or when a later step fails
 *   (Postgres 18 and the apps are stopped, the old directory is untouched).
 */
export async function runUpgrade(steps: UpgradeSteps): Promise<UpgradeReport> {
  const state = await steps.state()
  if (state === `upgraded` || state === `not-needed`) return { changed: false, state }
  if (state !== `ready`) throw new UpgradeFailedError(REFUSALS[state])

  steps.log(`Building the images...`)
  await steps.build()

  steps.log(`Stopping the API and the worker...`)
  const stoppedAt = steps.now()
  await steps.stopApps()
  let before: RowCounts
  try {
    steps.log(`Counting rows and dumping Postgres 16...`)
    before = await steps.countRows()
    await steps.dump()
  } catch (cause) {
    await steps.startApps()
    throw new UpgradeFailedError(
      `${describe(cause)}\nNothing was changed: Postgres 16 still runs on ${OLD_DATA_DIR}, and ` +
        `the API and the worker were started again.`,
    )
  }

  try {
    steps.log(`Starting Postgres 18 on ${NEW_DATA_DIR}...`)
    await steps.startPostgres18()
    steps.log(`Restoring the dump...`)
    await steps.restore()
    const differences = compareRowCounts(before, await steps.countRows())
    if (differences.length > 0) {
      throw new Error(
        `The restored database does not match the dumped one:\n${differences.join(`\n`)}`,
      )
    }
    await steps.mark()
  } catch (cause) {
    try {
      await steps.stopDatabase()
    } catch (stopError) {
      steps.log(`Could not stop the database: ${describe(stopError)}`)
    }
    throw new UpgradeFailedError(
      `${describe(cause)}\nThe upgrade failed. The database, the API and the worker are ` +
        `stopped, and ${OLD_DATA_DIR} is untouched. Roll back as ${DOC} says ("When it fails").`,
    )
  }

  steps.log(`Row counts match. Applying migrations and starting the apps...`)
  try {
    await steps.startEverything()
  } catch (cause) {
    throw new UpgradeFailedError(
      `${describe(cause)}\nThe data is on Postgres 18 and its row counts matched, but the apps ` +
        `did not start. Fix the cause and run: deno task compose up -d`,
    )
  }
  const counts = Object.values(before)
  return {
    changed: true,
    state,
    downtimeMs: steps.now() - stoppedAt,
    tables: counts.length,
    rows: counts.reduce((sum, count) => sum + count, 0),
  }
}

// --- The real steps: the container engine, driven as `deno task compose` drives it. ---

interface Output {
  code: number
  stdout: string
  stderr: string
}

/** Builds the real steps from the env file's values. */
function engineSteps(values: Record<string, string>, dumpPath: string): UpgradeSteps {
  const env = createEnvReader(values)
  const read = (name: string) => readEnvVar(env, name)
  const container = `${read(`PROJECT`)}-db`
  const dbName = read(`DB_NAME`)
  const dbUser = read(`DB_USER`)
  read(`ENV`) // names the second Compose file; fail here when it is missing
  const plan = (args: string[]) => planCompose(values, args, ENV_FILE)
  const engine = plan([]).engine

  /** Runs the engine with its output on the terminal. */
  async function show(args: string[]): Promise<void> {
    const { code } = await new Deno.Command(engine, {
      args,
      stdout: `inherit`,
      stderr: `inherit`,
    }).output()
    if (code !== 0) throw new Error(`${engine} ${args.join(` `)} failed (exit ${code})`)
  }
  const compose = (...args: string[]) => show(plan(args).command)

  /** Runs the engine and returns what it printed. */
  async function capture(args: string[], stdinPath?: string): Promise<Output> {
    const child = new Deno.Command(engine, {
      args,
      stdin: stdinPath ? `piped` : `null`,
      stdout: `piped`,
      stderr: `piped`,
    }).spawn()
    const feeding = stdinPath
      ? (await Deno.open(stdinPath)).readable.pipeTo(child.stdin).catch(() => {})
      : Promise.resolve()
    const { code, stdout, stderr } = await child.output()
    await feeding
    const text = new TextDecoder()
    return { code, stdout: text.decode(stdout), stderr: text.decode(stderr) }
  }

  const psql = (database: string, ...rest: string[]) => [
    `exec`,
    `-i`,
    container,
    `psql`,
    `-X`,
    `-U`,
    dbUser,
    `-d`,
    database,
    ...rest,
  ]

  /** Runs one statement and returns its rows as text. */
  async function query(database: string, sql: string): Promise<string> {
    const result = await capture(psql(database, `-v`, `ON_ERROR_STOP=1`, `-At`, `-c`, sql))
    if (result.code !== 0) {
      throw new Error(`psql failed in ${container} (exit ${result.code}): ${result.stderr.trim()}`)
    }
    return result.stdout
  }

  async function majorVersion(): Promise<number | undefined> {
    const result = await capture(psql(dbName, `-At`, `-c`, `show server_version_num`))
    const version = Number(result.stdout.trim())
    return result.code === 0 && version > 0 ? Math.floor(version / 10000) : undefined
  }

  /** Waits until the server accepts TCP connections: initdb's temporary one never does. */
  async function waitUntilReady(deadlineMs: number): Promise<void> {
    const ready = [`exec`, container, `pg_isready`, `-q`, `-h`, `127.0.0.1`, `-U`, dbUser]
    const deadline = Date.now() + deadlineMs
    while ((await capture([...ready, `-d`, dbName])).code !== 0) {
      if (Date.now() > deadline) {
        throw new Error(`${container} did not accept connections in ${deadlineMs / 1000} s`)
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  return {
    now: () => Date.now(),
    log,
    state: async () => upgradeState(await readPostgresDataFacts(), await majorVersion()),
    async build() {
      const { buildBase } = plan([`build`])
      if (buildBase) await show(buildBase)
      await compose(`build`)
    },
    stopApps: () => compose(`stop`, `api`, `worker`),
    startApps: () => compose(`start`, `api`, `worker`),
    async countRows() {
      const counts: RowCounts = {}
      const databases = await query(
        dbName,
        `select datname from pg_database where not datistemplate order by 1`,
      )
      for (const database of databases.split(`\n`).filter((name) => name !== ``)) {
        addRowCounts(counts, database, await query(database, ROW_COUNT_SQL))
      }
      return counts
    },
    async dump() {
      await Deno.mkdir(DUMP_DIR, { recursive: true, mode: 0o700 })
      const child = new Deno.Command(engine, {
        args: [`exec`, container, `pg_dumpall`, `-U`, dbUser],
        stdin: `null`,
        stdout: `piped`,
        stderr: `inherit`,
      }).spawn()
      const file = await Deno.open(dumpPath, { write: true, createNew: true, mode: 0o600 })
      await child.stdout.pipeTo(file.writable)
      const { code } = await child.status
      if (code !== 0) throw new Error(`pg_dumpall failed (${engine} exited with ${code})`)
      // The closing comment says the dump is whole; read the end only, a dump can be large.
      const { size } = await Deno.stat(dumpPath)
      const end = new Uint8Array(Math.min(size, 256))
      using reader = await Deno.open(dumpPath)
      await reader.seek(-end.length, Deno.SeekMode.End)
      await reader.read(end)
      if (!new TextDecoder().decode(end).includes(DUMP_END)) {
        throw new Error(`The dump in ${dumpPath} is cut short: its closing comment is missing`)
      }
      log(`Dumped ${(size / 1024 / 1024).toFixed(2)} MB to ${dumpPath}`)
    },
    async startPostgres18() {
      // A long timeout: Postgres 16 must finish its shutdown checkpoint, not be killed.
      await compose(`stop`, `--timeout`, `120`, `db`)
      await compose(`up`, `-d`, `--no-deps`, `db`)
      await waitUntilReady(180_000)
      const major = await majorVersion()
      if (major !== 18) throw new Error(`${container} runs Postgres ${major}, not 18`)
    },
    async restore() {
      const result = await capture(psql(`postgres`, `-q`), dumpPath)
      if (result.code !== 0) {
        throw new Error(`The restore failed (exit ${result.code}): ${result.stderr.trim()}`)
      }
      const errors = unexpectedRestoreErrors(result.stderr, dbUser, dbName)
      if (errors.length > 0) throw new Error(`The restore reported errors:\n${errors.join(`\n`)}`)
    },
    async mark() {
      // Inside the container the new directory is /var/lib/postgresql, and its user may write it.
      const line = `Restored from ${OLD_DATA_DIR} on ${new Date().toISOString()}`
      const write = `printf '%s\\n' "$1" > /var/lib/postgresql/${UPGRADE_MARKER}`
      const result = await capture([`exec`, container, `sh`, `-c`, write, `sh`, line])
      if (result.code !== 0) throw new Error(`Could not write the marker: ${result.stderr.trim()}`)
    },
    stopDatabase: () => compose(`stop`, `--timeout`, `120`, `db`),
    startEverything: () => compose(`up`, `-d`),
  }
}

async function main(): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, `_`)
  const dumpPath = `${DUMP_DIR}/postgres-16-${stamp}.sql`
  try {
    let steps: UpgradeSteps
    try {
      steps = engineSteps(await readEnvFile(ENV_FILE), dumpPath)
    } catch (err) {
      throw new UpgradeFailedError(describeEnvFileError(err, ENV_FILE))
    }
    const report = await runUpgrade(steps)
    if (!report.changed) {
      success(
        report.state === `upgraded`
          ? `Already upgraded: ${NEW_DATA_DIR}/${UPGRADE_MARKER} is there. Nothing was changed.`
          : `This server already runs Postgres 18 and has no ${OLD_DATA_DIR}. Nothing was changed.`,
      )
      return
    }
    success(
      `Upgraded to Postgres 18: ${report.rows} rows in ${report.tables} tables match. ` +
        `The apps were down for ${(report.downtimeMs! / 1000).toFixed(1)} s.`,
    )
    log(`${OLD_DATA_DIR} and ${dumpPath} are kept. Remove them by hand once you trust the new`)
    log(`database: ${DOC} ("Afterwards").`)
  } catch (err) {
    error(err instanceof UpgradeFailedError ? err.message : describe(err))
    Deno.exit(1)
  }
}

if (import.meta.main) await main()
