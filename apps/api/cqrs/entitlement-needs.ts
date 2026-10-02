import { canManageMember, canMutateNotes, GroupMemberRoleCommand } from "@domain/groups"
import { NoteCreateCommand } from "@domain/notes"
import { type EntitlementNeeds, needsFeature, needsRoom } from "./entitlement-gate.ts"

/**
 * Every command a plan can refuse, in one list (`docs/billing.md`, "Entitlements"). A command not
 * listed here is never refused for its plan, and no query is.
 */
export const ENTITLEMENT_NEEDS: EntitlementNeeds = new Map([
  needsRoom(
    NoteCreateCommand,
    "maxNotes",
    (command) => command.data.groupId,
    (actor) => canMutateNotes(actor),
  ),
  needsFeature(
    GroupMemberRoleCommand,
    "memberRoles",
    (command) => command.data.groupId,
    // Only a promotion needs the feature, so a group back on the free plan can still demote an
    // admin it made on Pro. A change the handler refuses on every plan (a member who has left, a
    // change the actor may not make) goes on to the handler and gets its own answer.
    async (actor, command, roleOf) => {
      const target = await roleOf(command.data.userId)
      return target !== null && canManageMember(actor, target, command.data.role) &&
        command.data.role > target
    },
  ),
])
