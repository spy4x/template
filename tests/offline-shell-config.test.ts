/// <reference lib="deno.ns" />
/**
 * The app reads `/config.json` before it renders, so the service worker must store it with the
 * app shell and answer from that copy when the network fails: otherwise the app cannot start
 * offline. These tests run `apps/spa/public/offline-shell.js` against a fake worker scope.
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"

const SOURCE = fromFileUrl(new URL("../apps/spa/public/offline-shell.js", import.meta.url))

type Handler = (event: Record<string, unknown>) => void

/** Loads the worker file with fakes for its globals and returns what it registered. */
async function loadWorker(network: (path: string) => Response | Error) {
  const stored = new Map<string, Response>()
  const handlers = new Map<string, Handler>()
  const key = (input: string | Request) =>
    new URL(String(typeof input === "string" ? input : input.url), "https://app.example").pathname
  const cache = {
    put: (input: string | Request, response: Response) => {
      stored.set(key(input), response)
      return Promise.resolve()
    },
    add: async (input: string | Request) => {
      const result = network(key(input))
      if (result instanceof Error) throw result
      stored.set(key(input), result)
    },
    match: (input: string | Request) => Promise.resolve(stored.get(key(input))?.clone()),
  }
  const fakeFetch = (input: string | Request) => {
    const result = network(key(input))
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
  }
  const scope = {
    location: { origin: "https://app.example" },
    navigator: { onLine: false },
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
  }
  const run = new Function(
    "self",
    "caches",
    "fetch",
    await Deno.readTextFile(SOURCE),
  )
  run(scope, { open: () => Promise.resolve(cache), keys: () => Promise.resolve([]) }, fakeFetch)
  return { stored, handlers }
}

Deno.test("the worker stores /config.json with the page when it installs", async () => {
  const { stored, handlers } = await loadWorker((path) =>
    path === "/"
      ? new Response(`<script src="/assets/a.js"></script>`)
      : new Response(`{"env":"prod"}`)
  )
  let waiting: Promise<unknown> = Promise.resolve()
  handlers.get("install")!({ waitUntil: (p: Promise<unknown>) => (waiting = p) })
  await waiting

  expect(await stored.get("/config.json")?.text()).toBe(`{"env":"prod"}`)
})

Deno.test("the worker answers /config.json from its copy when the network fails", async () => {
  let online = true
  const { handlers } = await loadWorker((path) =>
    online ? new Response(`{"env":"prod"}`) : new Error(`offline ${path}`)
  )
  const ask = async () => {
    let answer: Promise<Response> | undefined
    handlers.get("fetch")!({
      request: new Request("https://app.example/config.json"),
      respondWith: (p: Promise<Response>) => (answer = p),
      waitUntil: (p: Promise<unknown>) => p,
    })
    if (!answer) throw new Error("the worker did not answer")
    return await answer
  }

  await (await ask()).text()
  await new Promise((resolve) => setTimeout(resolve, 0))
  online = false

  expect(await (await ask()).text()).toBe(`{"env":"prod"}`)
})
