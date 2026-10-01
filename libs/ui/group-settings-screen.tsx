import type { JSX } from "preact"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { Card, CardBody } from "@spy4x/preact-ui/card"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { Link } from "@spy4x/preact-ui/link"
import { Stack } from "@spy4x/preact-ui/layout"
import { KIND_TEXT, ROLE_TEXT } from "./groups-screen.tsx"
import type { GroupRow } from "./groups-screen.tsx"
import { FORM_ACTIONS, type Navigate, SCREEN_PATHS, ScreenForm } from "./progressive.tsx"

export interface GroupSettingsScreenProps {
  /** The group, or `null` while it is read or when the person has no such group. */
  group: GroupRow | null
  /** Whether this group is the one the notes show now. */
  selected: boolean
  /** The group is being read: an unknown group is not "missing" yet. */
  loading: boolean
  /** Follows a link without a page load; without it every link is an ordinary one. */
  navigate?: Navigate
  /**
   * Opens the group's notes: selects the group, then shows `/notes`. A form that posts
   * `{ groupId }` to `FORM_ACTIONS.groupSelect`; with this callback the app takes the submit over.
   */
  onOpen?: (groupId: string) => void
}

/**
 * The page of one group's settings, in sections that each carry their own heading. A section shows
 * only what the person's role allows: today the page has General, which every member may read and
 * nobody edits, because the API has no way to change a group yet. Members, invitations, ownership,
 * moving data and leaving or deleting add their sections here, each guarded by the role that may
 * use it.
 */
export function GroupSettingsScreen(
  { group, selected, loading, navigate, onOpen }: GroupSettingsScreenProps,
): JSX.Element {
  const back = (
    <Link href={SCREEN_PATHS.groups} navigate={navigate} class="pc-link text-sm">
      Back to groups
    </Link>
  )
  if (!group) {
    return (
      <Stack gap="lg">
        {back}
        <EmptyState
          headingLevel={1}
          title={loading ? "Loading the group..." : "This group does not exist."}
          description={loading ? undefined : "It may have been deleted, or you are not a member."}
        />
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
                <dt class="text-muted">Type</dt>
                <dd>{KIND_TEXT[group.kind]}</dd>
                <dt class="text-muted">Your role</dt>
                <dd data-e2e="group-general-role">{ROLE_TEXT[group.role]}</dd>
              </dl>
            </Stack>
          </CardBody>
        </Card>
      </section>
    </Stack>
  )
}
