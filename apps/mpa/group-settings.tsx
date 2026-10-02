import type { FreshContext } from "fresh"
import { GroupSettingsScreen } from "@ui/group-settings-screen.tsx"
import type { MemberError } from "@ui/group-members.tsx"
import { readGroup, readMembers } from "./groups.ts"
import { Frame, readSession, signInPath } from "./session.tsx"
import type { State } from "./utils.ts"

/**
 * One group's settings page, for the `GET` and for a refused rename, delete, member change or
 * leave, which shows the refusal where the person acted and keeps what they typed.
 */
export async function renderGroupSettings(
  ctx: FreshContext<State>,
  { name, renameError = null, deleteError = null, memberError = null, leaveError = null, status }: {
    name?: string
    renameError?: string | null
    deleteError?: string | null
    memberError?: MemberError | null
    leaveError?: string | null
    status?: number
  } = {},
): Promise<Response> {
  const session = await readSession(ctx.state.api)
  if (!session.user) return ctx.redirect(signInPath(session, ctx.req), 303)
  const { groupId } = ctx.params
  const [group, members] = await Promise.all([
    readGroup(ctx.state.api, groupId),
    readMembers(ctx.state.api, groupId),
  ])
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
        members={members}
        membersError={members ? null : "The members could not be read"}
        memberError={memberError}
        leaveError={leaveError}
      />
    </Frame>,
    { status: status ?? (group ? 200 : 404) },
  )
}
