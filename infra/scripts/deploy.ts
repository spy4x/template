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
 * `SSH_TO_SERVER` and `DENO_ON_SERVER` are trusted operator input: the first is passed to ssh and
 * rsync as a destination, the second runs unquoted in the remote shell (so `~/bin/deno` works).
 * `PATH_ON_SERVER` is quoted.
 *
 * Four steps, each stopping the deploy when it fails: rsync the files that
 * `infra/deploy/include.txt` names, leaving out every env file (any `.env*` or `*.env`, anywhere,
 * and the chosen env file itself) and the web push keys; copy the chosen env file to
 * `infra/envs/.env` on the server, readable by its owner only; create `infra/configs/vapid.json`
 * on the server when it is missing (never sent from this machine, never overwritten, mode 600);
 * then run `deno task compose up -d --build` there. Compose's one-shot `migrate` service applies
 * pending migrations before the API and the worker start, and a failed migration fails this step.
 *
 * @module
 */

import { error, log, success } from "./+lib.ts"
import { readEnvFile, requireEnvVar } from "./env-file.ts"

/** The env file used when no argument names one. */
export const DEFAULT_ENV_FILE = "infra/envs/.env.prod"

/** Where the API's web push keys live, relative to the app's directory. */
export const VAPID_PATH = "infra/configs/vapid.json"

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
  const denoPath = `PATH="$HOME/.deno/bin:$PATH" ${deno}`
  const remoteCommand = [
    `cd ${shellQuote(path)}`,
    `${denoPath} task compose up -d --build`,
  ].join(" && ")
  // An earlier start without the file leaves an empty directory there (Docker creates one for a
  // missing bind-mount source); `rmdir` removes only an empty one. A file that exists is kept.
  const vapidCommand = [
    `cd ${shellQuote(path)}`,
    `if [ -d ${VAPID_PATH} ]; then rmdir ${VAPID_PATH}; fi`,
    `if [ ! -e ${VAPID_PATH} ]; then (umask 077 && ${denoPath} task vapid-key:create); fi`,
    `chmod 600 ${VAPID_PATH}`,
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
        // Before include.txt, whose apps/***, libs/*** and infra/*** would otherwise send every
        // local env file. A pattern without a slash matches a file name in any directory.
        "--exclude=.env*",
        "--exclude=*.env",
        `--exclude=/${envFilePath.replace(/^\.\//, "")}`,
        // The private key is made on the server and stays there, whatever this machine holds.
        `--exclude=/${VAPID_PATH}`,
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
    { label: "Creating web push keys if missing", command: "ssh", args: [server, vapidCommand] },
    { label: "Starting the app", command: "ssh", args: [server, remoteCommand] },
  ]
}

/** Runs one step with the terminal attached. Returns its exit code. */
async function run(step: DeployStep): Promise<number> {
  try {
    const command = new Deno.Command(step.command, {
      args: step.args,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
    return (await command.output()).code
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err
    error(`${step.command} is not installed on this machine`)
    return 1
  }
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
    const code = await run(step)
    if (code !== 0) {
      error(`${step.label} failed (${step.command} exited with ${code})`)
      Deno.exit(code)
    }
  }
  success("Deploy completed.")
}

if (import.meta.main) await main()
