import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { EventBus } from "./event-bus.ts"
import type { Event } from "./types.ts"

class PingEvent implements Event<{ value: string }> {
  constructor(public data: { value: string }) {}
}

describe("event-bus", () => {
  it("emits to listeners", async () => {
    const bus = new EventBus()
    let received: string | null = null
    bus.on(PingEvent, (event) => {
      received = event.data?.value ?? null
    })

    bus.emit(new PingEvent({ value: "ok" }))
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))

    expect(received).toBe("ok")
  })

  it("unsubscribes from listener", async () => {
    const bus = new EventBus()
    let hits = 0
    const off = bus.on(PingEvent, () => {
      hits += 1
    })

    off()
    bus.emit(new PingEvent({ value: "ok" }))
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))

    expect(hits).toBe(0)
  })

  it("once fires once", async () => {
    const bus = new EventBus()
    let hits = 0
    bus.once(PingEvent, () => {
      hits += 1
    })

    bus.emit(new PingEvent({ value: "a" }))
    bus.emit(new PingEvent({ value: "b" }))
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))

    expect(hits).toBe(1)
  })
})
