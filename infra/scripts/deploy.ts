/// <reference lib="deno.ns" />
/**
 * Copies the app to a server over SSH and starts it there with Compose.
 *
 * Usage: `deno task deploy [env file]`. The env file defaults to `infra/envs/.env.prod` and must
 * live under `infra/`. It reads:
 *
 * - `SSH_TO_SERVER` (required): the SSH destination, `user@host` or a `Host` alias from
 *   `~/.ssh/config`.
 * - `PATH_ON_SERVER` (required): the app's directory on the server, absolute or relative to the
 *   SSH user's home directory (a leading `~/` is read as the home directory too).
 * - `DENO_ON_SERVER` (optional, default `deno`): the command that runs Deno on the server. The
 *   remote command puts `~/.deno/bin`, the Deno installer's directory, on `PATH` first.
 *
 * Three steps, each stopping the deploy when it fails: rsync the files that
 * `infra/deploy/include.txt` names, leaving out every local `infra/envs/.env*`; copy the chosen
 * env file to `infra/envs/.env` on the server, readable by its owner only; then run
 * `deno task compose up -d --build` there.
 *
 * @module
 */

import { error, log, success } from "./+lib.ts"
import { readEnvFile, requireEnvVar } from "./env-file.ts"

/** The env file used when no argument names one. */
export const DEFAULT_ENV_FILE = "infra/envs/.env.prod"

/** One program to run, with its arguments, and what to call it in the log. */
export interface DeployStep {
  label: string
  command: "rsync" | "ssh"
  args: string[]
}

/** Quotes `value` as one word for a POSIX shell. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll(`'`, `'\\''`)}'`
}

/**
 * Builds the deploy steps from the env file's values. Runs nothing.
 *
 * @throws {import("./env-file.ts").MissingEnvVarError} When a required variable is missing.
 */
export function planDeploy(values: Record<string, string>, envFilePath: string): DeployStep[] {
  const server = requireEnvVar(values, "SSH_TO_SERVER", envFilePath)
  const path = requireEnvVar(values, "PATH_ON_SERVER", envFilePath).replace(/^~\//, "")
  const deno = values.DENO_ON_SERVER || "deno"
  const remoteCommand = [
    `cd ${shellQuote(path)}`,
    `PATH="$HOME/.deno/bin:$PATH" ${deno} task compose up -d --build`,
  ].join(" && ")
  return [
    {
      label: "Copying files",
      command: "rsync",
      args: [
        "-avhzru",
        "-e",
        "ssh",
        "--exclude-from=infra/deploy/exclude.txt",
        // Before include.txt, whose infra/*** would otherwise send every local env file.
        "--exclude=/infra/envs/.env*",
        "--include-from=infra/deploy/include.txt",
        "--exclude=*",
        ".",
        `${server}:${path}`,
      ],
    },
    {
      label: `Copying ${envFilePath} to infra/envs/.env`,
      command: "rsync",
      args: ["-e", "ssh", "-p", "--chmod=F600", envFilePath, `${server}:${path}/infra/envs/.env`],
    },
    { label: "Starting the app", command: "ssh", args: [server, remoteCommand] },
  ]
}

async function main(): Promise<void> {
  const envFilePath = Deno.args[0] ?? DEFAULT_ENV_FILE
  let steps: DeployStep[]
  try {
    steps = planDeploy(await readEnvFile(envFilePath), envFilePath)
  } catch (err) {
    error(err instanceof Error ? err.message : err)
    Deno.exit(1)
  }
  for (const step of steps) {
    log(`${step.label}...`)
    const { code } = await new Deno.Command(step.command, {
      args: step.args,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).output()
    if (code !== 0) {
      error(`${step.label} failed (${step.command} exited with ${code})`)
      Deno.exit(code)
    }
  }
  success("Deploy completed.")
}

if (import.meta.main) await main()
