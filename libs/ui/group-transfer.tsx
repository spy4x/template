import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { Card, CardBody } from "@spy4x/preact-ui/card"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input, Select } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { canTransfer, GroupRole } from "@domain/groups"
import { type GroupMemberRow, memberLabel } from "./group-members.tsx"
import { GROUP_PATHS, ScreenForm } from "./progressive.tsx"

/** What the owner has filled in to hand the group over. */
export interface TransferDraft {
  /** The member who becomes the owner; `null` picks the first one offered. */
  userId: number | null
  /** The group's name, typed to confirm. */
  name: string
  /** The owner's current password. An app keeps it only until the request is sent. */
  password: string
}

export const EMPTY_TRANSFER_DRAFT: TransferDraft = { userId: null, name: "", password: "" }

/** A refused transfer: its message, under the field it is about, or under the form for none. */
export interface TransferError {
  field: "name" | "password" | null
  message: string
}

/** The field an API error code of a transfer is about, so both apps show it in the same place. */
export function transferErrorField(code: string | undefined): TransferError["field"] {
  if (code === "NAME_MISMATCH") return "name"
  if (code === "PASSWORD_INVALID") return "password"
  return null
}

export interface GroupTransferSectionProps {
  groupId: string
  groupName: string
  /** The role of the person looking. Only the owner sees this section. */
  role: GroupRole
  /** The members, oldest first; `null` while they are read. The owner is left out of the picker. */
  members: readonly GroupMemberRow[] | null
  /** The group has a live subscription, which moves with it: the section says so. */
  hasSubscription?: boolean
  draft: TransferDraft
  onDraftChange?: (draft: TransferDraft) => void
  /** A transfer is in flight. */
  transferring?: boolean
  /** Why the transfer was refused, or `null`. */
  error?: TransferError | null
  /**
   * Hands the group to the chosen member. A form that posts `{ userId, name, password }` to
   * `GROUP_PATHS.transfer`; with this callback the app takes the submit over.
   */
  onTransfer?: () => void
}

/**
 * Handing the group to another member, for the owner alone. The owner picks the member, types the
 * group's name and enters their password, as strong a check as a password change. The new owner
 * gets the group; the old one stays as an admin.
 */
export function GroupTransferSection(
  {
    groupId,
    groupName,
    role,
    members,
    hasSubscription = false,
    draft,
    onDraftChange,
    transferring = false,
    error = null,
    onTransfer,
  }: GroupTransferSectionProps,
): JSX.Element | null {
  const nameInput = useRef<HTMLInputElement>(null)
  const passwordInput = useRef<HTMLInputElement>(null)
  const message = useRef<HTMLDivElement>(null)
  // A refused transfer lands the person on the field to fix, or on the message when it names none.
  useEffect(() => {
    if (!error) return
    const target = error.field === "name"
      ? nameInput
      : error.field === "password"
      ? passwordInput
      : message
    target.current?.focus()
  }, [error])

  const candidates = (members ?? []).filter((member) => canTransfer(role, member.role))
  // A draft member who is not offered (none picked yet, or one who left) becomes the first one
  // offered, so the picker, the posted form and the app's draft agree.
  const userId = candidates.some((member) => member.userId === draft.userId)
    ? draft.userId
    : candidates[0]?.userId ?? null
  useEffect(() => {
    if (userId !== draft.userId) onDraftChange?.({ ...draft, userId })
  }, [userId, draft.userId])

  if (role !== GroupRole.OWNER) return null
  const change = (patch: Partial<TransferDraft>) => onDraftChange?.({ ...draft, userId, ...patch })
  const errorOf = (field: TransferError["field"]) => error?.field === field ? error.message : null

  return (
    <section aria-labelledby="group-transfer" data-e2e="group-section-transfer">
      <Card>
        <CardBody>
          <Stack>
            <h2 id="group-transfer" class="text-base font-semibold">Transfer ownership</h2>
            <p class="text-sm text-muted">
              Before you can delete your account, transfer every group you share with others.
            </p>
            {members === null
              ? <p class="text-sm text-muted">Loading the members...</p>
              : candidates.length === 0
              ? (
                <p class="text-sm" data-e2e="group-transfer-nobody">
                  Nobody else is in this group yet. Invite someone first, then hand it to them.
                </p>
              )
              : (
                <details data-e2e="group-transfer-details" open={error !== null}>
                  <summary class="cursor-pointer text-sm font-medium">
                    Transfer ownership...
                  </summary>
                  <div class="mt-3">
                    <ScreenForm
                      action={GROUP_PATHS.transfer(groupId)}
                      pending={transferring}
                      onSubmit={onTransfer}
                    >
                      <Stack>
                        <p class="text-sm" data-e2e="group-transfer-explanation">
                          Hand "{groupName}"{" "}
                          to another member. They become the owner and you become an admin. Only the
                          owner can delete the group, manage its plan or transfer it again.
                          {hasSubscription &&
                            " The subscription moves with the group: the new owner manages it in the billing portal, and the current card is charged until they change it."}
                        </p>
                        <Field id="group-transfer-member" label="New owner">
                          <Select
                            name="userId"
                            data-e2e="group-transfer-member"
                            value={String(userId)}
                            options={candidates.map((member) => ({
                              value: member.userId,
                              label: memberLabel(member),
                            }))}
                            onChange={(e) => change({ userId: Number(e.currentTarget.value) })}
                          />
                        </Field>
                        <Field
                          id="group-transfer-name"
                          label={`Type "${groupName}" to confirm`}
                          error={errorOf("name")}
                          required
                        >
                          <Input
                            ref={nameInput}
                            name="name"
                            data-e2e="group-transfer-name"
                            autocomplete="off"
                            maxLength={200}
                            value={draft.name}
                            onInput={(e) => change({ name: e.currentTarget.value })}
                            required
                          />
                        </Field>
                        <Field
                          id="group-transfer-password"
                          label="Your password"
                          error={errorOf("password")}
                          required
                        >
                          <Input
                            ref={passwordInput}
                            type="password"
                            name="password"
                            data-e2e="group-transfer-password"
                            autocomplete="current-password"
                            maxLength={1024}
                            value={draft.password}
                            onInput={(e) => change({ password: e.currentTarget.value })}
                            required
                          />
                        </Field>
                        <div ref={message} tabIndex={-1} data-e2e="group-transfer-error">
                          <ErrorState
                            message={error && error.field === null ? error.message : null}
                          />
                        </div>
                        <div>
                          <Button
                            type="submit"
                            variant="danger"
                            data-e2e="group-transfer"
                            busy={transferring}
                            busyLabel="Transferring..."
                          >
                            Transfer ownership
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
