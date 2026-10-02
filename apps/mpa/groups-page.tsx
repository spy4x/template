import type { FreshContext } from "fresh"
import { GroupsScreen } from "@ui/groups-screen.tsx"
import { MyInvitationsSection, type MyInvitationsSectionProps } from "@ui/group-invitations.tsx"
import { readMyInvitations } from "./invitations.tsx"
import { listGroups, readDeleted } from "./groups.ts"
import { Frame, readSession, signInPath } from "./session.tsx"
import type { State } from "./utils.ts"

/**
 * The groups page. A refused create keeps the typed name and the id it was sent with, so sending
 * it again cannot create the group twice; a refused restore shows its reason above the deleted
 * groups.
 */
export async function renderGroups(
  ctx: FreshContext<State>,
  {
    draftId = crypto.randomUUID(),
    name = "",
    error = null,
    restoreError = null,
    answerError = null,
    status = 200,
  }: {
    draftId?: string
    name?: string
    error?: string | null
    restoreError?: string | null
    /** Why an answer to an invitation in the list was refused, shown under it. */
    answerError?: MyInvitationsSectionProps["answerError"]
    status?: number
  } = {},
): Promise<Response> {
  const session = await readSession(ctx.state.api)
  if (!session.user) return ctx.redirect(signInPath(session, ctx.req), 303)
  const [page, deleted, invitations] = await Promise.all([
    listGroups(ctx.state.api),
    readDeleted(ctx.state.api),
    readMyInvitations(ctx.state.api),
  ])
  return ctx.render(
    <Frame session={session} path={ctx.url.pathname}>
      <GroupsScreen
        groups={page?.groups ?? []}
        deleted={deleted}
        selectedId={session.picker?.selectedId ?? null}
        draftId={draftId}
        name={name}
        creating={false}
        loading={false}
        error={error ?? (page ? null : "The groups could not be read")}
        restoreError={restoreError}
        invitations={<MyInvitationsSection invitations={invitations} answerError={answerError} />}
      />
    </Frame>,
    { status },
  )
}
