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
 * Before anything is sent, the deploy stops when the env file still holds an example secret: a
 * variable that `infra/envs/.env.example` gives a password or secret value, left at that value.
 * The message names each such variable and never prints a value.
 *
 * Four steps, each stopping the deploy when it fails: rsync the files that
 * `infra/deploy/include.txt` names, leaving out every env file (any `.env*` or `*.env`, anywhere,
 * and the chosen env file itself) and the web push keys, and deleting server files under those
 * paths that are gone here (excluded files are never deleted, so a file placed by hand under
 * `apps/`, `libs/` or `infra/` survives only if it is an env file or the web push keys); copy the chosen env file to
 * `infra/envs/.env` on the server, readable by its owner only; create `infra/configs/vapid.json`
 * on the server when it is missing (never sent from this machine, never overwritten, mode 600);
 * then run `deno task compose up -d --build` there. Compose's one-shot `migrate` service applies
 * pending migrations before the API and the worker start, and a failed migration fails this step.
 *
 * @module
 */

import { error, log, success } from "./+lib.ts"
import { createEnvReader, readEnvVar } from "@spy4x/server/config"
import { describeEnvFileError, readEnvFile } from "./env-file.ts"

/** The env file used when no argument names one. */
export const DEFAULT_ENV_FILE = "infra/envs/.env.prod"

/** Where the API's web push keys live, relative to the app's directory. */
export const VAPID_PATH = "infra/configs/vapid.json"

/** The file whose secret values are public, so none of them may reach a server. */
export const EXAMPLE_ENV_FILE = "infra/envs/.env.example"

/** Names of variables that hold a password, secret or key. */
const SECRET_NAME = /PASS|SECRET|PEPPER|TOTP|KEY|TOKEN/

/**
 * The secrets of `values` that still equal their value in `example`, by variable name. A variable
 * counts when its name says it is a secret and the example gives it a value, so the list follows
 * `.env.example` and needs no copy here. An empty example value is no secret to leave in place.
 */
export function exampleSecretsIn(
  values: Record<string, string>,
  example: Record<string, string>,
): string[] {
  return Object.keys(example).filter((name) =>
    SECRET_NAME.test(name) && example[name] !== "" && values[name] === example[name]
  )
}

/**
 * Stops a deploy whose env file still holds an example secret.
 *
 * @throws {Error} Naming the env file and each variable left at its example value.
 */
export function refuseExampleSecrets(
  values: Record<string, string>,
  example: Record<string, string>,
  envFilePath: string,
): void {
  const names = exampleSecretsIn(values, example)
  if (names.length === 0) return
  throw new Error(
    `${envFilePath} still holds the example value of ${names.join(", ")} ` +
      `(${EXAMPLE_ENV_FILE} is public). Set a real value for each before deploying.`,
  )
}

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
 * @throws {import("@spy4x/server/config").MissingEnvError} When a required variable is missing.
 */
export function planDeploy(values: Record<string, string>, envFilePath: string): DeployStep[] {
  const env = createEnvReader(values)
  const server = readEnvVar(env, "SSH_TO_SERVER")
  const path = readEnvVar(env, "PATH_ON_SERVER").replace(/^~\//, "")
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
        // Removes files deleted here, so a stale module cannot break the build on the server.
        // Excluded paths (the env file, the private key) are never deleted: no --delete-excluded.
        "--delete",
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
    const values = await readEnvFile(envFilePath)
    refuseExampleSecrets(values, await readEnvFile(EXAMPLE_ENV_FILE), envFilePath)
    steps = planDeploy(values, envFilePath)
  } catch (err) {
    error(describeEnvFileError(err, envFilePath))
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
