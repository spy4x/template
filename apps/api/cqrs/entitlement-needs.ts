import { canManageMember, canMutateNotes, GroupMemberRoleCommand, GroupRole } from "@domain/groups"
import { NoteCreateCommand } from "@domain/notes"
import { type EntitlementNeeds, needsFeature, needsRoom } from "./entitlement-gate.ts"

/**
 * Every command a plan can refuse, in one list (`docs/billing.md`, "Entitlements"). A command not
 * listed here is never refused for its plan, and no query is.
 */
export const ENTITLEMENT_NEEDS: EntitlementNeeds = new Map([
  needsRoom(NoteCreateCommand, "maxNotes", (command) => command.data.groupId, canMutateNotes),
  needsFeature(
    GroupMemberRoleCommand,
    "memberRoles",
    (command) => command.data.groupId,
    // The owner and admins change roles; anyone else is refused by the handler, plan or not.
    (role) => canManageMember(role, GroupRole.VIEWER),
  ),
])
