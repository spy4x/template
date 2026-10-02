import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import {
  assertCanChangeRole,
  assertCanDelete,
  assertCanLeave,
  assertCanRemoveMember,
  assertCanRename,
  assertOwnerRemains,
  assignableRoles,
  canDelete,
  canManageMember,
  canMutateNotes,
  canRead,
  canRename,
  GroupError,
  GroupRole,
  parseCreateGroupRequest,
  parseGroupIdRequest,
  parseMemberRequest,
  parseMemberRoleBody,
  parseMemberRoleRequest,
  parseMemberUserIdParam,
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

  it("still accepts and ignores kind 2 from a page cached before the kind was dropped", () => {
    const id = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"

    expect(parseCreateGroupRequest({ id, name: "Team", kind: 2 })).toEqual({ id, name: "Team" })
  })

  it("rejects malformed, uppercase, empty, long, and extra create data", () => {
    const id = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
    const invalid = [
      { id: "not-a-uuid", name: "Team" },
      { id: id.toUpperCase(), name: "Team" },
      { id, name: "  " },
      { id, name: "x".repeat(101) },
      { id, name: "Team", userId: 99 },
      { id, name: "Team", kind: 1 },
      { id, name: "Team", kind: 2, userId: 99 },
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

const { VIEWER, EDITOR, ADMIN, OWNER } = GroupRole
const ROLES = [VIEWER, EDITOR, ADMIN, OWNER]

describe("group members", () => {
  it("lets the owner give anyone else viewer, editor or admin, and never the owner role", () => {
    expect(assignableRoles(OWNER, VIEWER)).toEqual([EDITOR, ADMIN])
    expect(assignableRoles(OWNER, EDITOR)).toEqual([VIEWER, ADMIN])
    expect(assignableRoles(OWNER, ADMIN)).toEqual([VIEWER, EDITOR])
    expect(assignableRoles(OWNER, OWNER)).toEqual([])
  })

  it("lets an admin move viewers and editors between those two roles only", () => {
    expect(assignableRoles(ADMIN, VIEWER)).toEqual([EDITOR])
    expect(assignableRoles(ADMIN, EDITOR)).toEqual([VIEWER])
    expect(assignableRoles(ADMIN, ADMIN)).toEqual([])
    expect(assignableRoles(ADMIN, OWNER)).toEqual([])
  })

  it("gives a viewer or an editor no role to hand out", () => {
    for (const actor of [VIEWER, EDITOR]) {
      for (const target of ROLES) expect(assignableRoles(actor, target)).toEqual([])
    }
  })

  it("refuses a viewer every role change and every removal", () => {
    for (const target of [VIEWER, EDITOR, ADMIN]) {
      for (const next of [VIEWER, EDITOR, ADMIN]) {
        expect(codeOf(() => assertCanChangeRole(VIEWER, target, next))).toBe("ROLE_INSUFFICIENT")
      }
      expect(codeOf(() => assertCanRemoveMember(VIEWER, target))).toBe("ROLE_INSUFFICIENT")
    }
  })

  it("checks a role change as assignableRoles offers it", () => {
    for (const actor of ROLES) {
      for (const target of [VIEWER, EDITOR, ADMIN]) {
        for (const next of [VIEWER, EDITOR, ADMIN]) {
          if (next === target) continue
          const allowed = codeOf(() => assertCanChangeRole(actor, target, next)) === undefined
          expect(allowed).toBe(assignableRoles(actor, target).includes(next))
        }
      }
    }
  })

  it("never changes the owner's role or hands out the owner role", () => {
    expect(codeOf(() => assertCanChangeRole(OWNER, OWNER, ADMIN))).toBe("LAST_OWNER")
    expect(codeOf(() => assertCanChangeRole(OWNER, ADMIN, OWNER))).toBe("LAST_OWNER")
  })

  it("lets the owner remove anyone else and an admin remove viewers and editors", () => {
    for (const target of [VIEWER, EDITOR, ADMIN]) {
      expect(codeOf(() => assertCanRemoveMember(OWNER, target))).toBeUndefined()
    }
    expect(codeOf(() => assertCanRemoveMember(ADMIN, VIEWER))).toBeUndefined()
    expect(codeOf(() => assertCanRemoveMember(ADMIN, EDITOR))).toBeUndefined()
    expect(codeOf(() => assertCanRemoveMember(ADMIN, ADMIN))).toBe("ROLE_INSUFFICIENT")
    expect(codeOf(() => assertCanRemoveMember(EDITOR, VIEWER))).toBe("ROLE_INSUFFICIENT")
    expect(codeOf(() => assertCanRemoveMember(OWNER, OWNER))).toBe("LAST_OWNER")
  })

  it("tells a non-member the group does not exist, and names a missing member", () => {
    expect(codeOf(() => assertCanChangeRole(null, VIEWER, EDITOR))).toBe("GROUP_NOT_FOUND")
    expect(codeOf(() => assertCanRemoveMember(null, VIEWER))).toBe("GROUP_NOT_FOUND")
    expect(codeOf(() => assertCanLeave(null))).toBe("GROUP_NOT_FOUND")
    expect(codeOf(() => assertCanChangeRole(OWNER, null, EDITOR))).toBe("MEMBER_NOT_FOUND")
    expect(codeOf(() => assertCanRemoveMember(OWNER, null))).toBe("MEMBER_NOT_FOUND")
  })

  it("lets every member but the owner leave", () => {
    for (const role of [VIEWER, EDITOR, ADMIN]) {
      expect(codeOf(() => assertCanLeave(role))).toBeUndefined()
    }
    expect(codeOf(() => assertCanLeave(OWNER))).toBe("LAST_OWNER")
  })

  it("parses a role change and a member request strictly", () => {
    const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
    expect(parseMemberRoleBody({ role: 2 })).toEqual({ role: EDITOR })
    expect(parseMemberRoleRequest({ groupId, userId: 7, role: 3 }))
      .toEqual({ groupId, userId: 7, role: ADMIN })
    expect(parseMemberRequest({ groupId, userId: 7 })).toEqual({ groupId, userId: 7 })
    expect(parseMemberUserIdParam("42")).toBe(42)
    const badBodies = [{ role: 4 }, { role: 0 }, { role: "2" }, {}, { role: 2, userId: 1 }]
    for (const value of badBodies) {
      expect(codeOf(() => parseMemberRoleBody(value))).toBe("INVALID_REQUEST")
    }
    const badRequests = [
      { groupId, userId: "7", role: 2 },
      { groupId, userId: 0, role: 2 },
      { groupId, userId: 1.5, role: 2 },
      { groupId, role: 2 },
      { groupId: "nope", userId: 7, role: 2 },
    ]
    for (const value of badRequests) {
      expect(codeOf(() => parseMemberRoleRequest(value))).toBe("INVALID_REQUEST")
    }
    for (const value of [{ groupId }, { groupId, userId: -1 }, { groupId, userId: 7, x: 1 }]) {
      expect(codeOf(() => parseMemberRequest(value))).toBe("INVALID_REQUEST")
    }
    for (const value of ["0", "007", "1e3", "-1", "2147483648", "abc"]) {
      expect(codeOf(() => parseMemberUserIdParam(value))).toBe("INVALID_REQUEST")
    }
  })
})
