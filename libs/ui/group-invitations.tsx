import type { ComponentChildren, JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { Card, CardBody } from "@spy4x/preact-ui/card"
import { Checkbox } from "@spy4x/preact-ui/checkbox"
import { CopyBlock } from "@spy4x/preact-ui/copy-block"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input, Select } from "@spy4x/preact-ui/input"
import { Link } from "@spy4x/preact-ui/link"
import { Stack } from "@spy4x/preact-ui/layout"
import type { PlanRefusal } from "@domain/billing"
import {
  canManageInvitations,
  GroupRole,
  invitableRoles,
  invitableRolesOnPlan,
  INVITATION_DEFAULT_DAYS,
  INVITATION_MAX_DAYS,
  INVITATION_MAX_USES,
} from "@domain/groups"
import { ROLE_TEXT } from "./groups-screen.tsx"
import { PlanRefusalNotice } from "./plan-refusal.tsx"
import {
  FORM_ACTIONS,
  GROUP_PATHS,
  type Navigate,
  SCREEN_PATHS,
  ScreenForm,
} from "./progressive.tsx"

/** Why the role picker offers a viewer only, on a plan without `memberRoles`. */
export const VIEWERS_ONLY_HINT =
  "This group's plan lets an invitation add viewers only. A paid plan lets you invite editors and admins too."

/** A pending invitation as the group's Invitations section lists it. */
export interface InvitationRow {
  id: string
  role: GroupRole
  /** The address it is tied to, or `null` for a link anyone may use. */
  email: string | null
  maxUses: number
  uses: number
  /** When it stops working, as an ISO string. */
  expiresAt: string
  createdBy: { name: string }
}

/** What the creator has chosen in the create form. Field names match the API's create body. */
export interface InvitationDraft {
  role: GroupRole
  expiresInDays: number
  maxUses: number
  email: string
  sendEmail: boolean
}

/** The create form's starting values: an editor, seven days, one use, no address, no mail. */
export const EMPTY_INVITATION_DRAFT: InvitationDraft = {
  role: GroupRole.EDITOR,
  expiresInDays: INVITATION_DEFAULT_DAYS,
  maxUses: 1,
  email: "",
  sendEmail: false,
}

/** The invitation just created: its link, shown this once, and whether it was mailed. */
export interface CreatedInvitation {
  link: string
  /** The creator asked for a mail. */
  mailAsked: boolean
  mailSent: boolean
}

export interface GroupInvitationsSectionProps {
  groupId: string
  /** The role of the person looking. Only the owner and an admin see this section. */
  actorRole: GroupRole
  /**
   * The group's plan includes `memberRoles`. Without it an invitation adds a viewer only, and the
   * role picker says why. Defaults to `true`: the server refuses what the plan does not allow.
   */
  memberRoles?: boolean
  /** The pending invitations, newest first; `null` while they are read. */
  invitations: readonly InvitationRow[] | null
  /** Why the invitations could not be read, or `null`. */
  error?: string | null
  draft: InvitationDraft
  onDraftChange?: (draft: InvitationDraft) => void
  /** A create is in flight. */
  creating?: boolean
  /** Why the create was refused, shown under the form, or `null`. */
  createError?: string | null
  /** The group's plan refused the create: shown as an upgrade prompt in place of `createError`. */
  createRefusal?: PlanRefusal | null
  /** Creates an invitation. A form that posts the draft to `GROUP_PATHS.invitationCreate`. */
  onCreate?: () => void
  /**
   * Drawn inside the create form, above its button: the price confirmation (`SeatPriceConfirm`)
   * of a group billed per member, so its box posts with the form.
   */
  seatPrice?: ComponentChildren
  /** The invitation just created, or `null`. */
  created?: CreatedInvitation | null
  /** The invitation whose revoke is in flight, or `null`. */
  revokingId?: string | null
  /** The last refused revoke, shown under that invitation, or `null`. */
  revokeError?: { invitationId: string; message: string } | null
  /** Revokes an invitation. A form that posts nothing to `GROUP_PATHS.invitationRevoke`. */
  onRevoke?: (invitationId: string) => void
  navigate?: Navigate
}

/**
 * The Invitations section of a group's settings, for the owner and admins. It creates an invitation
 * with a role up to the person's own limit, shows the new link once to copy, and lists the pending
 * ones with a revoke button each. A link is never shown again: only its hash is stored.
 */
export function GroupInvitationsSection(
  {
    groupId,
    actorRole,
    memberRoles = true,
    invitations,
    error = null,
    draft,
    onDraftChange,
    creating = false,
    createError = null,
    createRefusal = null,
    onCreate,
    seatPrice,
    created = null,
    revokingId = null,
    revokeError = null,
    onRevoke,
    navigate,
  }: GroupInvitationsSectionProps,
): JSX.Element | null {
  const emailInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (createError && !createRefusal) emailInput.current?.focus()
  }, [createError, createRefusal])
  const createdBox = useRef<HTMLDivElement>(null)
  // The new link is the next thing to act on, so focus moves to it.
  useEffect(() => {
    if (created) createdBox.current?.focus()
  }, [created])

  const roles = invitableRolesOnPlan(actorRole, memberRoles)
  // A draft role the plan does not allow (the default editor on a free plan) becomes the first one
  // it does, so the picker, the posted form and the app's draft agree.
  const role = roles.includes(draft.role) ? draft.role : roles[0]
  useEffect(() => {
    if (role !== undefined && role !== draft.role) onDraftChange?.({ ...draft, role })
  }, [role, draft.role])

  if (!canManageInvitations(actorRole)) return null
  const change = (patch: Partial<InvitationDraft>) => onDraftChange?.({ ...draft, ...patch })

  return (
    <section aria-labelledby="group-invitations" data-e2e="group-section-invitations">
      <Card>
        <CardBody>
          <Stack>
            <h2 id="group-invitations" class="text-base font-semibold">Invitations</h2>
            <p class="text-sm text-muted">
              Anyone with a link can join with its role until it expires or is used up. Pending
              invitations do not count toward the plan's member limit; accepting one does.
            </p>
            <ScreenForm
              action={GROUP_PATHS.invitationCreate(groupId)}
              pending={creating}
              onSubmit={onCreate}
            >
              <Stack>
                <div class="grid gap-3 sm:grid-cols-3">
                  <Field
                    id="invitation-role"
                    label="Role"
                    hint={memberRoles ? undefined : VIEWERS_ONLY_HINT}
                  >
                    <Select
                      name="role"
                      data-e2e="invitation-role"
                      value={String(role)}
                      options={roles.map((value) => ({ value, label: ROLE_TEXT[value] }))}
                      onChange={(e) => change({ role: Number(e.currentTarget.value) as GroupRole })}
                    />
                  </Field>
                  <Field id="invitation-days" label="Expires after (days)">
                    <Input
                      type="number"
                      name="expiresInDays"
                      data-e2e="invitation-days"
                      min={1}
                      max={INVITATION_MAX_DAYS}
                      value={String(draft.expiresInDays)}
                      onInput={(e) => change({ expiresInDays: Number(e.currentTarget.value) })}
                      required
                    />
                  </Field>
                  <Field id="invitation-uses" label="People it lets in">
                    <Input
                      type="number"
                      name="maxUses"
                      data-e2e="invitation-uses"
                      min={1}
                      max={INVITATION_MAX_USES}
                      value={String(draft.maxUses)}
                      onInput={(e) => change({ maxUses: Number(e.currentTarget.value) })}
                      required
                    />
                  </Field>
                </div>
                <Field
                  id="invitation-email"
                  label="E-mail address (optional)"
                  hint="Only the account that proved this address can accept. It lets in one person."
                  error={createRefusal ? null : createError}
                >
                  <Input
                    ref={emailInput}
                    type="email"
                    name="email"
                    data-e2e="invitation-email"
                    autocomplete="off"
                    maxLength={254}
                    value={draft.email}
                    onInput={(e) => change({ email: e.currentTarget.value })}
                  />
                </Field>
                <Checkbox
                  name="sendEmail"
                  value="true"
                  data-e2e="invitation-send-email"
                  checked={draft.sendEmail}
                  onChange={(e) => change({ sendEmail: e.currentTarget.checked })}
                >
                  Send the link to this address
                </Checkbox>
                {seatPrice}
                {createRefusal && (
                  <PlanRefusalNotice
                    groupId={groupId}
                    refusal={createRefusal}
                    navigate={navigate}
                    headingLevel={3}
                  />
                )}
                <div>
                  <Button
                    type="submit"
                    data-e2e="invitation-create"
                    busy={creating}
                    busyLabel="Creating..."
                  >
                    Create invitation
                  </Button>
                </div>
              </Stack>
            </ScreenForm>
            {created && (
              <div
                ref={createdBox}
                tabIndex={-1}
                class="flex flex-col gap-2"
                data-e2e="invitation-created"
              >
                <p class="text-sm font-medium">
                  Copy this link now: it is not shown again.
                  {created.mailAsked &&
                    (created.mailSent
                      ? " It was also sent by e-mail."
                      : " The e-mail could not be sent, so share the link yourself.")}
                </p>
                <CopyBlock
                  text={created.link}
                  copyLabel="Copy invitation link"
                  copiedLabel="Link copied"
                />
              </div>
            )}
            <h3 class="text-sm font-semibold">Pending</h3>
            {error
              ? <ErrorState message={error} />
              : invitations === null
              ? <p class="text-sm text-muted">Loading the invitations...</p>
              : invitations.length === 0
              ? (
                <p class="text-sm text-muted" data-e2e="invitations-empty">
                  No pending invitations.
                </p>
              )
              : (
                <ul class="flex flex-col divide-y divide-gray-200 dark:divide-gray-700">
                  {invitations.map((invitation) => (
                    <InvitationItem
                      key={invitation.id}
                      groupId={groupId}
                      invitation={invitation}
                      // Revoking is not a plan feature: whoever could give the role may withdraw it.
                      canRevoke={invitableRoles(actorRole).includes(invitation.role)}
                      pending={revokingId === invitation.id}
                      error={revokeError?.invitationId === invitation.id
                        ? revokeError.message
                        : null}
                      onRevoke={onRevoke}
                    />
                  ))}
                </ul>
              )}
          </Stack>
        </CardBody>
      </Card>
    </section>
  )
}

function InvitationItem(
  { groupId, invitation, canRevoke, pending, error, onRevoke }: {
    groupId: string
    invitation: InvitationRow
    canRevoke: boolean
    pending: boolean
    error: string | null
    onRevoke?: (invitationId: string) => void
  },
): JSX.Element {
  const message = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (error) message.current?.focus()
  }, [error])
  const who = invitation.email ?? "Anyone with the link"
  return (
    <li
      class="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
      data-e2e="invitation"
      data-invitation-id={invitation.id}
    >
      <div class="flex min-w-0 flex-col gap-1 text-sm">
        <span class="break-all font-medium" data-e2e="invitation-who">{who}</span>
        <span class="text-xs text-muted">
          <span data-e2e="invitation-role-text">{ROLE_TEXT[invitation.role]}</span>
          {` · used ${invitation.uses} of ${invitation.maxUses} · expires `}
          <time dateTime={invitation.expiresAt}>{invitation.expiresAt.slice(0, 10)}</time>
          {invitation.createdBy.name.trim() && ` · by ${invitation.createdBy.name}`}
        </span>
        <div ref={message} tabIndex={-1} data-e2e="invitation-error">
          <ErrorState message={error} />
        </div>
      </div>
      {canRevoke && (
        <ScreenForm
          action={GROUP_PATHS.invitationRevoke(groupId, invitation.id)}
          pending={pending}
          onSubmit={onRevoke && (() => onRevoke(invitation.id))}
        >
          <Button
            type="submit"
            variant="outline"
            size="sm"
            data-e2e="invitation-revoke"
            busy={pending}
            busyLabel="Revoking..."
            aria-label={`Revoke the invitation for ${who}`}
          >
            Revoke
          </Button>
        </ScreenForm>
      )}
    </li>
  )
}

/** An invitation as the person invited sees it. */
export interface InvitationPreviewRow {
  id: string
  groupId: string
  groupName: string
  /** Empty when the inviter set no name. */
  inviterName: string
  role: GroupRole
  /** Tied to one e-mail address. */
  addressed: boolean
  /** The person looking may accept it. */
  forYou: boolean
  /** When it stops working, as an ISO string. */
  expiresAt: string
}

/** What the accept and decline forms name the invitation by: its link's token or its id. */
export type InvitationFormRef = { token: string } | { invitationId: string }

export interface InvitationScreenProps {
  /** The token of the link this page was opened with: the forms post it back. */
  token: string
  /** The invitation, or `null` while it is read or when it no longer works. */
  invitation: InvitationPreviewRow | null
  loading: boolean
  /** Why the invitation cannot be used (expired, revoked, used up, missing), or `null`. */
  error?: string | null
  /** An accept or decline is in flight. */
  answering?: boolean
  /** Why the accept or decline was refused, or `null`. */
  answerError?: string | null
  /** The group's plan refused the accept: shown as a notice in place of `answerError`. */
  answerRefusal?: PlanRefusal | null
  /** Accepts. A form that posts `{ token }` to `FORM_ACTIONS.invitationAccept`. */
  onAccept?: () => void
  /** Declines. A form that posts `{ token }` to `FORM_ACTIONS.invitationDecline`. */
  onDecline?: () => void
  navigate?: Navigate
}

/** The page an invitation's link opens: the group, who invited and the role, with Accept and Decline. */
export function InvitationScreen(
  {
    token,
    invitation,
    loading,
    error = null,
    answering = false,
    answerError = null,
    answerRefusal = null,
    onAccept,
    onDecline,
    navigate,
  }: InvitationScreenProps,
): JSX.Element {
  const back = (
    <Link href={SCREEN_PATHS.groups} navigate={navigate} class="pc-link text-sm">
      Go to your groups
    </Link>
  )
  if (!invitation) {
    return (
      <Stack gap="lg">
        <EmptyState
          headingLevel={1}
          title={loading ? "Opening the invitation..." : "This invitation cannot be used"}
          description={loading ? undefined : error ?? undefined}
        />
        {!loading && back}
      </Stack>
    )
  }
  return (
    <Stack gap="lg">
      <InvitationCard
        invitation={invitation}
        invitationRef={{ token }}
        headingLevel={1}
        answering={answering}
        error={answerError}
        refusal={answerRefusal}
        onAccept={onAccept}
        onDecline={onDecline}
        navigate={navigate}
      />
      {back}
    </Stack>
  )
}

export interface MyInvitationsSectionProps {
  /** Pending invitations sent to an address the person proved; the section hides when empty. */
  invitations: readonly InvitationPreviewRow[]
  /** The invitation whose accept or decline is in flight, or `null`. */
  answeringId?: string | null
  /** The last refused answer, shown under that invitation, or `null`. */
  answerError?: { invitationId: string; message: string; plan?: PlanRefusal | null } | null
  /** Accepts. A form that posts `{ invitationId }` to `FORM_ACTIONS.invitationAccept`. */
  onAccept?: (invitationId: string) => void
  /** Declines. A form that posts `{ invitationId }` to `FORM_ACTIONS.invitationDecline`. */
  onDecline?: (invitationId: string) => void
  navigate?: Navigate
}

/** The invitations sent to the person's e-mail address, on their groups page. */
export function MyInvitationsSection(
  { invitations, answeringId = null, answerError = null, onAccept, onDecline, navigate }:
    MyInvitationsSectionProps,
): JSX.Element | null {
  if (invitations.length === 0) return null
  return (
    <section aria-labelledby="my-invitations" data-e2e="my-invitations">
      <Stack>
        <h2 id="my-invitations" class="text-base font-semibold">Invitations for you</h2>
        {invitations.map((invitation) => {
          const failed = answerError?.invitationId === invitation.id ? answerError : null
          return (
            <InvitationCard
              key={invitation.id}
              invitation={invitation}
              invitationRef={{ invitationId: invitation.id }}
              headingLevel={3}
              answering={answeringId === invitation.id}
              error={failed?.message ?? null}
              refusal={failed?.plan ?? null}
              onAccept={onAccept && (() => onAccept(invitation.id))}
              onDecline={onDecline && (() => onDecline(invitation.id))}
              navigate={navigate}
            />
          )
        })}
      </Stack>
    </section>
  )
}

function InvitationCard(
  {
    invitation,
    invitationRef,
    headingLevel,
    answering,
    error,
    refusal,
    onAccept,
    onDecline,
    navigate,
  }: {
    invitation: InvitationPreviewRow
    invitationRef: InvitationFormRef
    headingLevel: 1 | 3
    answering: boolean
    error: string | null
    refusal: PlanRefusal | null
    onAccept?: () => void
    onDecline?: () => void
    navigate?: Navigate
  },
): JSX.Element {
  const message = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (error && !refusal) message.current?.focus()
  }, [error, refusal])
  const Heading = headingLevel === 1 ? "h1" : "h3"
  const inviter = invitation.inviterName.trim() || "Someone"
  const hidden = "token" in invitationRef
    ? <input type="hidden" name="token" value={invitationRef.token} />
    : <input type="hidden" name="invitationId" value={invitationRef.invitationId} />
  return (
    <Card>
      <CardBody>
        <div
          class="flex flex-col gap-3"
          data-e2e="invitation-card"
          data-invitation-id={invitation.id}
        >
          <Heading class="break-words text-lg font-semibold" data-e2e="invitation-group">
            {invitation.groupName}
          </Heading>
          <p class="text-sm">
            <span data-e2e="invitation-inviter">{inviter}</span> invited you to join as{" "}
            <Badge text={ROLE_TEXT[invitation.role]} color="blue" />.
          </p>
          <p class="text-xs text-muted">
            Expires <time dateTime={invitation.expiresAt}>{invitation.expiresAt.slice(0, 10)}</time>
          </p>
          {!invitation.forYou
            ? (
              <p class="text-sm" data-e2e="invitation-not-for-you">
                This invitation was sent to another e-mail address. If the address is yours, confirm
                it on the{" "}
                <Link href={SCREEN_PATHS.email} navigate={navigate} class="pc-link">
                  E-mail page
                </Link>{" "}
                first, or sign in with the account that uses it.
              </p>
            )
            : (
              <div class="flex flex-wrap gap-2">
                <ScreenForm
                  action={FORM_ACTIONS.invitationAccept}
                  pending={answering}
                  onSubmit={onAccept}
                >
                  {hidden}
                  <Button
                    type="submit"
                    data-e2e="invitation-accept"
                    busy={answering}
                    busyLabel="Joining..."
                  >
                    Accept
                  </Button>
                </ScreenForm>
                <ScreenForm
                  action={FORM_ACTIONS.invitationDecline}
                  pending={answering}
                  onSubmit={onDecline}
                >
                  {hidden}
                  <Button type="submit" variant="outline" data-e2e="invitation-decline">
                    Decline
                  </Button>
                </ScreenForm>
              </div>
            )}
          {refusal
            ? (
              <PlanRefusalNotice
                groupId={invitation.groupId}
                refusal={refusal}
                navigate={navigate}
                headingLevel={headingLevel === 1 ? 2 : 4}
              />
            )
            : (
              <div ref={message} tabIndex={-1} data-e2e="invitation-answer-error">
                <ErrorState message={error} />
              </div>
            )}
        </div>
      </CardBody>
    </Card>
  )
}
