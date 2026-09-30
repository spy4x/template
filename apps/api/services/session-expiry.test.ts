import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { FakeTime } from "@std/testing/time"
import { startSessionExpiry } from "./session-expiry.ts"

const HOUR = 3_600_000

describe("startSessionExpiry", () => {
  it("logs a failed run, survives it and runs again on the next tick", async () => {
    using time = new FakeTime()
    const logged: unknown[][] = []
    let runs = 0
    const stop = startSessionExpiry({
      expireSessions: () => {
        runs++
        return runs === 1 ? Promise.reject(new Error(`connect ECONNREFUSED`)) : Promise.resolve()
      },
      log: (...data) => logged.push(data),
      intervalMs: HOUR,
    })

    await time.tickAsync(HOUR)
    expect(runs).toBe(1)
    expect(logged.length).toBe(1)
    expect(String(logged[0].at(-1))).toContain(`ECONNREFUSED`)

    await time.tickAsync(HOUR)
    expect(runs).toBe(2)
    expect(logged.length).toBe(1)
    stop()
  })

  it("stops running once the returned function is called", async () => {
    using time = new FakeTime()
    let runs = 0
    const stop = startSessionExpiry({
      expireSessions: () => (runs++, Promise.resolve()),
      log: () => {},
      intervalMs: HOUR,
    })

    stop()
    await time.tickAsync(HOUR * 3)

    expect(runs).toBe(0)
  })
})
