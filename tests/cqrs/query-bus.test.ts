import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { QueryBus } from "../../libs/platform/cqrs/query-bus.ts"
import type { Query } from "../../libs/platform/cqrs/types.ts"

class PingQuery implements Query<{ value: string }, { value: string }> {
  __resultType?: { value: string }
  constructor(public data: { value: string }) {}
}

describe("query-bus", () => {
  it("executes registered handler", async () => {
    const bus = new QueryBus()
    bus.register(PingQuery, async (query) => ({ value: `pong:${query.data.value}` }))

    const result = await bus.execute(new PingQuery({ value: "hi" }))

    expect(result).toEqual({ value: "pong:hi" })
  })

  it("throws when handler missing", async () => {
    const bus = new QueryBus()

    let error: Error | null = null
    try {
      await bus.execute(new PingQuery({ value: "hi" }))
    } catch (err) {
      error = err as Error
    }

    expect(error?.message).toBe("No handler registered for query: PingQuery")
  })

  it("lists registered queries", () => {
    const bus = new QueryBus()
    bus.register(PingQuery, async (query) => ({ value: query.data.value }))

    expect(bus.getRegisteredQueries()).toEqual(["PingQuery"])
  })
})
