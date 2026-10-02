import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { Avatar } from "@spy4x/preact-ui/avatar"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { Card, CardBody } from "@spy4x/preact-ui/card"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Select } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { assignableRoles, canLeave, canRemoveMember, GroupRole } from "@domain/groups"
import { ROLE_TEXT } from "./groups-screen.tsx"
import { GROUP_PATHS, ScreenForm } from "./progressive.tsx"

/** One member of a group as the members section shows them. */
export interface GroupMemberRow {
  userId: number
  /** First and last name; empty when the person has set none. */
  name: string
  /** The address they sign in with, or `null` for an account without one. */
  email: string | null
  role: GroupRole
  /** When they joined, as an ISO string. */
  joinedAt: string
  /** Whether this member is the person looking at the page. */
  isYou: boolean
}

/** What a member is called on the page: their name, else their address, else a placeholder. */
export function memberLabel(member: Pick<GroupMemberRow, "name" | "email">): string {
  return member.name.trim() || member.email || "Unnamed member"
}

/** A member change that was refused, shown under that member's row. */
export interface MemberError {
  userId: number
  message: string
}

export interface GroupMembersSectionProps {
  groupId: string
  /** The role of the person looking: it decides which controls each row shows. */
  actorRole: GroupRole
  /** The members, oldest first; `null` while they are read. */
  members: readonly GroupMemberRow[] | null
  /** Why the members could not be read, or `null`. */
  error?: string | null
  /** The member whose role change or removal is in flight, or `null`. */
  pendingUserId?: number | null
  /** The last refused change, shown under its member's row, or `null`. */
  memberError?: MemberError | null
  /**
   * Gives a member a new role. A form that posts `{ role }` to `GROUP_PATHS.memberRole`; with this
   * callback the app takes the submit over.
   */
  onRoleChange?: (userId: number, role: GroupRole) => void
  /** Removes a member. A form that posts nothing to `GROUP_PATHS.memberRemove`. */
  onRemove?: (userId: number) => void
}

/**
 * The members of a group, for every member to read. Beside each member the owner and an admin
 * find a role form and a remove button, for the members below them; nobody changes the owner here.
 */
export function GroupMembersSection(
  {
    groupId,
    actorRole,
    members,
    error = null,
    pendingUserId = null,
    memberError = null,
    onRoleChange,
    onRemove,
  }: GroupMembersSectionProps,
): JSX.Element {
  return (
    <section aria-labelledby="group-members" data-e2e="group-section-members">
      <Card>
        <CardBody>
          <Stack>
            <h2 id="group-members" class="text-base font-semibold">
              Members{members ? ` (${members.length})` : ""}
            </h2>
            {error
              ? <ErrorState message={error} />
              : members === null
              ? (
                <p class="text-sm text-muted" data-e2e="group-members-loading">
                  Loading the members...
                </p>
              )
              : (
                <ul class="flex flex-col divide-y divide-gray-200 dark:divide-gray-700">
                  {members.map((member) => (
                    <MemberItem
                      key={member.userId}
                      groupId={groupId}
                      actorRole={actorRole}
                      member={member}
                      pending={pendingUserId === member.userId}
                      error={memberError?.userId === member.userId ? memberError.message : null}
                      onRoleChange={onRoleChange}
                      onRemove={onRemove}
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

function MemberItem(
  { groupId, actorRole, member, pending, error, onRoleChange, onRemove }: {
    groupId: string
    actorRole: GroupRole
    member: GroupMemberRow
    pending: boolean
    error: string | null
    onRoleChange?: (userId: number, role: GroupRole) => void
    onRemove?: (userId: number) => void
  },
): JSX.Element {
  const label = memberLabel(member)
  const roles = assignableRoles(actorRole, member.role)
  const removable = canRemoveMember(actorRole, member.role)
  const [role, setRole] = useState(member.role)
  // A role the server confirmed, or a page read again, replaces what the select showed.
  useEffect(() => setRole(member.role), [member.role])
  // A refused change has no field of its own, so focus lands on the message under the row.
  const message = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (error) message.current?.focus()
  }, [error])
  const selectId = `group-member-role-${member.userId}`

  return (
    <li class="flex flex-col gap-3 py-3" data-e2e="group-member" data-user-id={member.userId}>
      <div class="flex min-w-0 items-center gap-3">
        <Avatar name={label} alt="" size="sm" />
        <div class="flex min-w-0 flex-col gap-1 text-sm">
          <div class="flex flex-wrap items-center gap-2">
            <span class="break-words font-medium" data-e2e="group-member-name">{label}</span>
            {member.isYou && <Badge text="You" color="blue" />}
          </div>
          {member.name.trim() && member.email && (
            <span class="break-all text-xs text-muted">{member.email}</span>
          )}
          <span class="text-xs text-muted">
            <span data-e2e="group-member-role">{ROLE_TEXT[member.role]}</span>
            {" · joined "}
            <time dateTime={member.joinedAt}>{member.joinedAt.slice(0, 10)}</time>
          </span>
        </div>
      </div>
      {roles.length > 0 && (
        <ScreenForm
          action={GROUP_PATHS.memberRole(groupId, member.userId)}
          pending={pending}
          onSubmit={onRoleChange && (() => onRoleChange(member.userId, role))}
          class="flex flex-wrap items-end gap-2"
        >
          <Field id={selectId} label={`Role of ${label}`}>
            <Select
              name="role"
              data-e2e="group-member-role-select"
              value={String(role)}
              options={[member.role, ...roles]
                .sort((a, b) => a - b)
                .map((value) => ({ value, label: ROLE_TEXT[value] }))}
              onChange={(event) => setRole(Number(event.currentTarget.value) as GroupRole)}
            />
          </Field>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            data-e2e="group-member-role-save"
            busy={pending}
            busyLabel="Saving..."
          >
            Change role
          </Button>
        </ScreenForm>
      )}
      {removable && (
        <details data-e2e="group-member-remove-details">
          <summary class="cursor-pointer text-sm font-medium">Remove {label}...</summary>
          <div class="mt-3">
            <ScreenForm
              action={GROUP_PATHS.memberRemove(groupId, member.userId)}
              pending={pending}
              onSubmit={onRemove && (() => onRemove(member.userId))}
            >
              <Stack>
                <p class="text-sm">
                  Remove {label}{" "}
                  from this group? They lose access right away, on every device. What they wrote
                  stays in the group. If this is their only group, they get a new empty one named
                  "Personal".
                </p>
                <div>
                  <Button
                    type="submit"
                    variant="danger"
                    size="sm"
                    data-e2e="group-member-remove"
                    busy={pending}
                    busyLabel="Removing..."
                  >
                    Remove member
                  </Button>
                </div>
              </Stack>
            </ScreenForm>
          </div>
        </details>
      )}
      <div ref={message} tabIndex={-1} data-e2e="group-member-error">
        <ErrorState message={error} />
      </div>
    </li>
  )
}

export interface GroupLeaveSectionProps {
  groupId: string
  groupName: string
  /** The role of the person looking. The owner cannot leave; everyone else can. */
  role: GroupRole
  /** This is the person's only group, so they cannot leave it: the page says why. */
  isLastGroup?: boolean
  /** A leave is in flight. */
  leaving?: boolean
  /** Why the leave was refused, or `null`. */
  error?: string | null
  /** Leaves the group. A form that posts nothing to `GROUP_PATHS.leave`. */
  onLeave?: () => void
}

/** Leaving a group: for every member but the owner, and never from the person's only group. */
export function GroupLeaveSection(
  { groupId, groupName, role, isLastGroup = false, leaving = false, error = null, onLeave }:
    GroupLeaveSectionProps,
): JSX.Element {
  const message = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (error) message.current?.focus()
  }, [error])
  const errorBox = (
    <div ref={message} tabIndex={-1} data-e2e="group-leave-error">
      <ErrorState message={error} />
    </div>
  )

  return (
    <section aria-labelledby="group-leave" data-e2e="group-section-leave">
      <Card>
        <CardBody>
          <Stack>
            <h2 id="group-leave" class="text-base font-semibold">Leave group</h2>
            {!canLeave(role)
              ? (
                <p class="text-sm" data-e2e="group-leave-why">
                  You own this group, so you cannot leave it.
                </p>
              )
              : isLastGroup
              ? (
                <>
                  <p id="group-leave-why" class="text-sm" data-e2e="group-leave-why">
                    This is your only group, so you cannot leave it. Create or join another group
                    first.
                  </p>
                  {errorBox}
                  <div>
                    <Button
                      type="button"
                      variant="danger"
                      disabled
                      aria-describedby="group-leave-why"
                      data-e2e="group-leave"
                    >
                      Leave group
                    </Button>
                  </div>
                </>
              )
              : (
                <details data-e2e="group-leave-details" open={error !== null}>
                  <summary class="cursor-pointer text-sm font-medium">Leave this group...</summary>
                  <div class="mt-3">
                    <ScreenForm
                      action={GROUP_PATHS.leave(groupId)}
                      pending={leaving}
                      onSubmit={onLeave}
                    >
                      <Stack>
                        <p class="text-sm" data-e2e="group-leave-confirmation">
                          Leave "{groupName}"? You lose access right away, on every device. What you
                          wrote stays in the group. To come back, someone must add you again.
                        </p>
                        {errorBox}
                        <div>
                          <Button
                            type="submit"
                            variant="danger"
                            data-e2e="group-leave"
                            busy={leaving}
                            busyLabel="Leaving..."
                          >
                            Leave group
                          </Button>
                        </div>
                      </Stack>
                    </ScreenForm>
                  </div>
                </details>
              )}
          </Stack>
        </CardBody>
      </Card>
    </section>
  )
}
