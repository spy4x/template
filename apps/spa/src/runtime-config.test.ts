import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { loadRuntimeConfig } from "./runtime-config.ts"
import { startErrorReporting } from "./error-reporting.ts"

function serving(body: string, status = 200): { fetcher: typeof fetch; urls: string[] } {
  const urls: string[] = []
  const fetcher = ((url: string) => {
    urls.push(url)
    return Promise.resolve(new Response(body, { status }))
  }) as unknown as typeof fetch
  return { fetcher, urls }
}

/** Keeps the warning a fallback logs out of the test output. */
async function quietly<T>(run: () => Promise<T>): Promise<T> {
  const original = console.warn
  console.warn = () => {}
  try {
    return await run()
  } finally {
    console.warn = original
  }
}

describe("the SPA's runtime configuration", () => {
  it("reads the environment label and the DSN from /config.json", async () => {
    const { fetcher, urls } = serving(
      `{"env":"stag","errorReportDsn":"https://k@tracker.example/1"}`,
    )

    const config = await loadRuntimeConfig(fetcher)

    expect(config).toEqual({ env: "stag", errorReportDsn: "https://k@tracker.example/1" })
    expect(urls).toEqual(["/config.json"])
  })

  it("drops keys the schema does not name", async () => {
    const { fetcher } = serving(`{"env":"prod","secret":"x"}`)

    expect(await loadRuntimeConfig(fetcher)).toEqual({ env: "prod" })
  })

  it("falls back to the defaults for a file of the wrong shape, a bad status or bad JSON", async () => {
    for (const bad of [serving(`{"env":5}`), serving(`{}`, 404), serving(`<html>`)]) {
      expect(await quietly(() => loadRuntimeConfig(bad.fetcher))).toEqual({})
    }
  })

  it("falls back to the defaults when the network fails", async () => {
    const fetcher = (() => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch

    expect(await quietly(() => loadRuntimeConfig(fetcher))).toEqual({})
  })

  it("makes one build report to the tracker its config file names, and to none without one", async () => {
    const sent: string[] = []
    const tracker = ((url: string) => {
      sent.push(url)
      return Promise.resolve(new Response("{}"))
    }) as unknown as typeof fetch
    const files = [
      `{"errorReportDsn":"https://k@one.example/1"}`,
      `{"errorReportDsn":"https://k@two.example/2"}`,
      `{}`,
    ]

    for (const file of files) {
      const config = await loadRuntimeConfig(serving(file).fetcher)
      const target = new EventTarget()
      startErrorReporting(
        { ERROR_REPORT_DSN: config.errorReportDsn, ENV: config.env },
        target,
        () => "https://a.example/",
        tracker,
      )
      target.dispatchEvent(Object.assign(new Event("error"), { error: new Error("boom") }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(sent.length).toBe(2)
    expect(sent[0]).toContain("one.example")
    expect(sent[1]).toContain("two.example")
  })
})
