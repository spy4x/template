import type { FreshContext } from "fresh"
import { GroupSettingsScreen } from "@ui/group-settings-screen.tsx"
import type { MemberError } from "@ui/group-members.tsx"
import { BillingCard } from "@ui/billing-screen.tsx"
import {
  type CreatedInvitation,
  EMPTY_INVITATION_DRAFT,
  GroupInvitationsSection,
  type InvitationDraft,
} from "@ui/group-invitations.tsx"
import type { PlanRefusal } from "@domain/billing"
import { readGroupInvitations } from "./invitations.tsx"
import { readBilling } from "./billing.tsx"
import { readGroup, readMembers } from "./groups.ts"
import { Frame, readSession, signInPath } from "./session.tsx"
import type { State } from "./utils.ts"

/**
 * One group's settings page, for the `GET` and for a refused rename, delete, member change,
 * leave, invitation or revoke, which shows the refusal where the person acted and keeps what they
 * typed. A new invitation's link is drawn this once, in the answer to its create.
 */
export async function renderGroupSettings(
  ctx: FreshContext<State>,
  {
    name,
    renameError = null,
    deleteError = null,
    memberError = null,
    leaveError = null,
    billingError = null,
    invitationDraft = EMPTY_INVITATION_DRAFT,
    createError = null,
    createRefusal = null,
    created = null,
    revokeError = null,
    status,
  }: {
    name?: string
    renameError?: string | null
    deleteError?: string | null
    memberError?: MemberError | null
    leaveError?: string | null
    /** Why the portal could not be opened, shown in the plan section. */
    billingError?: string | null
    invitationDraft?: InvitationDraft
    createError?: string | null
    createRefusal?: PlanRefusal | null
    created?: CreatedInvitation | null
    revokeError?: { invitationId: string; message: string } | null
    status?: number
  } = {},
): Promise<Response> {
  const session = await readSession(ctx.state.api)
  if (!session.user) return ctx.redirect(signInPath(session, ctx.req), 303)
  const { groupId } = ctx.params
  const [group, members, billing] = await Promise.all([
    readGroup(ctx.state.api, groupId),
    readMembers(ctx.state.api, groupId),
    readBilling(ctx.state.api, groupId),
  ])
  const invitations = await readGroupInvitations(ctx.state.api, groupId, group?.role)
  return ctx.render(
    <Frame session={session} path={ctx.url.pathname}>
      <GroupSettingsScreen
        group={group}
        selected={session.picker?.selectedId === groupId}
        loading={false}
        name={name}
        renameError={renameError}
        deleteError={deleteError}
        // Unknown when the picker could not be read; the server refuses the last group anyway.
        isLastGroup={session.picker !== null && session.picker.groups.length <= 1}
        hasSubscription={billing?.subscribed ?? false}
        members={members?.members ?? null}
        memberCount={members?.memberCount}
        membersError={members ? null : "The members could not be read"}
        memberError={memberError}
        leaveError={leaveError}
        invitations={group && (
          <GroupInvitationsSection
            groupId={groupId}
            actorRole={group.role}
            invitations={invitations.invitations}
            error={invitations.error}
            draft={invitationDraft}
            createError={createError}
            createRefusal={createRefusal}
            created={created}
            revokeError={revokeError}
          />
        )}
        billing={group && (
          <BillingCard
            groupId={groupId}
            billing={billing}
            error={billingError ?? (billing ? null : "The plan could not be read")}
          />
        )}
      />
    </Frame>,
    { status: status ?? (group ? 200 : 404) },
  )
}
