/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import {
  addRowCounts,
  compareRowCounts,
  type RowCounts,
  runUpgrade,
  unexpectedRestoreErrors,
  UpgradeFailedError,
  type UpgradeState,
  upgradeState,
  type UpgradeSteps,
} from "./db-upgrade-18.ts"

const COUNTS: RowCounts = { "app/public.notes": 120, "app/public.users": 7 }

/** Steps that record their calls; `fail` names the one that throws, `after` the second count. */
function steps(
  options: { state?: UpgradeState; fail?: string; after?: RowCounts } = {},
): UpgradeSteps & { calls: string[] } {
  const calls: string[] = []
  let counted = 0
  let clock = 1000
  const step = (name: string) => () => {
    calls.push(name)
    return options.fail === name ? Promise.reject(new Error(`${name} broke`)) : Promise.resolve()
  }
  return {
    calls,
    state: () => Promise.resolve(options.state ?? "ready"),
    build: step("build"),
    stopApps: step("stopApps"),
    startApps: step("startApps"),
    countRows: async () => {
      await step("countRows")()
      return counted++ === 0 ? COUNTS : options.after ?? COUNTS
    },
    dump: step("dump"),
    startPostgres18: step("startPostgres18"),
    restore: step("restore"),
    mark: step("mark"),
    stopDatabase: step("stopDatabase"),
    startEverything: step("startEverything"),
    now: () => (clock += 2500),
    log: () => {},
  }
}

Deno.test("stops the apps, dumps, moves to Postgres 18, restores, compares, marks, then starts the apps", async () => {
  const s = steps()
  const report = await runUpgrade(s)
  expect(s.calls).toEqual([
    "build",
    "stopApps",
    "countRows",
    "dump",
    "startPostgres18",
    "restore",
    "countRows",
    "mark",
    "startEverything",
  ])
  expect(report).toEqual({ changed: true, state: "ready", downtimeMs: 2500, tables: 2, rows: 127 })
})

Deno.test("a second run on an upgraded server changes nothing", async () => {
  for (const state of ["upgraded", "not-needed"] as const) {
    const s = steps({ state })
    expect(await runUpgrade(s)).toEqual({ changed: false, state })
    expect(s.calls).toEqual([])
  }
})

Deno.test("refuses before any step after a half-finished run, after a rollback, or when no database answers", async () => {
  for (const state of ["incomplete", "no-database", "rolled-back"] as const) {
    const s = steps({ state })
    await expect(runUpgrade(s)).rejects.toThrow(UpgradeFailedError)
    await expect(runUpgrade(s)).rejects.toThrow("Nothing was changed")
    expect(s.calls).toEqual([])
  }
})

Deno.test("a failed dump leaves Postgres 16 running and starts the apps again", async () => {
  for (const fail of ["countRows", "dump"]) {
    const s = steps({ fail })
    await expect(runUpgrade(s)).rejects.toThrow(`${fail} broke\nNothing was changed`)
    expect(s.calls.slice(-1)).toEqual(["startApps"])
    expect(s.calls).not.toContain("startPostgres18")
    expect(s.calls).not.toContain("mark")
  }
})

Deno.test("a row count that differs after the restore fails the upgrade and serves nothing", async () => {
  const s = steps({ after: { ...COUNTS, "app/public.notes": 119 } })
  await expect(runUpgrade(s)).rejects.toThrow("app/public.notes: 120 rows before, 119 after")
  expect(s.calls.slice(-2)).toEqual(["countRows", "stopDatabase"])
  expect(s.calls).not.toContain("mark")
  expect(s.calls).not.toContain("startEverything")
})

Deno.test("a failed restore stops the database and neither marks nor starts the apps", async () => {
  for (const fail of ["startPostgres18", "restore"]) {
    const s = steps({ fail })
    await expect(runUpgrade(s)).rejects.toThrow(`${fail} broke\nThe upgrade failed`)
    expect(s.calls.slice(-1)).toEqual(["stopDatabase"])
    expect(s.calls).not.toContain("mark")
    expect(s.calls).not.toContain("startEverything")
  }
})

Deno.test("row counts match only when every table is there with the same count", () => {
  expect(compareRowCounts(COUNTS, { ...COUNTS })).toEqual([])
  expect(compareRowCounts(COUNTS, { "app/public.users": 7 })).toEqual([
    "app/public.notes: 120 rows before, the table is missing after",
  ])
  expect(compareRowCounts(COUNTS, { ...COUNTS, "app/public.users": 0 })).toEqual([
    "app/public.users: 7 rows before, 0 after",
  ])
  expect(compareRowCounts(COUNTS, { ...COUNTS, "app/public.extra": 3 })).toEqual([
    "app/public.extra: not there before, 3 rows after",
  ])
})

Deno.test("reads one count per table and refuses a line it cannot read", () => {
  const counts: RowCounts = {}
  addRowCounts(counts, "app", "public.notes\t120\npublic.users\t0\n")
  expect(counts).toEqual({ "app/public.notes": 120, "app/public.users": 0 })
  expect(() => addRowCounts({}, "app", "public.notes\t")).toThrow("Cannot read the row count")
  expect(() => addRowCounts({}, "app", "public.notes\tmany")).toThrow("Cannot read the row count")
})

Deno.test("a restore's errors pass only for the role and the database a fresh server already has", () => {
  const known = 'ERROR:  role "app" already exists\nERROR:  database "app" already exists\n'
  expect(unexpectedRestoreErrors(known, "app", "app")).toEqual([])
  const lost = 'ERROR:  relation "notes" already exists'
  expect(unexpectedRestoreErrors(`${known}${lost}\nNOTICE:  fine\n`, "app", "app")).toEqual([lost])
  expect(unexpectedRestoreErrors('ERROR:  role "other" already exists', "app", "app")).toHaveLength(1)
  expect(unexpectedRestoreErrors("psql: error: FATAL:  the database system is shutting down", "a", "a"))
    .toHaveLength(1)
})

Deno.test("the state comes from the marker first, then the directories and the running version", () => {
  const facts = { oldDataExists: true, newDataExists: false, upgradeMarked: false }
  expect(upgradeState(facts, 16)).toBe("ready")
  expect(upgradeState(facts, undefined)).toBe("no-database")
  expect(upgradeState({ ...facts, newDataExists: true }, 16)).toBe("incomplete")
  expect(upgradeState({ ...facts, newDataExists: true }, 18)).toBe("incomplete")
  const marked = { ...facts, newDataExists: true, upgradeMarked: true }
  expect(upgradeState(marked, 18)).toBe("upgraded")
  expect(upgradeState(marked, undefined)).toBe("upgraded")
  // Rolled back: the marked directory is stale, so a second upgrade must not call it done.
  expect(upgradeState(marked, 16)).toBe("rolled-back")
  const fresh = { oldDataExists: false, newDataExists: true, upgradeMarked: false }
  expect(upgradeState(fresh, 18)).toBe("not-needed")
  expect(upgradeState(fresh, undefined)).toBe("incomplete")
})
