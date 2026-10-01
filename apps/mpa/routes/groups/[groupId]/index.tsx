import { GroupSettingsScreen } from "@ui/group-settings-screen.tsx"
import { readGroup } from "../../../groups.ts"
import { Frame, readSession, signInPath } from "../../../session.tsx"
import { define } from "../../../utils.ts"

/** One group's settings page: `GET` shows the group the person belongs to. */
export const handler = define.handlers({
  async GET(ctx) {
    const session = await readSession(ctx.state.api)
    if (!session.user) return ctx.redirect(signInPath(session), 303)
    const { groupId } = ctx.params
    const group = await readGroup(ctx.state.api, groupId)
    return ctx.render(
      <Frame session={session} path={ctx.url.pathname}>
        <GroupSettingsScreen
          group={group}
          selected={session.picker?.selectedId === groupId}
          loading={false}
        />
      </Frame>,
      { status: group ? 200 : 404 },
    )
  },
})
