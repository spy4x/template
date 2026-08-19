import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { CommandBus } from "@platform/cqrs/command-bus.ts"
import type { Command } from "@platform/cqrs/types.ts"
import { AccessError, type Actor, SessionMFAStatus, UserMFAStatus } from "@domain/identity"
import { createSessionGate } from "./session-gate.ts"

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: 1,
    userMfa: UserMFAStatus.NOT_CONFIGURED,
    sessionMfa: SessionMFAStatus.NOT_REQUIRED,
    ...overrides,
  }
}

class GuardedCommand implements Command<{ actor: Actor }, string> {
  __resultType?: string
  constructor(public data: { actor: Actor }) {}
}

class SignInCommand implements Command<{ username: string }, string> {
  __resultType?: string
  constructor(public data: { username: string }) {}
}

/** A user-facing command whose author forgot to pass an actor. */
class MiswiredCommand implements Command<{ note: string }, string> {
  __resultType?: string
  constructor(public data: { note: string }) {}
}

function busWith(exempt: Parameters<typeof createSessionGate>[0]) {
  const handled: string[] = []
  const commandBus = new CommandBus()
  commandBus.use(createSessionGate(exempt))
  commandBus.register(GuardedCommand, () => {
    handled.push("GuardedCommand")
    return Promise.resolve("handled")
  })
  commandBus.register(SignInCommand, () => {
    handled.push("SignInCommand")
    return Promise.resolve("handled")
  })
  commandBus.register(MiswiredCommand, () => {
    handled.push("MiswiredCommand")
    return Promise.resolve("handled")
  })
  return { commandBus, handled }
}

describe("createSessionGate", () => {
  it("lets a guarded message through when its session is satisfied", async () => {
    const { commandBus, handled } = busWith([])
    expect(await commandBus.execute(new GuardedCommand({ actor: actor() }))).toBe("handled")
    expect(handled).toEqual(["GuardedCommand"])
  })

  it("rejects a guarded message whose session has not completed MFA", async () => {
    const { commandBus, handled } = busWith([])
    const command = new GuardedCommand({
      actor: actor({
        userMfa: UserMFAStatus.CONFIGURED,
        sessionMfa: SessionMFAStatus.NOT_PASSED_YET,
      }),
    })

    await expect(commandBus.execute(command)).rejects.toThrow(AccessError)
    expect(handled).toEqual([])
  })

  it("runs an explicitly anonymous message that has no actor", async () => {
    const { commandBus, handled } = busWith([SignInCommand])
    expect(await commandBus.execute(new SignInCommand({ username: "ada" }))).toBe("handled")
    expect(handled).toEqual(["SignInCommand"])
  })

  it("rejects an unlisted message that carries no actor, rather than waving it through", async () => {
    const { commandBus, handled } = busWith([SignInCommand])

    await expect(commandBus.execute(new MiswiredCommand({ note: "oops" })))
      .rejects.toThrow("not registered as anonymous")
    // Deny by default: forgetting to guard must fail loudly, not silently pass.
    expect(handled).toEqual([])
  })

  it("names the offending message so the wiring bug is findable", async () => {
    const { commandBus } = busWith([])
    await expect(commandBus.execute(new MiswiredCommand({ note: "oops" })))
      .rejects.toThrow("MiswiredCommand")
  })

  it("exempting one message does not exempt the others", async () => {
    const { commandBus, handled } = busWith([SignInCommand])
    await commandBus.execute(new SignInCommand({ username: "ada" }))
    await expect(commandBus.execute(new MiswiredCommand({ note: "oops" }))).rejects.toThrow(
      AccessError,
    )
    expect(handled).toEqual(["SignInCommand"])
  })
})
