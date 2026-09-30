import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { ConnectionLostError, RealtimeRequestError, RequestTimeoutError } from "@spy4x/realtime"
import { type CallPort, sendCommand, sendQuery } from "./realtime-call.ts"

interface Sent {
  name: string
  payload: unknown
  key?: string
}

/** A port whose next answers are scripted: an Error rejects, anything else resolves. */
function scriptedPort(answers: unknown[]): { port: CallPort; sent: Sent[] } {
  const sent: Sent[] = []
  const next = (): Promise<unknown> => {
    const answer = answers.shift()
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
  }
  return {
    sent,
    port: {
      command(name, payload, options) {
        sent.push({ name, payload, key: options?.idempotencyKey })
        return next()
      },
      query(name, payload) {
        sent.push({ name, payload })
        return next()
      },
    },
  }
}

const noSleep = () => Promise.resolve()

describe("sendCommand", () => {
  it("sends the command with a key and returns the result", async () => {
    const { port, sent } = scriptedPort([{ ok: 1 }])

    const result = await sendCommand(port, "group.create", { name: "A" }, { newKey: () => "k-1" })

    expect(result).toEqual({ ok: 1 })
    expect(sent).toEqual([{ name: "group.create", payload: { name: "A" }, key: "k-1" }])
  })

  it("retries a dropped connection and a timeout with the same key", async () => {
    const { port, sent } = scriptedPort([
      new ConnectionLostError("closed"),
      new RequestTimeoutError("r-1", 15_000),
      { ok: 1 },
    ])
    let keysMade = 0

    const result = await sendCommand(port, "group.create", {}, {
      sleep: noSleep,
      newKey: () => `k-${++keysMade}`,
    })

    expect(result).toEqual({ ok: 1 })
    expect(keysMade).toBe(1)
    expect(sent.map((frame) => frame.key)).toEqual(["k-1", "k-1", "k-1"])
  })

  it("retries a server timeout and a first try that is still running", async () => {
    const { port, sent } = scriptedPort([
      new RealtimeRequestError("timeout", "too slow"),
      new RealtimeRequestError("conflict", "running", { code: "IN_PROGRESS" }),
      { ok: 1 },
    ])

    await sendCommand(port, "group.create", {}, { sleep: noSleep })

    expect(sent).toHaveLength(3)
  })

  it("does not retry an answer that will not change", async () => {
    const { port, sent } = scriptedPort([
      new RealtimeRequestError("conflict", "in use", { code: "ID_ALREADY_EXISTS" }),
    ])

    await expect(sendCommand(port, "group.create", {}, { sleep: noSleep })).rejects.toMatchObject({
      code: "conflict",
    })
    expect(sent).toHaveLength(1)
  })

  it("gives up after the attempts and rethrows the last error", async () => {
    const { port, sent } = scriptedPort([
      new ConnectionLostError("a"),
      new ConnectionLostError("b"),
      new ConnectionLostError("c"),
    ])

    await expect(sendCommand(port, "x", {}, { attempts: 3, sleep: noSleep })).rejects.toThrow("c")
    expect(sent).toHaveLength(3)
  })

  it("waits longer before each further try", async () => {
    const { port } = scriptedPort([
      new ConnectionLostError("a"),
      new ConnectionLostError("b"),
      { ok: 1 },
    ])
    const waits: number[] = []

    await sendCommand(port, "x", {}, {
      delayMs: 100,
      sleep: (ms) => {
        waits.push(ms)
        return Promise.resolve()
      },
    })

    expect(waits).toEqual([100, 200])
  })
})

describe("sendQuery", () => {
  it("retries a dropped connection and sends no key", async () => {
    const { port, sent } = scriptedPort([new ConnectionLostError("closed"), { groups: [] }])

    const result = await sendQuery(port, "group.list", { limit: 5 }, { sleep: noSleep })

    expect(result).toEqual({ groups: [] })
    expect(sent).toEqual([
      { name: "group.list", payload: { limit: 5 } },
      { name: "group.list", payload: { limit: 5 } },
    ])
  })
})
