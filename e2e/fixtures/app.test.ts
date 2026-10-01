/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import type { ConsoleMessage, Locator, Page, Request } from "@playwright/test"
import { gotoApp } from "./app.ts"

type Outcome =
  | "boots"
  | "stays blank"
  | "blank after network change"
  | "blank after a network change of another origin"

const APP = "http://app.localhost:8080"
type Handler = (arg: never) => void

const failedRequest = (url: string, errorText: string) =>
  ({ url: () => url, failure: () => ({ errorText }) }) as unknown as Request

/**
 * A page whose n-th load ends as `outcomes[n]`, and that records what the helper does to it. A load
 * starts with `page.goto` or with `click`, which stands for a click after which the app loads `url`
 * itself; `starts` lists which one began each load.
 */
function fakePage(outcomes: Outcome[]) {
  const handlers = new Map<string, Set<Handler>>()
  const emit = (event: string, arg: unknown) => {
    for (const handler of handlers.get(event) ?? []) (handler as (arg: unknown) => void)(arg)
  }
  const starts: string[] = []
  const load = (start: string, url: string) => {
    starts.push(start)
    emit("request", { isNavigationRequest: () => true, url: () => `${APP}${url}` })
    const outcome = outcomes[starts.length - 1]
    if (outcome === "blank after network change") {
      emit("requestfailed", failedRequest(`${APP}/src/main.tsx`, "net::ERR_NETWORK_CHANGED"))
    } else if (outcome === "blank after a network change of another origin") {
      emit(
        "requestfailed",
        failedRequest("https://fonts.example/a.css", "net::ERR_NETWORK_CHANGED"),
      )
    } else if (outcome === "stays blank") {
      emit("requestfailed", failedRequest(`${APP}/src/app.tsx`, "net::ERR_CONNECTION_REFUSED"))
      emit("console", { type: () => "error", text: () => "boom in the module" } as ConsoleMessage)
    }
    return Promise.resolve()
  }
  const page = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, (handlers.get(event) ?? new Set()).add(handler))
    },
    off: (event: string, handler: Handler) => handlers.get(event)?.delete(handler),
    goto: (url: string) => load("goto", url),
  }
  const ready = {
    waitFor: () =>
      outcomes[starts.length - 1] === "boots"
        ? Promise.resolve()
        : Promise.reject(new Error("Timeout 10000ms exceeded")),
  }
  return {
    page: page as unknown as Page,
    ready: ready as unknown as Locator,
    click: (url: string) => load("click", url),
    starts: () => starts,
    loads: () => starts.length,
    listeners: () => [...handlers.values()].reduce((sum, set) => sum + set.size, 0),
  }
}

Deno.test("gotoApp loads the page again when a network change broke the first load", async () => {
  const fake = fakePage(["blank after network change", "boots"])
  await gotoApp(fake.page, "/sign-in", fake.ready)
  expect(fake.loads()).toBe(2)
})

Deno.test("gotoApp throws without a second load when the page stays blank for another reason", async () => {
  const fake = fakePage(["stays blank", "boots"])
  await expect(gotoApp(fake.page, "/sign-in", fake.ready)).rejects.toThrow("Timeout")
  expect(fake.loads()).toBe(1)
})

Deno.test("gotoApp opens the url itself after a network change broke the load a click started", async () => {
  const fake = fakePage(["blank after network change", "boots"])
  await gotoApp(fake.page, "/", fake.ready, () => fake.click("/"))
  expect(fake.starts()).toEqual(["click", "goto"])
})

Deno.test("gotoApp does not load again for a network change of a request to another origin", async () => {
  const fake = fakePage(["blank after a network change of another origin", "boots"])
  await expect(gotoApp(fake.page, "/sign-in", fake.ready)).rejects.toThrow("Timeout")
  expect(fake.loads()).toBe(1)
})

Deno.test("gotoApp gives up after three loads that a network change broke", async () => {
  const fake = fakePage(Array(5).fill("blank after network change"))
  await expect(gotoApp(fake.page, "/sign-in", fake.ready)).rejects.toThrow("Timeout")
  expect(fake.loads()).toBe(3)
})

Deno.test("gotoApp names the failed requests and the console in the error it throws", async () => {
  const fake = fakePage(["stays blank"])
  const error = await gotoApp(fake.page, "/sign-in", fake.ready).catch((e: Error) => e)
  expect((error as Error).message).toContain(`${APP}/src/app.tsx net::ERR_CONNECTION_REFUSED`)
  expect((error as Error).message).toContain("error: boom in the module")
})

Deno.test("gotoApp stops listening when it returns", async () => {
  const fake = fakePage(["boots"])
  await gotoApp(fake.page, "/sign-in", fake.ready)
  expect(fake.listeners()).toBe(0)
})
