import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { GroupSelectedEvent, PushDevicesUpdatedEvent, UserProfileUpdatedEvent } from "../events.ts"
import type { User } from "@domain/identity"
import {
  createGroupSelectedHintListener,
  createProfileHintListener,
  createPushDevicesHintListener,
} from "./user-change-hints.ts"

describe("user change hint listeners", () => {
  it("hints the user whose profile was updated", () => {
    const hinted: number[] = []

    createProfileHintListener((id) => hinted.push(id))(
      new UserProfileUpdatedEvent({ user: { id: 7 } as User, request: {} }),
    )

    expect(hinted).toEqual([7])
  })

  it("hints the user whose push devices changed", () => {
    const hinted: number[] = []

    createPushDevicesHintListener((id) => hinted.push(id))(
      new PushDevicesUpdatedEvent({ userId: 7, devices: [], request: {} }),
    )

    expect(hinted).toEqual([7])
  })

  it("hints the user who chose another group", () => {
    const hinted: number[] = []

    createGroupSelectedHintListener((id) => hinted.push(id))(
      new GroupSelectedEvent({ userId: 7, groupId: "g" }),
    )

    expect(hinted).toEqual([7])
  })
})
