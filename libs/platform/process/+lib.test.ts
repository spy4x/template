import { expect } from "@std/expect"
import {
  CommandFailedError,
  CommandOutputLimitError,
  runCommand,
  runCommandOrThrow,
} from "./+lib.ts"

const deno = "deno"

Deno.test("runCommand captures stdout, stderr, and non-zero status", async () => {
  const argv = [
    deno,
    "eval",
    'console.log("output"); console.error("problem"); Deno.exit(7)',
  ] as const

  const result = await runCommand(argv)

  expect(result).toEqual({
    success: false,
    code: 7,
    stdout: "output\n",
    stderr: "problem\n",
  })
})

Deno.test("runCommand passes cwd and explicit environment", async () => {
  const result = await runCommand(
    [
      deno,
      "eval",
      'console.log(`${Deno.cwd()}|${Deno.env.get("PROCESS_TEST_VALUE")}`)',
    ],
    {
      cwd: Deno.cwd(),
      env: { PROCESS_TEST_VALUE: "configured" },
    },
  )

  expect(result.success).toBe(true)
  expect(result.stdout).toBe(`${Deno.cwd()}|configured\n`)
  expect(result.stderr).toBe("")
})

Deno.test("runCommand can clear inherited environment", async () => {
  const result = await runCommand(
    [
      deno,
      "eval",
      'console.log(`${Deno.env.get("PROCESS_INHERITED_TEST") ?? "missing"}|${Deno.env.get("ONLY_VALUE")}`)',
    ],
    {
      clearEnv: true,
      env: { ONLY_VALUE: "configured" },
    },
  )

  expect(result.success).toBe(true)
  expect(result.stdout).toBe("missing|configured\n")
})

Deno.test("runCommand writes string and byte stdin", async () => {
  for (const stdin of ["string input", new TextEncoder().encode("byte input")]) {
    const result = await runCommand(
      [deno, "eval", "await Deno.stdin.readable.pipeTo(Deno.stdout.writable)"],
      { stdin },
    )

    expect(result.success).toBe(true)
    expect(result.stdout).toBe(typeof stdin === "string" ? "string input" : "byte input")
  }
})

Deno.test("runCommand returns empty output for null streams", async () => {
  const result = await runCommand(
    [deno, "eval", 'console.log("discarded"); console.error("discarded")'],
    { stdout: "null", stderr: "null" },
  )

  expect(result).toEqual({ success: true, code: 0, stdout: "", stderr: "" })
})

Deno.test("runCommandOrThrow exposes no arguments or environment", async () => {
  const argumentSecret = "argument-secret"
  const environmentSecret = "environment-secret"

  try {
    await runCommandOrThrow(
      [deno, "eval", "Deno.exit(9)", argumentSecret],
      { env: { PROCESS_TEST_SECRET: environmentSecret } },
    )
    throw new Error("Expected command failure")
  } catch (cause) {
    expect(cause).toBeInstanceOf(CommandFailedError)
    expect(String(cause)).not.toContain(argumentSecret)
    expect(String(cause)).not.toContain(environmentSecret)
    expect(cause).toMatchObject({ code: 9, command: deno })
  }
})

Deno.test("runCommand kills excessive output and redacts failure", async () => {
  const argumentSecret = "argument-output-secret"
  const environmentSecret = "environment-output-secret"

  try {
    await runCommand(
      [deno, "eval", 'while (true) console.log("xxxxxxxxxxxxxxxx")', argumentSecret],
      {
        env: { PROCESS_TEST_SECRET: environmentSecret },
        maxOutputBytes: 1024,
      },
    )
    throw new Error("Expected output limit failure")
  } catch (cause) {
    expect(cause).toBeInstanceOf(CommandOutputLimitError)
    expect(String(cause)).not.toContain(argumentSecret)
    expect(String(cause)).not.toContain(environmentSecret)
    expect(cause).toMatchObject({ command: deno, maxOutputBytes: 1024 })
  }
})
