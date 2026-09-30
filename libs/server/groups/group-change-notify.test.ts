import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { GroupChangeNotifier, parseGroupChange } from "./group-change-notify.ts"

const GROUP_ID = "0b1f3c58-7f55-4a5d-8f6e-6a3a5a9d1a01"

describe("parseGroupChange", () => {
  it("reads a well-formed change", () => {
    expect(parseGroupChange(JSON.stringify({ groupId: GROUP_ID, sequence: 3 }))).toEqual({
      groupId: GROUP_ID,
      sequence: 3,
    })
  })

  it("ignores anything that is not a group change", () => {
    const payloads = [
      "not json",
      "null",
      "[]",
      JSON.stringify({ groupId: "not-a-uuid", sequence: 1 }),
      JSON.stringify({ groupId: GROUP_ID, sequence: 0 }),
      JSON.stringify({ groupId: GROUP_ID, sequence: 1.5 }),
      JSON.stringify({ groupId: GROUP_ID, sequence: "3" }),
      JSON.stringify({ sequence: 1 }),
    ]
    for (const payload of payloads) expect(parseGroupChange(payload)).toBeNull()
  })
})

describe("GroupChangeNotifier", () => {
  function notifierWith(queries: unknown[][]) {
    // A tagged-template stand-in for the postgres client that records what would be sent.
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push([strings.join("?"), ...values])
      return Promise.resolve([])
    }) as unknown as ConstructorParameters<typeof GroupChangeNotifier>[0]
    return new GroupChangeNotifier(sql)
  }
  const event = (aggregateType: string, aggregateVersion: string) => ({
    id: crypto.randomUUID(),
    eventKind: "group.created",
    aggregateType,
    aggregateId: GROUP_ID,
    aggregateVersion,
    attemptCount: 1,
  })

  it("announces a group change with its id and sequence and nothing else", async () => {
    const queries: unknown[][] = []

    await notifierWith(queries).publish(event("group", "12"))

    expect(queries.length).toBe(1)
    expect(queries[0][1]).toBe("group_change")
    expect(JSON.parse(queries[0][2] as string)).toEqual({ groupId: GROUP_ID, sequence: 12 })
  })

  it("leaves a row of another aggregate alone", async () => {
    const queries: unknown[][] = []

    await notifierWith(queries).publish(event("note", "1"))

    expect(queries).toEqual([])
  })

  it("fails a row without a usable sequence so the outbox retries it", async () => {
    await expect(notifierWith([]).publish(event("group", "0"))).rejects.toThrow(RangeError)
    await expect(notifierWith([]).publish(event("group", "nine"))).rejects.toThrow(RangeError)
  })
})
