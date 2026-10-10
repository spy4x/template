import { expect } from "@std/expect"
import { afterEach, describe, it } from "@std/testing/bdd"
import { ConnectionLostError } from "@spy4x/realtime"
import {
  callCommand,
  callQuery,
  configureModules,
  connectionDisplay,
  moduleSwitches,
  recallUser,
  startModules,
  stopChanges,
} from "./modules.ts"

const realFetch = globalThis.fetch
const globals = globalThis as { document?: unknown }

/** The page as the sync runner reads it: visible, with nothing listening. */
function visiblePage(): void {
  globals.document = {
    visibilityState: "visible",
    addEventListener: () => {},
    removeEventListener: () => {},
  }
}

/** Waits for `done`, one macrotask at a time; fails rather than wait for ever. */
async function until(done: () => boolean): Promise<void> {
  for (let turns = 0; !done(); turns++) {
    if (turns > 50) throw new Error("the condition never held")
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

afterEach(() => {
  stopChanges()
  configureModules({})
  globalThis.fetch = realFetch
  delete globals.document
})

describe("the module switches", () => {
  it("run both modules unless the configuration says false, as a boolean or as text", () => {
    configureModules({})
    const byDefault = { ...moduleSwitches() }
    configureModules({ realtime: "false", offline: false })
    const off = { ...moduleSwitches() }
    configureModules({ realtime: true, offline: "true" })

    expect(byDefault).toEqual({ realtime: true, offline: true })
    expect(off).toEqual({ realtime: false, offline: false })
    expect(moduleSwitches()).toEqual({ realtime: true, offline: true })
  })

  it("show the browser's network, not the socket, for a page with no socket", () => {
    const state = { wsStatus: "closed", wsResume: "none" } as const
    const withSocket = connectionDisplay(state)
    configureModules({ realtime: false })

    expect([withSocket, connectionDisplay(state)]).toEqual(["closed", "open"])
  })

  it("recall no user for an offline start while the local data is off", () => {
    configureModules({ offline: false })

    expect(recallUser()).toBeNull()
  })
})

describe("a page with no socket", () => {
  it("runs the pull at the start and the cheap check after its own write, and never opens a socket", async () => {
    visiblePage()
    configureModules({ realtime: false, offline: false })
    const urls: string[] = []
    globalThis.fetch = ((url: string) => {
      urls.push(url)
      return Promise.resolve(Response.json({ result: { created: true } }))
    }) as unknown as typeof fetch
    const checks: boolean[] = []

    startModules(7, {
      pull: () => Promise.reject(new Error("the hints' pull belongs to the socket")),
      check: (full) => Promise.resolve(void checks.push(full)),
    })
    await until(() => checks.length === 1)
    const result = await callCommand("note.create", { title: "A" })
    await until(() => checks.length === 2)

    expect(checks).toEqual([true, false])
    expect(result).toEqual({ created: true })
    expect(urls).toEqual(["/api/call/note.create"])
  })

  it("fails a call as a dropped connection once nobody is signed in", async () => {
    visiblePage()
    configureModules({ realtime: false, offline: false })
    startModules(7, { pull: () => {}, check: () => Promise.resolve() })
    stopChanges()

    await expect(callQuery("group.list", undefined, { attempts: 1 })).rejects.toBeInstanceOf(
      ConnectionLostError,
    )
  })
})
