/// <reference lib="deno.ns" />
/**
 * The SPA container writes `/config.json` at start with `apps/spa/runtime-config.sh`, from the
 * variables named in `apps/spa/public-env.allow`. Everything in that file reaches every visitor's
 * browser, so these tests hold two lines: no secret-looking name is listed, and a variable that is
 * not listed never reaches the file.
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"

const SCRIPT = fromFileUrl(new URL("../apps/spa/runtime-config.sh", import.meta.url))
const ALLOW = fromFileUrl(new URL("../apps/spa/public-env.allow", import.meta.url))

/** Names of variables that hold secrets. Public settings must not match. */
const SECRET_LOOKING =
  /SECRET|PASSWORD|PASSWD|TOKEN|PRIVATE|CREDENTIAL|API_?KEY|COOKIE|SALT|PEPPER/i

function listed(text: string): { name: string; key: string }[] {
  return text.split("\n").map((line) => line.trim()).filter((line) =>
    line !== "" && !line.startsWith("#")
  ).map((line) => {
    const [name, key] = line.split(/\s+/)
    return { name, key }
  })
}

/** Runs the script with exactly these variables and returns the parsed file it wrote. */
async function runScript(env: Record<string, string>): Promise<Record<string, unknown>> {
  const dir = await Deno.makeTempDir()
  try {
    const out = `${dir}/config.json`
    const result = await new Deno.Command("sh", {
      args: [SCRIPT],
      clearEnv: true,
      env: { PATH: "/usr/bin:/bin", ALLOW_FILE: ALLOW, OUT_FILE: out, ...env },
    }).output()
    expect(result.code).toBe(0)
    return JSON.parse(await Deno.readTextFile(out))
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

Deno.test("the allow list names no variable that looks like a secret", async () => {
  const entries = listed(await Deno.readTextFile(ALLOW))

  expect(entries.length).toBeGreaterThan(0)
  for (const { name, key } of entries) {
    expect(name).not.toMatch(SECRET_LOOKING)
    expect(key).not.toMatch(SECRET_LOOKING)
    expect(name.startsWith("SPA_")).toBe(true)
  }
})

Deno.test("a variable outside the allow list never reaches config.json", async () => {
  const config = await runScript({
    SPA_ENV: "prod",
    SPA_ERROR_REPORT_DSN: "https://k@tracker.example/1",
    SPA_SECRET: "leak-1",
    COOKIE_SECRET: "leak-2",
    DB_PASSWORD: "leak-3",
  })

  expect(config).toEqual({ env: "prod", errorReportDsn: "https://k@tracker.example/1" })
})

Deno.test("two environments give one image two different config files", async () => {
  const prod = await runScript({ SPA_ENV: "prod", SPA_ERROR_REPORT_DSN: "https://k@a.example/1" })
  const stag = await runScript({ SPA_ENV: "stag" })

  expect(prod).toEqual({ env: "prod", errorReportDsn: "https://k@a.example/1" })
  expect(stag).toEqual({ env: "stag" })
})

Deno.test("a value with quotes and backslashes still gives valid JSON", async () => {
  const config = await runScript({ SPA_ENV: `a"b\\c` })

  expect(config).toEqual({ env: `a"b\\c` })
})

Deno.test("no variables give an empty object", async () => {
  expect(await runScript({})).toEqual({})
})
