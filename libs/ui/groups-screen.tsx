import type { JSX } from "preact"
import { Button } from "@spy4x/preact-ui/button"
import { Badge } from "@spy4x/preact-ui/badge"
import { Card, CardBody, CardHeader } from "@spy4x/preact-ui/card"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Link } from "@spy4x/preact-ui/link"
import { Stack } from "@spy4x/preact-ui/layout"
import { GROUP_RESTORE_DAYS, GroupRole } from "@domain/groups"
import { FORM_ACTIONS, GROUP_PATHS, type Navigate, ScreenForm } from "./progressive.tsx"

/** One group as the screen shows it. */
export interface GroupRow {
  id: string
  name: string
  role: GroupRole
}

/** A group its owner deleted and can still restore. */
export interface DeletedGroupRow {
  id: string
  name: string
  /** When it was deleted, as an ISO string. It can be restored for 30 days from then. */
  deletedAt: string
}

export interface GroupsScreenProps {
  groups: readonly GroupRow[]
  /** The groups the person deleted less than 30 days ago and can restore. */
  deleted?: readonly DeletedGroupRow[]
  /** The group the notes show now, or `null` when it is not known yet. */
  selectedId: string | null
  /** Follows a settings link without a page load; without it every link is an ordinary one. */
  navigate?: Navigate
  /**
   * The id the new group is created with, for the form without JavaScript: a form sent twice
   * creates one group. An app that takes the submit over names the id itself.
   */
  draftId?: string
  /** What the person has typed as the new group's name. */
  name: string
  onNameChange?: (name: string) => void
  /** A create is in flight. */
  creating: boolean
  /** The list is being fetched. */
  loading: boolean
  /** The error under the form or the list, or `null`. */
  error: string | null
  /** Why a restore was refused, shown above the deleted groups, or `null`. */
  restoreError?: string | null
  /** Restores a deleted group. A form that posts nothing to `GROUP_PATHS.restore`. */
  onRestore?: (groupId: string) => void
  /** The group being restored, or `null`. */
  restoringId?: string | null
  onCreate?: () => void
  /** Reads the list again; without it there is no Refresh button, and a page load refreshes. */
  onRefresh?: () => void
  /**
   * Opens a group's notes: selects the group, then shows `/notes`. A form that posts `{ groupId }`
   * to `FORM_ACTIONS.groupSelect`; with this callback the app takes the submit over.
   */
  onOpen?: (groupId: string) => void
}

/** What a role is called on screen. */
export const ROLE_TEXT: Record<GroupRole, string> = {
  [GroupRole.VIEWER]: "Viewer",
  [GroupRole.EDITOR]: "Editor",
  [GroupRole.ADMIN]: "Admin",
  [GroupRole.OWNER]: "Owner",
}

/**
 * The groups page: a card for each group the person belongs to, with the person's role, whether it
 * is the selected one, a link to its settings and a form that opens its notes; a form to create a
 * group; and, when the person has deleted groups they can still restore, a list of them with a
 * restore form each. The forms post the API's field names to their routes; with its callback, the
 * app takes a submit over.
 */
export function GroupsScreen(
  {
    groups,
    selectedId,
    navigate,
    draftId,
    name,
    onNameChange,
    creating,
    loading,
    error,
    onCreate,
    onRefresh,
    onOpen,
    deleted = [],
    restoreError = null,
    onRestore,
    restoringId = null,
  }: GroupsScreenProps,
): JSX.Element {
  return (
    <Stack gap="lg">
      <h1 class="text-xl font-semibold">Groups</h1>
      <Card>
        <CardHeader title="New group" headingLevel={2} />
        <CardBody>
          <ScreenForm action={FORM_ACTIONS.groupCreate} pending={creating} onSubmit={onCreate}>
            <input type="hidden" name="id" value={draftId} />
            <Stack>
              <Field id="group-name" label="Name" required>
                <Input
                  data-e2e="group-name"
                  name="name"
                  autocomplete="off"
                  maxLength={100}
                  value={name}
                  onInput={(e) => onNameChange?.(e.currentTarget.value)}
                  required
                />
              </Field>
              <ErrorState message={error} />
              <div>
                <Button
                  type="submit"
                  data-e2e="group-create"
                  busy={creating}
                  busyLabel="Creating..."
                >
                  New group
                </Button>
              </div>
            </Stack>
          </ScreenForm>
        </CardBody>
      </Card>

      <section aria-labelledby="your-groups" class="flex flex-col gap-3">
        <h2 id="your-groups" class="text-base font-semibold">Your groups</h2>
        {groups.length === 0
          ? <EmptyState title={loading ? "Loading groups..." : "No groups yet."} />
          : (
            <ul class="flex flex-col gap-3" data-e2e="group-list">
              {groups.map((group) => (
                <li key={group.id} data-e2e={`group-${group.id}`}>
                  <Card>
                    <CardBody class="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                      <div class="flex min-w-0 flex-col gap-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="break-words font-medium" data-e2e="group-item-name">
                            {group.name}
                          </span>
                          {group.id === selectedId && <Badge text="Selected" color="green" />}
                        </div>
                        <span class="text-xs text-muted">
                          {ROLE_TEXT[group.role]}
                        </span>
                      </div>
                      <div class="flex flex-wrap items-center gap-2">
                        <Link
                          href={GROUP_PATHS.settings(group.id)}
                          navigate={navigate}
                          class="pc-link text-sm"
                          aria-label={`Settings of ${group.name}`}
                          data-e2e="group-settings"
                        >
                          Settings
                        </Link>
                        <ScreenForm
                          action={FORM_ACTIONS.groupSelect}
                          onSubmit={onOpen && (() => onOpen(group.id))}
                        >
                          <input type="hidden" name="groupId" value={group.id} />
                          <Button
                            type="submit"
                            variant="outline"
                            size="sm"
                            aria-label={`Open notes in ${group.name}`}
                            data-e2e="group-open"
                          >
                            Open notes
                          </Button>
                        </ScreenForm>
                      </div>
                    </CardBody>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        {onRefresh && (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-e2e="group-refresh"
              busy={loading}
              busyLabel="Refreshing..."
              onClick={onRefresh}
            >
              Refresh
            </Button>
          </div>
        )}
      </section>

      {(deleted.length > 0 || restoreError) && (
        <section aria-labelledby="deleted-groups" class="flex flex-col gap-3">
          <h2 id="deleted-groups" class="text-base font-semibold">Deleted groups</h2>
          <p class="text-sm text-muted">
            A deleted group and its notes can be restored for {GROUP_RESTORE_DAYS}{" "}
            days. After that they are deleted for good.
          </p>
          <ErrorState message={restoreError} />
          <ul class="flex flex-col gap-3" data-e2e="deleted-group-list">
            {deleted.map((group) => (
              <li key={group.id} data-e2e={`deleted-group-${group.id}`}>
                <Card>
                  <CardBody class="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <div class="flex min-w-0 flex-col gap-1">
                      <span class="break-words font-medium" data-e2e="deleted-group-name">
                        {group.name}
                      </span>
                      <span class="text-xs text-muted">
                        Can be restored until{" "}
                        <time dateTime={restorableUntil(group.deletedAt)}>
                          {restorableUntil(group.deletedAt).slice(0, 10)}
                        </time>
                      </span>
                    </div>
                    <ScreenForm
                      action={GROUP_PATHS.restore(group.id)}
                      pending={restoringId === group.id}
                      onSubmit={onRestore && (() => onRestore(group.id))}
                    >
                      <Button
                        type="submit"
                        variant="outline"
                        size="sm"
                        aria-label={`Restore ${group.name}`}
                        data-e2e="group-restore"
                        busy={restoringId === group.id}
                        busyLabel="Restoring..."
                      >
                        Restore
                      </Button>
                    </ScreenForm>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Stack>
  )
}

/** When a group deleted at `deletedAt` stops being restorable, as an ISO string (UTC). */
function restorableUntil(deletedAt: string): string {
  return new Date(new Date(deletedAt).getTime() + GROUP_RESTORE_DAYS * 24 * 60 * 60_000)
    .toISOString()
}
