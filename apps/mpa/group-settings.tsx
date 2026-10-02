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
import {
  EMPTY_TRANSFER_DRAFT,
  GroupTransferSection,
  type TransferDraft,
  type TransferError,
} from "@ui/group-transfer.tsx"
import { entitlementsOf, type PlanRefusal } from "@domain/billing"
import { SeatPriceConfirm } from "@ui/billing-screen.tsx"
import { readGroupInvitations } from "./invitations.tsx"
import { readBilling } from "./billing.tsx"
import { readGroup, readMembers } from "./groups.ts"
import { Frame, readSession, signInPath } from "./session.tsx"
import type { State } from "./utils.ts"

/**
 * One group's settings page, for the `GET` and for a refused rename, delete, member change,
 * leave, invitation, revoke or transfer, which shows the refusal where the person acted and keeps
 * what they typed. A new invitation's link is drawn this once, in the answer to its create.
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
    acceptSeatPrice = false,
    seatPriceError = null,
    created = null,
    revokeError = null,
    transferDraft = EMPTY_TRANSFER_DRAFT,
    transferError = null,
    status,
    retryAfter,
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
    /** The creator ticked the per-member price confirmation. */
    acceptSeatPrice?: boolean
    /** Why the create was refused for want of the price confirmation, shown at the box. */
    seatPriceError?: string | null
    created?: CreatedInvitation | null
    revokeError?: { invitationId: string; message: string } | null
    /** What a refused transfer posted, without the password, which is never sent back. */
    transferDraft?: TransferDraft
    transferError?: TransferError | null
    status?: number
    /** The API's `Retry-After` of a refused request, passed on with its status. */
    retryAfter?: string
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
            memberRoles={billing
              ? entitlementsOf(billing.planId, billing.enabled).features.memberRoles
              : true}
            invitations={invitations.invitations}
            error={invitations.error}
            draft={invitationDraft}
            // The route shows a refusal for the price at the confirmation; without the billing,
            // the confirmation is not drawn and the refusal shows under the form.
            createError={createError ?? (billing?.seatPrice ? null : seatPriceError)}
            createRefusal={createRefusal}
            seatPrice={billing?.seatPrice && (
              <SeatPriceConfirm
                seatPrice={billing.seatPrice}
                checked={acceptSeatPrice}
                error={seatPriceError}
              />
            )}
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
        transfer={group && (
          <GroupTransferSection
            groupId={groupId}
            groupName={group.name}
            role={group.role}
            members={members?.members ?? null}
            hasSubscription={billing?.subscribed ?? false}
            draft={transferDraft}
            error={transferError}
          />
        )}
      />
    </Frame>,
    {
      status: status ?? (group ? 200 : 404),
      headers: retryAfter ? { "retry-after": retryAfter } : undefined,
    },
  )
}
