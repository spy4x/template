/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import type { Locator, Page, Request } from "@playwright/test"
import { gotoApp } from "./app.ts"

type Outcome = "boots" | "stays blank" | "blank after network change"

/** A page whose n-th load ends as `outcomes[n]`, and that records what the helper does to it. */
function fakePage(outcomes: Outcome[]) {
  const handlers = new Set<(request: Request) => void>()
  let loads = 0
  const page = {
    on: (_event: string, handler: (request: Request) => void) => handlers.add(handler),
    off: (_event: string, handler: (request: Request) => void) => handlers.delete(handler),
    goto: () => {
      loads++
      if (outcomes[loads - 1] === "blank after network change") {
        for (const handler of handlers) {
          handler({ failure: () => ({ errorText: "net::ERR_NETWORK_CHANGED" }) } as Request)
        }
      }
      return Promise.resolve()
    },
  }
  const ready = {
    waitFor: () =>
      outcomes[loads - 1] === "boots"
        ? Promise.resolve()
        : Promise.reject(new Error("Timeout 10000ms exceeded")),
  }
  return {
    page: page as unknown as Page,
    ready: ready as unknown as Locator,
    loads: () => loads,
    listeners: () => handlers.size,
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

Deno.test("gotoApp gives up after three loads that a network change broke", async () => {
  const fake = fakePage(Array(5).fill("blank after network change"))
  await expect(gotoApp(fake.page, "/sign-in", fake.ready)).rejects.toThrow("Timeout")
  expect(fake.loads()).toBe(3)
})

Deno.test("gotoApp stops listening for failed requests when it returns", async () => {
  const fake = fakePage(["boots"])
  await gotoApp(fake.page, "/sign-in", fake.ready)
  expect(fake.listeners()).toBe(0)
})
