/// <reference lib="deno.ns" />
/**
 * Reads `infra/envs/.env*` files the way Docker Compose's `--env-file` reads them, for the subset
 * of the format this template uses, so the scripts and Compose agree on every value they read.
 *
 * Lines are split by `parseEnvFile` from `@spy4x/server/env-age64` (first `=`, whole-line `#`
 * comments and blank lines skipped, `export` prefix allowed). That parser keeps a value's raw text,
 * so Compose's value rules are added here. Supported, and read as Compose reads it:
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

import { parseEnvFile, UnsupportedEnvSyntaxError } from "@spy4x/server/env-age64"

/** Raised when a variable a script needs is missing or blank. Never carries a value. */
export class MissingEnvVarError extends Error {
  constructor(name: string, path: string) {
    super(`${name} must be set in ${path}`)
    this.name = "MissingEnvVarError"
  }
}

/** A quoted value followed by whitespace and a comment, which `parseEnvFile` refuses. */
const QUOTED_WITH_COMMENT = /^(\s*[^#=\s][^=]*=\s*)(["'])((?:(?!\2).)*)\2\s+#.*$/

/**
 * Parses env-file content into `{ KEY: value }`. A later line wins over an earlier one.
 *
 * @throws {UnsupportedEnvSyntaxError} On a line outside the supported subset, naming `path`.
 */
export function parseEnvValues(content: string, path = "env file"): Record<string, string> {
  // Compose ignores a comment after a closing quote; dropping it here keeps every line number.
  const lines = content.split("\n").map((line) => line.replace(QUOTED_WITH_COMMENT, "$1$2$3$2"))
  let entries
  try {
    entries = parseEnvFile(lines.join("\n"), path)
  } catch (error) {
    if (error instanceof UnsupportedEnvSyntaxError) {
      error.message = `${path}: ${error.message}. Supported: KEY=value, KEY="value" or ` +
        `KEY='value', each optionally followed by " # comment"`
    }
    throw error
  }
  const values: Record<string, string> = {}
  for (const entry of entries) {
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
  const comment = value.indexOf(" #")
  return comment === -1 ? value : value.slice(0, comment).trimEnd()
}
