import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import {
  assertCanDelete,
  assertCanRename,
  assertOwnerRemains,
  canDelete,
  canManageMember,
  canMutateNotes,
  canRead,
  canRename,
  GroupError,
  GroupRole,
  parseCreateGroupRequest,
  parseGroupIdRequest,
  parseRenameGroupBody,
  parseRenameGroupRequest,
} from "./+lib.ts"

/** The code of the `GroupError` `run` throws, or `undefined` when it throws nothing. */
function codeOf(run: () => void): string | undefined {
  try {
    run()
  } catch (error) {
    return (error as GroupError).code
  }
}

describe("group domain", () => {
  it("keeps fixed v1 enum values", () => {
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

  it("lets only an admin or the owner rename a group", () => {
    expect([GroupRole.VIEWER, GroupRole.EDITOR, GroupRole.ADMIN, GroupRole.OWNER].map(canRename))
      .toEqual([false, false, true, true])
    expect(() => assertCanRename(GroupRole.ADMIN)).not.toThrow()
    expect(() => assertCanRename(GroupRole.OWNER)).not.toThrow()
    for (const role of [GroupRole.VIEWER, GroupRole.EDITOR]) {
      expect(codeOf(() => assertCanRename(role))).toBe("ROLE_INSUFFICIENT")
    }
  })

  it("lets only the owner delete or restore a group", () => {
    expect([GroupRole.VIEWER, GroupRole.EDITOR, GroupRole.ADMIN, GroupRole.OWNER].map(canDelete))
      .toEqual([false, false, false, true])
    expect(() => assertCanDelete(GroupRole.OWNER)).not.toThrow()
    for (const role of [GroupRole.VIEWER, GroupRole.EDITOR, GroupRole.ADMIN]) {
      expect(codeOf(() => assertCanDelete(role))).toBe("ROLE_INSUFFICIENT")
    }
  })

  it("tells a non-member the group does not exist, whatever they tried", () => {
    for (const assert of [assertCanRename, assertCanDelete]) {
      expect(codeOf(() => assert(null))).toBe("GROUP_NOT_FOUND")
    }
  })

  it("parses only strict group create intent", () => {
    expect(parseCreateGroupRequest({
      id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001",
      name: "  Team  ",
    })).toEqual({
      id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001",
      name: "Team",
    })
  })

  it("rejects malformed, uppercase, empty, long, and extra create data", () => {
    const id = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
    const invalid = [
      { id: "not-a-uuid", name: "Team" },
      { id: id.toUpperCase(), name: "Team" },
      { id, name: "  " },
      { id, name: "x".repeat(101) },
      { id, name: "Team", userId: 99 },
      { id, name: "Team", kind: 2 },
    ]
    for (const value of invalid) {
      expect(() => parseCreateGroupRequest(value)).toThrow(GroupError)
    }
  })

  it("parses a rename as exactly a trimmed name, with the group id for the socket", () => {
    const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
    expect(parseRenameGroupBody({ name: "  Trip  " })).toEqual({ name: "Trip" })
    expect(parseRenameGroupRequest({ groupId, name: "Trip" })).toEqual({ groupId, name: "Trip" })
    for (const value of [{}, { name: "" }, { name: "x".repeat(101) }, { name: 5 }]) {
      expect(() => parseRenameGroupBody(value)).toThrow(GroupError)
    }
    for (const value of [{ name: "Trip" }, { groupId, name: " " }, { groupId, name: "a", x: 1 }]) {
      expect(() => parseRenameGroupRequest(value)).toThrow(GroupError)
    }
    expect(() => parseRenameGroupBody({ name: "Trip", groupId })).toThrow(GroupError)
  })

  it("parses a request that names one group as exactly its lowercase id", () => {
    const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
    expect(parseGroupIdRequest({ groupId })).toEqual({ groupId })
    for (const value of [{}, { groupId: "nope" }, { groupId: groupId.toUpperCase() }]) {
      expect(() => parseGroupIdRequest(value)).toThrow(GroupError)
    }
    expect(() => parseGroupIdRequest({ groupId, name: "x" })).toThrow(GroupError)
  })
})
