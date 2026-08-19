import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import {
  assertOwnerRemains,
  assertPersonalInvariant,
  canManageMember,
  canMutateNotes,
  canRead,
  GroupError,
  GroupKind,
  GroupRole,
  parseCreateSharedGroupRequest,
} from "./+lib.ts"

describe("group domain", () => {
  it("keeps fixed v1 enum values", () => {
    expect(GroupKind.PERSONAL).toBe(1)
    expect(GroupKind.SHARED).toBe(2)
    expect(GroupRole.VIEWER).toBe(1)
    expect(GroupRole.EDITOR).toBe(2)
    expect(GroupRole.ADMIN).toBe(3)
    expect(GroupRole.OWNER).toBe(4)
  })

  it("applies read and note mutation roles", () => {
    expect(canRead(GroupRole.VIEWER)).toBe(true)
    expect(canMutateNotes(GroupRole.VIEWER)).toBe(false)
    expect(canMutateNotes(GroupRole.EDITOR)).toBe(true)
    expect(canMutateNotes(GroupRole.ADMIN)).toBe(true)
    expect(canMutateNotes(GroupRole.OWNER)).toBe(true)
  })

  it("limits admins to viewer and editor membership", () => {
    expect(canManageMember(GroupRole.ADMIN, GroupRole.VIEWER, GroupRole.EDITOR)).toBe(true)
    expect(canManageMember(GroupRole.ADMIN, GroupRole.EDITOR)).toBe(true)
    expect(canManageMember(GroupRole.ADMIN, GroupRole.ADMIN, GroupRole.VIEWER)).toBe(false)
    expect(canManageMember(GroupRole.ADMIN, GroupRole.EDITOR, GroupRole.ADMIN)).toBe(false)
    expect(canManageMember(GroupRole.EDITOR, GroupRole.VIEWER)).toBe(false)
  })

  it("covers every actor, target, and next-role combination", () => {
    const roles = [GroupRole.VIEWER, GroupRole.EDITOR, GroupRole.ADMIN, GroupRole.OWNER]
    for (const actor of roles) {
      for (const target of roles) {
        for (const next of [undefined, ...roles]) {
          const expected = actor === GroupRole.OWNER ||
            (actor === GroupRole.ADMIN && target <= GroupRole.EDITOR &&
              (next === undefined || next <= GroupRole.EDITOR))
          expect(canManageMember(actor, target, next)).toBe(expected)
        }
      }
    }
  })

  it("lets owners manage all roles while preserving separate last-owner rule", () => {
    for (const target of Object.values(GroupRole).filter(Number.isInteger) as GroupRole[]) {
      for (const next of Object.values(GroupRole).filter(Number.isInteger) as GroupRole[]) {
        expect(canManageMember(GroupRole.OWNER, target, next)).toBe(true)
      }
    }
    expect(() => assertOwnerRemains(1)).not.toThrow()
    expect(() => assertOwnerRemains(0)).toThrow(GroupError)
  })

  it("blocks personal-group governance mutations", () => {
    const operations = [
      "delete",
      "invite",
      "manual-create",
      "remove-owner",
      "transfer-owner",
    ] as const
    for (const operation of operations) {
      expect(() => assertPersonalInvariant({ kind: GroupKind.PERSONAL }, operation)).toThrow(
        GroupError,
      )
    }
    expect(() => assertPersonalInvariant({ kind: GroupKind.SHARED }, "invite")).not.toThrow()
  })

  it("parses only strict shared-group create intent", () => {
    expect(parseCreateSharedGroupRequest({
      id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001",
      kind: 2,
      name: "  Team  ",
    })).toEqual({
      id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001",
      kind: GroupKind.SHARED,
      name: "Team",
    })
  })

  it("rejects personal, malformed, uppercase, empty, long, and extra create data", () => {
    const id = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
    const invalid = [
      { id, kind: GroupKind.PERSONAL, name: "Personal" },
      { id: "not-a-uuid", kind: GroupKind.SHARED, name: "Team" },
      { id: id.toUpperCase(), kind: GroupKind.SHARED, name: "Team" },
      { id, kind: GroupKind.SHARED, name: "  " },
      { id, kind: GroupKind.SHARED, name: "x".repeat(101) },
      { id, kind: GroupKind.SHARED, name: "Team", userId: 99 },
    ]
    for (const value of invalid) {
      expect(() => parseCreateSharedGroupRequest(value)).toThrow(GroupError)
    }
  })
})
