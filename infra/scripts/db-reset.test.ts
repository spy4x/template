/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { checkGuards, readProdDbName, ResetRefusedError, type ResetSteps, runReset } from "./db-reset.ts"

const DEV = { ENV: "dev", DB_HOST: "127.0.0.1", DB_PORT: "5432", DB_NAME: "dev_db" }
const PROD_FILE = `# fixture\nDB_NAME=fixture_prod_db # note\nDB_HOST=db\n`

function steps(answer: boolean): ResetSteps & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    announce: () => {},
    confirm: (target) => {
      calls.push(`confirm ${target}`)
      return answer
    },
    recreate: () => Promise.resolve(void calls.push("recreate")),
    migrate: () => Promise.resolve(void calls.push("migrate")),
    seed: () => Promise.resolve(void calls.push("seed")),
  }
}

Deno.test("refuses to reset when ENV is prod, before any step runs", async () => {
  const s = steps(true)
  await expect(runReset({ ...DEV, ENV: "prod" }, PROD_FILE, { yes: true }, s)).rejects.toThrow(
    new ResetRefusedError("ENV must be dev"),
  )
  expect(s.calls).toEqual([])
})

Deno.test("refuses to reset when ENV is unset", () => {
  expect(() => checkGuards({ ...DEV, ENV: undefined }, undefined)).toThrow(/ENV must be dev/)
})

Deno.test("refuses to reset a remote database host without naming it", () => {
  for (const host of ["db.example.com", "192.0.2.10", "", undefined]) {
    const run = () => checkGuards({ ...DEV, DB_HOST: host }, undefined)
    expect(run).toThrow(ResetRefusedError)
    expect(run).toThrow(/not local/)
    try {
      run()
    } catch (error) {
      expect((error as Error).message).not.toContain("example.com")
    }
  }
})

Deno.test("accepts localhost, 127.0.0.1 and the db service name", () => {
  for (const host of ["localhost", "127.0.0.1", "db"]) {
    expect(() => checkGuards({ ...DEV, DB_HOST: host }, undefined)).not.toThrow()
  }
})

Deno.test("refuses a database name that appears in .env.prod, without printing it", async () => {
  const s = steps(true)
  const env = { ...DEV, DB_NAME: "fixture_prod_db" }
  let message = ""
  try {
    await runReset(env, PROD_FILE, { yes: true }, s)
  } catch (error) {
    message = (error as Error).message
  }
  expect(message).toBe("the database name matches production")
  expect(message).not.toContain("fixture_prod_db")
  expect(s.calls).toEqual([])
})

Deno.test("refuses when DB_NAME is not set", () => {
  expect(() => checkGuards({ ...DEV, DB_NAME: undefined }, undefined)).toThrow(/DB_NAME/)
})

Deno.test("refuses when .env.prod is missing, unless the check is skipped", async () => {
  const s = steps(true)
  await expect(runReset(DEV, undefined, { yes: true }, s)).rejects.toThrow(
    /no production file to compare against/,
  )
  expect(s.calls).toEqual([])
  expect(await runReset(DEV, undefined, { yes: true, skipProdCheck: true }, s)).toBe(true)
})

Deno.test("refuses when .env.prod has no usable DB_NAME", () => {
  expect(() => readProdDbName("OTHER=1\n")).toThrow(/missing or empty/)
  expect(() => readProdDbName("DB_NAME=\n")).toThrow(/missing or empty/)
})

Deno.test("refuses a production DB_NAME with $ expansion without printing it", () => {
  const run = () => readProdDbName("DB_NAME=${DB_X:-fixture_victim}\n")
  expect(run).toThrow(/variable expansion/)
  try {
    run()
  } catch (error) {
    expect((error as Error).message).not.toContain("fixture_victim")
  }
})

Deno.test("reads a CRLF .env.prod without a stray carriage return", () => {
  expect(readProdDbName("DB_NAME=fixture_prod_db\r\nDB_HOST=db\r\n")).toBe("fixture_prod_db")
  expect(() => checkGuards({ ...DEV, DB_NAME: "fixture_prod_db" }, "fixture_prod_db")).toThrow()
})

Deno.test("names the missing production file in the target when the check is skipped", async () => {
  const targets: string[] = []
  const s = { ...steps(true), announce: (t: string) => void targets.push(t) }
  await runReset(DEV, undefined, { yes: true, skipProdCheck: true }, s)
  expect(targets).toEqual(["dev_db on 127.0.0.1:5432 (no production file to compare against)"])
})

Deno.test("reads DB_NAME from .env.prod the way Compose does", () => {
  expect(readProdDbName(PROD_FILE)).toBe("fixture_prod_db")
})

Deno.test("recreates, migrates and seeds in order after confirmation", async () => {
  const s = steps(true)
  expect(await runReset(DEV, PROD_FILE, { yes: false }, s)).toBe(true)
  expect(s.calls).toEqual(["confirm dev_db on 127.0.0.1:5432", "recreate", "migrate", "seed"])
})

Deno.test("changes nothing when the person declines", async () => {
  const s = steps(false)
  expect(await runReset(DEV, PROD_FILE, { yes: false }, s)).toBe(false)
  expect(s.calls).toEqual(["confirm dev_db on 127.0.0.1:5432"])
})

Deno.test("skips the question with --yes", async () => {
  const s = steps(false)
  expect(await runReset(DEV, PROD_FILE, { yes: true }, s)).toBe(true)
  expect(s.calls).toEqual(["recreate", "migrate", "seed"])
})

Deno.test("names a production file other than the default in the target", async () => {
  const targets: string[] = []
  const s = { ...steps(true), announce: (t: string) => void targets.push(t) }
  await runReset(DEV, PROD_FILE, { yes: true, prodPath: "./infra/envs/.env.example" }, s)
  expect(targets).toEqual(["dev_db on 127.0.0.1:5432 (production file: ./infra/envs/.env.example)"])
  await expect(runReset(DEV, undefined, { yes: true, prodPath: "./infra/envs/other" }, s)).rejects
    .toThrow("./infra/envs/other is missing")
})
