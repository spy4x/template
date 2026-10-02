import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { Card, CardBody } from "@spy4x/preact-ui/card"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Link } from "@spy4x/preact-ui/link"
import { Stack } from "@spy4x/preact-ui/layout"
import { canDelete, canRename, GROUP_RESTORE_DAYS } from "@domain/groups"
import { ROLE_TEXT } from "./groups-screen.tsx"
import type { GroupRow } from "./groups-screen.tsx"
import {
  FORM_ACTIONS,
  GROUP_PATHS,
  type Navigate,
  SCREEN_PATHS,
  ScreenForm,
} from "./progressive.tsx"

export interface GroupSettingsScreenProps {
  /** The group, or `null` while it is read or when the person has no such group. */
  group: GroupRow | null
  /** Whether this group is the one the notes show now. */
  selected: boolean
  /** The group is being read: an unknown group is not "missing" yet. */
  loading: boolean
  /** Why the group could not be read, or `null`. Shown instead of "loading" or "missing". */
  error?: string | null
  /** Follows a link without a page load; without it every link is an ordinary one. */
  navigate?: Navigate
  /**
   * Opens the group's notes: selects the group, then shows `/notes`. A form that posts
   * `{ groupId }` to `FORM_ACTIONS.groupSelect`; with this callback the app takes the submit over.
   */
  onOpen?: (groupId: string) => void
  /**
   * What the person has typed as the new name; the group's own name until they type. Only an admin
   * or the owner sees the rename form.
   */
  name?: string
  onNameChange?: (name: string) => void
  /** A rename is in flight. */
  renaming?: boolean
  /** Why the rename was refused, shown under the name field, or `null`. */
  renameError?: string | null
  /** Renames the group to `name`. A form that posts `{ name }` to `GROUP_PATHS.rename`. */
  onRename?: () => void
  /**
   * This is the only group the person has, so it cannot be deleted: the delete control is disabled
   * and the page says why. The server refuses it too.
   */
  isLastGroup?: boolean
  /** A delete is in flight. */
  deleting?: boolean
  /** Why the delete was refused, shown in the delete section, or `null`. */
  deleteError?: string | null
  /** Deletes the group. A form that posts nothing to `GROUP_PATHS.delete`. */
  onDelete?: () => void
}

/**
 * The page of one group's settings, in sections that each carry their own heading. A section shows
 * only what the person's role allows: General is read by every member, and an admin or the owner
 * can rename the group there; the delete section is the owner's alone. Members, invitations,
 * ownership, moving data and leaving add their sections here, each guarded by the role that may
 * use it.
 */
export function GroupSettingsScreen(
  {
    group,
    selected,
    loading,
    error = null,
    navigate,
    onOpen,
    name,
    onNameChange,
    renaming = false,
    renameError = null,
    onRename,
    isLastGroup = false,
    deleting = false,
    deleteError = null,
    onDelete,
  }: GroupSettingsScreenProps,
): JSX.Element {
  const nameInput = useRef<HTMLInputElement>(null)
  // A refused rename lands the person on the field to fix.
  useEffect(() => {
    if (renameError) nameInput.current?.focus()
  }, [renameError])
  // A refused delete has no field to fix, so focus lands on the message, which stays where the
  // person pressed the button.
  const deleteMessage = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (deleteError) deleteMessage.current?.focus()
  }, [deleteError])

  const back = (
    <Link href={SCREEN_PATHS.groups} navigate={navigate} class="pc-link text-sm">
      Back to groups
    </Link>
  )
  if (!group) {
    return (
      <Stack gap="lg">
        {back}
        {error ? <ErrorState message={error} /> : (
          <EmptyState
            headingLevel={1}
            title={loading ? "Loading the group..." : "This group does not exist."}
            description={loading ? undefined : "It may have been deleted, or you are not a member."}
          />
        )}
      </Stack>
    )
  }
  return (
    <Stack gap="lg">
      {back}
      <header class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <h1 class="break-words text-xl font-semibold" data-e2e="group-settings-name">
            {group.name}
          </h1>
          {selected && <Badge text="Selected" color="green" />}
        </div>
        <ScreenForm
          action={FORM_ACTIONS.groupSelect}
          onSubmit={onOpen && (() => onOpen(group.id))}
        >
          <input type="hidden" name="groupId" value={group.id} />
          <Button type="submit" variant="outline" size="sm" data-e2e="group-open">
            Open notes
          </Button>
        </ScreenForm>
      </header>

      <section aria-labelledby="group-general" data-e2e="group-section-general">
        <Card>
          <CardBody>
            <Stack>
              <h2 id="group-general" class="text-base font-semibold">General</h2>
              <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt class="text-muted">Name</dt>
                <dd class="min-w-0 break-words" data-e2e="group-general-name">{group.name}</dd>
                <dt class="text-muted">Your role</dt>
                <dd data-e2e="group-general-role">{ROLE_TEXT[group.role]}</dd>
              </dl>
              {canRename(group.role) && (
                <ScreenForm
                  action={GROUP_PATHS.rename(group.id)}
                  pending={renaming}
                  onSubmit={onRename}
                >
                  <Stack>
                    <Field id="group-rename-name" label="New name" error={renameError} required>
                      <Input
                        ref={nameInput}
                        data-e2e="group-rename-name"
                        name="name"
                        autocomplete="off"
                        maxLength={100}
                        value={name ?? group.name}
                        onInput={(e) => onNameChange?.(e.currentTarget.value)}
                        required
                      />
                    </Field>
                    <div>
                      <Button
                        type="submit"
                        data-e2e="group-rename"
                        busy={renaming}
                        busyLabel="Renaming..."
                      >
                        Rename
                      </Button>
                    </div>
                  </Stack>
                </ScreenForm>
              )}
            </Stack>
          </CardBody>
        </Card>
      </section>

      {canDelete(group.role) && (
        <section aria-labelledby="group-danger" data-e2e="group-section-danger">
          <Card>
            <CardBody>
              <Stack>
                <h2 id="group-danger" class="text-base font-semibold">Delete group</h2>
                {isLastGroup
                  ? (
                    <>
                      <p id="group-delete-why" class="text-sm" data-e2e="group-delete-why">
                        This is your only group, so it cannot be deleted. Create another group
                        first.
                      </p>
                      <div ref={deleteMessage} tabIndex={-1} data-e2e="group-delete-error">
                        <ErrorState message={deleteError} />
                      </div>
                      <div>
                        <Button
                          type="button"
                          variant="danger"
                          disabled
                          aria-describedby="group-delete-why"
                          data-e2e="group-delete"
                        >
                          Delete group
                        </Button>
                      </div>
                    </>
                  )
                  : (
                    <details data-e2e="group-delete-details" open={deleteError !== null}>
                      <summary class="cursor-pointer text-sm font-medium">
                        Delete this group...
                      </summary>
                      <div class="mt-3">
                        <ScreenForm
                          action={GROUP_PATHS.delete(group.id)}
                          pending={deleting}
                          onSubmit={onDelete}
                        >
                          <Stack>
                            <p class="text-sm" data-e2e="group-delete-confirmation">
                              Delete "{group.name}"? It disappears for every member right away, with
                              all its notes. Members who have it open are switched to another of
                              their groups, and anyone left with no group gets a new empty one named
                              "Personal". You can restore it from the Groups page for{" "}
                              {GROUP_RESTORE_DAYS}{" "}
                              days. After that it and all its notes are deleted for good and cannot
                              be recovered.
                            </p>
                            <div ref={deleteMessage} tabIndex={-1} data-e2e="group-delete-error">
                              <ErrorState message={deleteError} />
                            </div>
                            <div>
                              <Button
                                type="submit"
                                variant="danger"
                                data-e2e="group-delete"
                                busy={deleting}
                                busyLabel="Deleting..."
                              >
                                Delete group
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
      )}
    </Stack>
  )
}
