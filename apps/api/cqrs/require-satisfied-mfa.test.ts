import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { CommandBus } from "@platform/cqrs/command-bus.ts"
import type { Command } from "@platform/cqrs/types.ts"
import { AccessError, type Actor, SessionMFAStatus, UserMFAStatus } from "@domain/identity"
import { requireSatisfiedMfa } from "./require-satisfied-mfa.ts"

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: 1,
    userMfa: UserMFAStatus.NOT_CONFIGURED,
    sessionMfa: SessionMFAStatus.NOT_REQUIRED,
    ...overrides,
  }
}

class ActorScopedCommand implements Command<{ actor: Actor }, string> {
  __resultType?: string
  constructor(public data: { actor: Actor }) {}
}

class SystemCommand implements Command<{ reason: string }, string> {
  __resultType?: string
  constructor(public data: { reason: string }) {}
}

function busWithGate(onHandled: () => void) {
  const bus = new CommandBus()
  bus.use(requireSatisfiedMfa)
  bus.register(ActorScopedCommand, () => {
    onHandled()
    return Promise.resolve("handled")
  })
  bus.register(SystemCommand, () => {
    onHandled()
    return Promise.resolve("handled")
  })
  return bus
}

describe("requireSatisfiedMfa", () => {
  it("lets a satisfied session reach the handler", async () => {
    let handled = false
    const bus = busWithGate(() => handled = true)

    const result = await bus.execute(new ActorScopedCommand({ actor: actor() }))

    expect(result).toBe("handled")
    expect(handled).toBe(true)
  })

  it("stops an unsatisfied session before the handler runs", async () => {
    let handled = false
    const bus = busWithGate(() => handled = true)
    const command = new ActorScopedCommand({
      actor: actor({
        userMfa: UserMFAStatus.CONFIGURED,
        sessionMfa: SessionMFAStatus.NOT_PASSED_YET,
      }),
    })

    await expect(bus.execute(command)).rejects.toThrow(AccessError)
    // The point of running in the pipeline: no handler can be reached past it.
    expect(handled).toBe(false)
  })

  it("passes system messages that carry no actor", async () => {
    let handled = false
    const bus = busWithGate(() => handled = true)

    expect(await bus.execute(new SystemCommand({ reason: "outbox drain" }))).toBe("handled")
    expect(handled).toBe(true)
  })
})
