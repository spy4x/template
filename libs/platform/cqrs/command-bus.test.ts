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
