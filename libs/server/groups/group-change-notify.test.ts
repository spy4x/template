import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { type } from "arktype"
import { groupAccessLossSchema, groupChangeSchema } from "./group-change-notify.ts"

const GROUP_ID = "0b1f3c58-7f55-4a5d-8f6e-6a3a5a9d1a01"

const accepts = (schema: typeof groupChangeSchema | typeof groupAccessLossSchema, value: unknown) =>
  !(schema(value) instanceof type.errors)

describe("groupChangeSchema", () => {
  it("accepts a well-formed change", () => {
    expect(accepts(groupChangeSchema, { groupId: GROUP_ID, sequence: 3 })).toBe(true)
  })

  it("drops anything that is not a group change", () => {
    const payloads = [
      null,
      [],
      { groupId: "not-a-uuid", sequence: 1 },
      { groupId: GROUP_ID, sequence: 0 },
      { groupId: GROUP_ID, sequence: 1.5 },
      { groupId: GROUP_ID, sequence: "3" },
      { sequence: 1 },
    ]
    for (const payload of payloads) expect(accepts(groupChangeSchema, payload)).toBe(false)
  })
})

describe("groupAccessLossSchema", () => {
  it("accepts a well-formed access loss", () => {
    expect(accepts(groupAccessLossSchema, { groupId: GROUP_ID, sequence: 3, userIds: [4, 9] }))
      .toBe(true)
  })

  it("drops anything that is not an access loss", () => {
    const payloads = [
      null,
      { groupId: GROUP_ID, sequence: 3 },
      { groupId: GROUP_ID, sequence: 3, userIds: [] },
      { groupId: GROUP_ID, sequence: 3, userIds: "4" },
      { groupId: GROUP_ID, sequence: 3, userIds: [4, "9"] },
      { groupId: GROUP_ID, sequence: 3, userIds: [0] },
      { groupId: GROUP_ID, sequence: 3, userIds: [1.5] },
      { groupId: GROUP_ID, sequence: 0, userIds: [4] },
      { groupId: "not-a-uuid", sequence: 3, userIds: [4] },
    ]
    for (const payload of payloads) expect(accepts(groupAccessLossSchema, payload)).toBe(false)
  })
})
