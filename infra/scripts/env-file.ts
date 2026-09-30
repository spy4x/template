/// <reference lib="deno.ns" />
/**
 * Reads `infra/envs/.env*` files the way Docker Compose's `--env-file` reads them, so the scripts
 * and Compose agree on every value.
 *
 * Lines are split by `parseEnvFile` from `@spy4x/server/env-age64` (first `=`, comments and blank
 * lines skipped, `export` prefix allowed). That parser keeps a value's raw text, so the value rules
 * Compose applies are added here: an unquoted value ends before ` #` (whitespace, then `#`), and
 * a value wrapped in matching quotes loses them. A `#` with no whitespace before it stays part of
 * the value, as in Compose, so a password or URL fragment containing `#` is kept whole.
 *
 * @module
 */

import { parseEnvFile } from "@spy4x/server/env-age64"

/** Raised when a variable a script needs is missing or blank. Never carries a value. */
export class MissingEnvVarError extends Error {
  constructor(name: string, path: string) {
    super(`${name} must be set in ${path}`)
    this.name = "MissingEnvVarError"
  }
}

/** Parses env-file content into `{ KEY: value }`. A later line wins over an earlier one. */
export function parseEnvValues(content: string, path?: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const entry of parseEnvFile(content, path)) {
    if (entry.assignment) values[entry.assignment.key] = decodeValue(entry.assignment.value)
  }
  return values
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

/** Applies Compose's value rules to the raw text after `=`. */
function decodeValue(raw: string): string {
  const value = raw.trim()
  const quote = value[0]
  if ((quote === `"` || quote === `'`) && value.length >= 2 && value.endsWith(quote)) {
    return value.slice(1, -1)
  }
  if (value.startsWith("#") && /^\s/.test(raw)) return ""
  const comment = value.search(/\s#/)
  return comment === -1 ? value : value.slice(0, comment).trimEnd()
}
