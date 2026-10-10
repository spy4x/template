/// <reference lib="deno.ns" />
/**
 * Reads `infra/envs/.env*` files the way Docker Compose's `--env-file` reads them, for the subset
 * of the format this template uses, so the scripts and Compose agree on every value they read.
 *
 * The parsing is `parseEnvValues` from `@spy4x/server/env-age64`: first `=`, whole-line `#`
 * comments and blank lines skipped, `export` prefix allowed, and Compose's value rules:
 *
 * - `KEY=value # note`: an unquoted value ends before ` #` (a space, then `#`). A `#` after
 *   anything else stays in the value: `KEY=abc#def` is `abc#def`, `KEY= # note` is `# note`.
 * - `KEY="value"` and `KEY='value'`, optionally followed by whitespace and a `# note`: the quotes
 *   are removed and the value is taken as written.
 *
 * Not supported, unlike Compose: escape sequences such as `\n` inside double quotes (kept as
 * written), `${VAR}` expansion (kept as written), and values spread over several lines. A quoted
 * value followed by anything but a comment, or a quote left open, fails with the file and line.
 *
 * @module
 */

import { parseEnvValues } from "@spy4x/server/env-age64"

export { parseEnvValues }

/** Raised when a variable a script needs is missing or blank. Never carries a value. */
export class MissingEnvVarError extends Error {
  constructor(name: string, path: string) {
    super(`${name} must be set in ${path}`)
    this.name = "MissingEnvVarError"
  }
}

/** Reads and parses the env file at `path`. */
export async function readEnvFile(path: string): Promise<Record<string, string>> {
  return parseEnvValues(await Deno.readTextFile(path), path)
}

/**
 * Returns `values[name]`, or throws {@link MissingEnvVarError} when it is missing or blank.
 * `path` only names the file in the error.
 */
export function requireEnvVar(values: Record<string, string>, name: string, path: string): string {
  const value = values[name]
  if (value === undefined || value === "") throw new MissingEnvVarError(name, path)
  return value
}
