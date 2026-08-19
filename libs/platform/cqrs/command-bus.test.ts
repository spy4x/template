import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { CommandBus } from "./command-bus.ts"
import type { Command } from "./types.ts"

class PingCommand implements Command<{ value: string }, { value: string }> {
  __resultType?: { value: string }
  constructor(public data: { value: string }) {}
}

describe("command-bus", () => {
  it("executes registered handler", async () => {
    const bus = new CommandBus()
    bus.register(PingCommand, async (command) => ({ value: `pong:${command.data.value}` }))

    const result = await bus.execute(new PingCommand({ value: "hi" }))

    expect(result).toEqual({ value: "pong:hi" })
  })

  it("throws when handler missing", async () => {
    const bus = new CommandBus()

    let error: Error | null = null
    try {
      await bus.execute(new PingCommand({ value: "hi" }))
    } catch (err) {
      error = err as Error
    }

    expect(error?.message).toBe("No handler registered for command: PingCommand")
  })

  it("lists registered commands", () => {
    const bus = new CommandBus()
    bus.register(PingCommand, async (command) => ({ value: command.data.value }))

    expect(bus.getRegisteredCommands()).toEqual(["PingCommand"])
  })
})

describe("CommandBus middleware", () => {
  class Ping implements Command<{ value: string }, string> {
    __resultType?: string
    constructor(public data: { value: string }) {}
  }

  it("runs middlewares outermost first and reaches the handler", async () => {
    const order: string[] = []
    const bus = new CommandBus()
    bus.use(async (_m, next) => {
      order.push("first:before")
      const result = await next()
      order.push("first:after")
      return result
    })
    bus.use(async (_m, next) => {
      order.push("second:before")
      const result = await next()
      order.push("second:after")
      return result
    })
    bus.register(Ping, (command) => {
      order.push("handler")
      return Promise.resolve(command.data.value)
    })

    expect(await bus.execute(new Ping({ value: "pong" }))).toBe("pong")
    expect(order).toEqual([
      "first:before",
      "second:before",
      "handler",
      "second:after",
      "first:after",
    ])
  })

  it("lets a middleware short-circuit before the handler", async () => {
    let handled = false
    const bus = new CommandBus()
    bus.use(() => Promise.reject(new Error("blocked")))
    bus.register(Ping, () => {
      handled = true
      return Promise.resolve("unreachable")
    })

    await expect(bus.execute(new Ping({ value: "x" }))).rejects.toThrow("blocked")
    expect(handled).toBe(false)
  })

  it("rejects a middleware that calls next() twice", async () => {
    const bus = new CommandBus()
    bus.use(async (_m, next) => {
      await next()
      return await next()
    })
    bus.register(Ping, () => Promise.resolve("ok"))

    await expect(bus.execute(new Ping({ value: "x" }))).rejects.toThrow("more than once")
  })

  it("dispatches straight to the handler when no middleware is registered", async () => {
    const bus = new CommandBus()
    bus.register(Ping, (command) => Promise.resolve(command.data.value))
    expect(await bus.execute(new Ping({ value: "direct" }))).toBe("direct")
  })
})
