/// <reference lib="deno.ns" />
/**
 * Keeps every REST request of the SPA bound to the user the page was started for (ADR 003). The
 * SPA has one REST function, `apiFetch` in `apps/spa/src/state/api.ts`. It sends every `GET`
 * through `apiRead` and every other method through `apiWrite`; both name the user and sign the
 * page out when the server answers that the cookie is another user's. A store that must read the
 * answer itself uses `fetchRead` and `fetchWrite`, which follow the same rule. A store or view
 * that reaches an `/api` route any other way (the library's `apiFetch`, or the browser's `fetch`)
 * skips both, so it fails this test.
 */

import { expect } from "@std/expect"
import { walk } from "@std/fs/walk"
import { fromFileUrl, relative } from "@std/path"

const ROOT = fromFileUrl(new URL("../", import.meta.url))
const SPA_SOURCE = "apps/spa/src/"
const LIBRARY = "@spy4x/platform/api"
/** The two files that are the one way: the wrapper, and the read it sends a `GET` through. */
const THE_ONE_WAY = ["apps/spa/src/state/api.ts", "apps/spa/src/state/realtime-call.ts"]
/**
 * The one file that may call the browser's `fetch`: the newsletter's routes are public and have no
 * session, so there is no user to name.
 */
const PUBLIC = ["apps/spa/src/state/subscribers.ts"]

/** Whether `source` imports a value, not only types, from the library's REST module. */
function importsTheLibraryFunction(source: string): boolean {
  const imports = source.matchAll(
    /\b(?:import|export)\s+(type\s+)?[^;"'`]*?\bfrom\s*["'`]([^"'`]+)["'`]/g,
  )
  return [...imports].some((match) => match[2] === LIBRARY && match[1] === undefined) ||
    /\bimport\s*\(\s*["'`]@spy4x\/platform\/api["'`]/.test(source)
}

/** The argument text of every call of the browser's own `fetch` in `source`. */
function browserFetchCalls(source: string): string[] {
  const calls: string[] = []
  for (const match of source.matchAll(/(?<![\w.$])(?:globalThis\.|window\.|self\.)?fetch\(/g)) {
    let depth = 1
    let end = match.index + match[0].length
    while (end < source.length && depth > 0) {
      if (source[end] === "(") depth++
      if (source[end] === ")") depth--
      end++
    }
    calls.push(source.slice(match.index + match[0].length, end - 1))
  }
  return calls
}

/** SPA source files, tests left out, with their text. */
async function spaSources(): Promise<[string, string][]> {
  const sources: [string, string][] = []
  const entries = walk(`${ROOT}${SPA_SOURCE}`, {
    includeDirs: false,
    exts: [".ts", ".tsx"],
    skip: [/\.test\.tsx?$/],
  })
  for await (const entry of entries) {
    sources.push([relative(ROOT, entry.path), await Deno.readTextFile(entry.path)])
  }
  return sources.sort(([a], [b]) => a.localeCompare(b))
}

Deno.test("only the SPA's one REST function uses the library's apiFetch", async () => {
  const users = (await spaSources())
    .filter(([, source]) => importsTheLibraryFunction(source))
    .map(([file]) => file)
  // Both must be found: an empty walk, or a moved wrapper, would otherwise pass silently.
  expect(users).toEqual(THE_ONE_WAY)
})

Deno.test("the SPA's one REST function sends a read through apiRead and every other method through apiWrite", async () => {
  const wrapper = await Deno.readTextFile(`${ROOT}${THE_ONE_WAY[0]}`)
  expect(wrapper).toMatch(
    /===\s*"GET"\s*\?\s*apiRead<T>\(path, init\)\s*:\s*apiWrite<T>\(path, init\)/,
  )
})

/** A file whose `fetch` is its own parameter, the SPA's one REST function unless a test passes another. */
const SHADOWS_FETCH = /\bfetch\s*:\s*\w+\s*=\s*apiFetch\b/

Deno.test("no SPA file but the public newsletter's calls the browser's fetch", async () => {
  const callers = new Set<string>()
  for (const [file, source] of await spaSources()) {
    if (SHADOWS_FETCH.test(source)) continue
    for (const call of browserFetchCalls(source)) {
      // `fetch()` with no arguments is a method of a store's own port, not the browser's.
      if (call.trim() !== "") callers.add(file)
    }
  }
  // The newsletter's call must be found: it proves the scan sees a call of `fetch`.
  expect([...callers]).toEqual(PUBLIC)
})

/** A call of `fetchRead`, which signs the page out on any 401. */
const BOUND_READ = /\bfetchRead\s*\(/g
/** The same call as the `GET` side of a split whose other side is `fetchWrite`. */
const SPLIT_BY_METHOD =
  /===\s*"GET"\s*\?\s*(?:await\s+)?fetchRead\([^)]*\)\s*:\s*(?:await\s+)?fetchWrite\(/g
/** The stores that send a request and read the answer themselves: invitations, and the transfer. */
const OWN_SENDERS = ["apps/spa/src/state/invitations.ts", "apps/spa/src/state/members.ts"]

Deno.test("a store that sends its own requests sends a write through fetchWrite, never fetchRead", async () => {
  const senders = (await spaSources()).filter(([file, source]) =>
    !THE_ONE_WAY.includes(file) && /\bfetch(?:Read|Write)\s*\(/.test(source)
  )
  // Both must be found, or the loop below proves nothing.
  expect(senders.map(([file]) => file)).toEqual(OWN_SENDERS)
  for (const [file, source] of senders) {
    // A write sent through `fetchRead` would sign a person out for a wrong password, so every
    // call of it is the `GET` side of a split by method.
    const reads = source.match(BOUND_READ)?.length ?? 0
    const splits = source.match(SPLIT_BY_METHOD)?.length ?? 0
    expect([file, reads]).toEqual([file, splits])
  }
  expect(senders[0][1]).toMatch(SPLIT_BY_METHOD)
})
