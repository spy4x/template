import type { JSX } from "preact"
import { Button } from "@spy4x/preact-ui/button"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { timeAgo } from "@spy4x/platform/universal/time"
import { type ActivityEvent, describeActivity } from "@domain/groups"
import { PageHeader } from "./page-header.tsx"
import { GROUP_PATHS, type Navigate } from "./progressive.tsx"

/** One event as the API sends it: `at` is an ISO timestamp. */
export type ActivityRow = Omit<ActivityEvent, "at"> & { at: string }

/** The group whose activity is shown. */
export interface ActivityGroup {
  id: string
  name: string
}

export interface GroupActivityScreenProps {
  /** `null` while the group is not known yet (loading), or when the person is not a member. */
  group: ActivityGroup | null
  /** The newest events first; a later page is added at the end. */
  events: readonly ActivityRow[]
  loading: boolean
  /** A page after the first is on its way. */
  loadingMore?: boolean
  /** More events exist than the list shows. */
  hasMore?: boolean
  /** Reads the next page. Left out, the list offers no "Load more". */
  onLoadMore?: () => void
  /** The error of the read, such as an offline server. */
  error: string | null
  /** The person is a member, but an editor or a viewer: the log is for admins and the owner. */
  forbidden?: boolean
  navigate?: Navigate
}

/**
 * A group's activity log: one sentence per event ("Ada moved 3 notes to Family"), when it
 * happened, and a link to the note while it is still in the group. The log pages back in time with
 * "Load more". Only admins and the owner see it; the server refuses everyone else too.
 */
export function GroupActivityScreen(props: GroupActivityScreenProps): JSX.Element {
  const { group, events, navigate } = props
  const back = group
    ? { href: GROUP_PATHS.settings(group.id), label: "Back to group settings" }
    : undefined
  return (
    <div class="mx-auto w-full max-w-3xl">
      <Stack gap="lg">
        <PageHeader
          title="Activity"
          subtitle={group?.name}
          subtitleDataE2E="activity-group"
          back={back}
          navigate={navigate}
        />
        {!group
          ? (
            <EmptyState
              headingLevel={2}
              title={props.loading ? "Loading the group..." : "This group was not found."}
              action={!props.loading && (
                <Button href="/groups" navigate={navigate} variant="outline">Back to groups</Button>
              )}
            />
          )
          : props.forbidden
          ? (
            <div data-e2e="activity-forbidden">
              <EmptyState
                headingLevel={2}
                title="Only admins and the owner can see the activity."
                description="Ask an admin if you need to know what changed."
              />
            </div>
          )
          : (
            <>
              <ErrorState message={props.error} />
              {events.length === 0
                ? (
                  !props.error && (
                    <EmptyState
                      headingLevel={2}
                      title={props.loading
                        ? "Loading the activity..."
                        : "Nothing has happened yet."}
                      description={props.loading
                        ? undefined
                        : "Changes to the group and its notes show up here."}
                    />
                  )
                )
                : (
                  <ul
                    class="divide-y divide-subtle overflow-hidden rounded-lg border border-subtle bg-surface"
                    data-e2e="activity-list"
                  >
                    {events.map((event) => (
                      <ActivityItem
                        key={event.id}
                        event={event}
                        groupId={group.id}
                        navigate={navigate}
                      />
                    ))}
                  </ul>
                )}
              {props.hasMore && props.onLoadMore && (
                <div class="flex justify-center">
                  <Button
                    variant="outline"
                    class="min-h-11 sm:min-h-9"
                    disabled={props.loadingMore}
                    onClick={props.onLoadMore}
                    data-e2e="activity-more"
                  >
                    {props.loadingMore ? "Loading..." : "Load more"}
                  </Button>
                </div>
              )}
            </>
          )}
      </Stack>
    </div>
  )
}

function ActivityItem(
  { event, groupId, navigate }: { event: ActivityRow; groupId: string; navigate?: Navigate },
): JSX.Element {
  const note = event.entity?.type === "note" && event.entity.exists ? event.entity.id : null
  return (
    <li class="flex min-h-11 items-baseline gap-3 px-4 py-3" data-e2e={`activity-${event.id}`}>
      <p class="min-w-0 flex-1 text-sm" data-e2e="activity-text">
        {describeActivity(event)}
        {note && (
          <>
            {" "}
            <Link
              href={GROUP_PATHS.note(groupId, note)}
              navigate={navigate}
              data-e2e="activity-note-link"
            >
              Open the note
            </Link>
          </>
        )}
      </p>
      <time class="shrink-0 text-xs text-muted" dateTime={event.at}>{timeAgo(event.at)}</time>
    </li>
  )
}
