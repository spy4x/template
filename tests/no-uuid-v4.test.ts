/// <reference lib="deno.ns" />
/**
 * Nothing in this repository creates a UUID version 4 (docs/ids.md). An id is `uuidV7()` from
 * `@spy4x/platform/universal/uuid`, whatever it names. A secret, a value that alone lets its holder
 * in, is not converted by whoever finds it: the owner decides what it becomes.
 *
 * This test reads every text file of the repository (code, SQL, shell, HTML, configuration and
 * documents) and fails on a call that makes a version 4 id, on a pattern that accepts only version
 * 4, and on a document that shows either. The CI image has no git, so the files are found by
 * walking the tree and leaving out what `.gitignore` leaves out.
 */

import { expect } from "@std/expect"
import { walk } from "@std/fs/walk"
import { fromFileUrl, relative } from "@std/path"

const ROOT = fromFileUrl(new URL("../", import.meta.url))

/**
 * What makes a version 4 id: the Web Crypto call, the two Postgres functions, and the npm and
 * `@std/uuid` helpers under their usual names (`uuidv4()`, `v4()`, `v4 as name`, a `uuid/v4`
 * path). And what accepts only version 4: this repository's former `UUID_V4` and `isUuidV4`, and
 * a hand-written pattern whose third group must start with `4`.
 */
const FORBIDDEN =
  /randomUUID|gen_random_uuid|uuid_generate_v4|uuidv4\s*\(|uuid\/v4|\bv4\s*\(|\bv4\s+as\b|UUID_V4|isUuidV4|-4\[[^\]\n]+\]\{3\}/gi

/**
 * The only files that may hold them, each by its exact path: a new migration is checked like any
 * other file. The two migrations are history, applied on every database; the third is this test.
 */
export const ALLOWED: ReadonlySet<string> = new Set([
  "libs/server/db/migrations/2026_08_18_0002_personal_group_backfill.sql",
  "libs/server/db/migrations/2026_10_03_0001_idempotency_claim_token.sql",
  "tests/no-uuid-v4.test.ts",
])

/**
 * Single lines that still make a version 4 value, each by its file and its exact text. Each value
 * is a secret, not an id, and waits on the owner's decision (docs/ids.md); any other line of the
 * same file is checked like every other file.
 */
export const PENDING: ReadonlyMap<string, string> = new Map([
  // Signs the seed script's session cookies. Waits on the owner's decision.
  ["infra/scripts/seed-data.ts", "cookieSecret: crypto.randomUUID() + crypto.randomUUID(),"],
  // Webhook secret of a process that takes no webhooks. Waits on the owner's decision.
  ["libs/server/billing/setup.ts", ": `whsec_unused_${crypto.randomUUID()}`,"],
])

/** File types that hold code, SQL, scripts, configuration or documents a reader could copy from. */
const SCANNED =
  /(\.(ts|tsx|js|mjs|sql|md|json|jsonc|ya?ml|sh|html|css|txt|conf|example|dev|prod|base)|[\\/]dockerfile)$/i

/** Directories git does not track here: dependencies, build output, reports and git's own. */
const SKIPPED =
  /[\\/](\.git|node_modules|build|dist|\.vite|_fresh|package|\.volumes|results|report|playwright-report|\.age|\.vs|\.idea)[\\/]/

/** `path:line: match` for every forbidden name in `text`, leaving out the file's pending line. */
export function findUuidV4(path: string, text: string): string[] {
  const lines = text.split("\n")
  const pending = PENDING.get(path)
  // Only the first line with that text is let through: a copy of it further down is a finding.
  const skipped = pending === undefined ? -1 : lines.findIndex((line) => line.trim() === pending)
  return lines.flatMap((line, index) =>
    index === skipped
      ? []
      : [...line.matchAll(FORBIDDEN)].map((match) => `${path}:${index + 1}: ${match[0]}`)
  )
}

/** The findings in `files` (path and text), leaving out the files allowed by exact path. */
export function offendersIn(files: Iterable<readonly [path: string, text: string]>): string[] {
  const found: string[] = []
  for (const [path, text] of files) {
    if (!ALLOWED.has(path)) found.push(...findUuidV4(path, text))
  }
  return found
}

Deno.test("no file of the repository creates, accepts only or documents a UUID version 4", async () => {
  const files: [string, string][] = []
  const entries = walk(ROOT, { includeDirs: false, match: [SCANNED], skip: [SKIPPED] })
  for await (const entry of entries) {
    // An env file can hold secrets and is not tracked; its example is.
    if (/[\\/]\.env/.test(entry.path) && !entry.path.endsWith(".example")) continue
    const path = relative(ROOT, entry.path).replaceAll("\\", "/")
    files.push([path, await Deno.readTextFile(entry.path)])
  }
  const seen = new Set(files.map(([path]) => path))
  // A wrong root or a too-greedy skip must not pass by reading less: about 670 text files are
  // tracked today, among them SQL, Markdown, shell and HTML, and every allowed file was walked.
  expect(files.length).toBeGreaterThan(600)
  for (const kind of [".sql", ".md", ".sh", ".html", ".tsx", ".yml"]) {
    expect(files.some(([path]) => path.endsWith(kind))).toBe(true)
  }
  for (const path of ALLOWED) {
    expect(seen.has(path)).toBe(true)
    // An allowed file that no longer names a version 4 id leaves the list.
    const text = files.find(([file]) => file === path)![1]
    expect(findUuidV4(path, text).length).toBeGreaterThan(0)
  }
  for (const [path, line] of PENDING) {
    // A pending line that was decided and changed leaves the list.
    const text = files.find(([file]) => file === path)?.[1] ?? ""
    expect([path, text.split("\n").some((candidate) => candidate.trim() === line)]).toEqual([
      path,
      true,
    ])
  }

  // On a failure: use uuidV7() from @spy4x/platform/universal/uuid for an id. A secret stays as
  // it is and goes to the owner (docs/ids.md).
  expect(offendersIn(files)).toEqual([])
})

Deno.test("the UUID version 4 guard sees each way of making one", () => {
  const samples = [
    "const id = crypto.randomUUID()",
    "const { randomUUID } = crypto",
    "SELECT gen_random_uuid(), name FROM users",
    "id UUID DEFAULT GEN_RANDOM_UUID()",
    "SELECT uuid_generate_v4()",
    "const id = uuidv4()",
    "const id = uuidV4 ()",
    "const id = v4()",
    `import { generate } from "@std/uuid/v4"`,
    `import { v4 as makeId } from "npm:uuid"`,
  ]
  for (const sample of samples) {
    expect([sample, findUuidV4("sample.ts", sample).length]).toEqual([sample, 1])
  }
  expect(findUuidV4("a.ts", "one\ntwo crypto.randomUUID()")).toEqual(["a.ts:2: randomUUID"])
})

Deno.test("the UUID version 4 guard sees a validator that accepts only version 4", () => {
  const samples = [
    "export const UUID_V4 = /x/",
    "if (!isUuidV4(value)) return",
    "groupId: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/",
    "/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-4[0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$/",
  ]
  for (const sample of samples) {
    expect([sample, findUuidV4("sample.ts", sample).length]).toEqual([sample, 1])
  }
})

Deno.test("the UUID version 4 guard names the file and line of a finding in SQL, Markdown, shell and HTML", () => {
  const files = [
    ["libs/server/db/schema.sql", "id UUID DEFAULT gen_random_uuid()"],
    ["docs/ids.md", "Call `crypto.randomUUID()` for a new id."],
    ["infra/scripts/make-id.sh", `ID=$(psql -c "SELECT uuid_generate_v4()")`],
    ["apps/spa/index.html", "<script>window.id = crypto.randomUUID()</script>"],
  ] as const
  expect(offendersIn(files)).toEqual([
    "libs/server/db/schema.sql:1: gen_random_uuid",
    "docs/ids.md:1: randomUUID",
    "infra/scripts/make-id.sh:1: uuid_generate_v4",
    "apps/spa/index.html:1: randomUUID",
  ])
})

Deno.test("the UUID version 4 guard checks a new migration and lets the two old ones stand", () => {
  const sql = "ALTER TABLE notes ALTER COLUMN id SET DEFAULT gen_random_uuid();"
  const next = "libs/server/db/migrations/2026_11_01_0001_notes_default.sql"
  const old = "libs/server/db/migrations/2026_10_03_0001_idempotency_claim_token.sql"
  expect(offendersIn([[next, sql], [old, sql]])).toEqual([`${next}:1: gen_random_uuid`])
  // No entry allows a directory.
  for (const path of ALLOWED) expect(path).toMatch(/\.(sql|ts)$/)
})

Deno.test("the UUID version 4 guard lets a secret that waits on the owner through on its one line only", () => {
  const path = "infra/scripts/seed-data.ts"
  const line = `    ${PENDING.get(path)}`
  expect(findUuidV4(path, `const a = 1\n${line}`)).toEqual([])
  // Another call in the same file, a second copy of the line, and the line in another file.
  expect(findUuidV4(path, `${line}\nconst id = crypto.randomUUID()`)).toEqual([
    `${path}:2: randomUUID`,
  ])
  expect(findUuidV4(path, `${line}\n${line}`)).toEqual([
    `${path}:2: randomUUID`,
    `${path}:2: randomUUID`,
  ])
  expect(findUuidV4("apps/api/+main.ts", line)).toHaveLength(2)
})

Deno.test("the UUID version 4 guard lets version 7 ids, random tokens and any-version patterns through", () => {
  for (
    const sample of [
      "const id = uuidV7()",
      "randomBase64Url()",
      "id uuid PRIMARY KEY",
      "ipv4(address)",
      "isUuid(value, 4)",
      "/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/",
      "/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/",
    ]
  ) {
    expect([sample, findUuidV4("sample.ts", sample)]).toEqual([sample, []])
  }
})
