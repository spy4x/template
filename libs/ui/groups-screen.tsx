import type { JSX } from "preact"
import { Button } from "@spy4x/preact-ui/button"
import { Card, CardBody, CardHeader } from "@spy4x/preact-ui/card"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { GroupKind, GroupRole } from "@domain/groups"
import { FORM_ACTIONS, ScreenForm } from "./progressive.tsx"

/** One group as the screen shows it. */
export interface GroupRow {
  id: string
  name: string
  kind: GroupKind
  role: GroupRole
}

export interface GroupsScreenProps {
  groups: readonly GroupRow[]
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
  onCreate?: () => void
  /** Reads the list again; without it there is no Refresh button, and a page load refreshes. */
  onRefresh?: () => void
  /**
   * Opens a group's notes: selects the group, then shows `/notes`. A form that posts `{ groupId }`
   * to `FORM_ACTIONS.groupSelect`; with this callback the app takes the submit over.
   */
  onOpen?: (groupId: string) => void
}

const KIND_TEXT: Record<GroupKind, string> = {
  [GroupKind.PERSONAL]: "Personal",
  [GroupKind.SHARED]: "Shared",
}

/** What a role is called on screen. */
export const ROLE_TEXT: Record<GroupRole, string> = {
  [GroupRole.VIEWER]: "Viewer",
  [GroupRole.EDITOR]: "Editor",
  [GroupRole.ADMIN]: "Admin",
  [GroupRole.OWNER]: "Owner",
}

/**
 * The groups page: the groups the person belongs to, each with a form that opens its notes, and a
 * form to create a shared one. The form posts the API's field names to its route; with `onCreate`, the app takes
 * the submit over.
 */
export function GroupsScreen(
  { groups, draftId, name, onNameChange, creating, loading, error, onCreate, onRefresh, onOpen }:
    GroupsScreenProps,
): JSX.Element {
  return (
    <Stack gap="lg">
      <Card>
        <CardHeader>
          <h1 class="text-lg font-semibold">Groups</h1>
        </CardHeader>
        <CardBody>
          <ScreenForm action={FORM_ACTIONS.groupCreate} pending={creating} onSubmit={onCreate}>
            <input type="hidden" name="id" value={draftId} />
            <input type="hidden" name="kind" value={String(GroupKind.SHARED)} />
            <Stack>
              <Field id="group-name" label="New group" required>
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
                  Create group
                </Button>
              </div>
            </Stack>
          </ScreenForm>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Your groups" headingLevel={2} />
        <CardBody>
          <Stack>
            {groups.length === 0
              ? <EmptyState title={loading ? "Loading groups..." : "No groups yet."} />
              : (
                <ul class="flex flex-col gap-2" data-e2e="group-list">
                  {groups.map((group) => (
                    <li
                      key={group.id}
                      class="flex flex-col gap-1 rounded-primary border border-subtle px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                      data-e2e={`group-${group.id}`}
                    >
                      <span class="font-medium" data-e2e="group-item-name">{group.name}</span>
                      <span class="text-xs text-muted">
                        {KIND_TEXT[group.kind]} · {ROLE_TEXT[group.role]}
                      </span>
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
          </Stack>
        </CardBody>
      </Card>
    </Stack>
  )
}
