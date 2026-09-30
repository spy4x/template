import type { FreshContext } from "fresh"
import { GroupsScreen } from "@ui/groups-screen.tsx"
import { errorMessage, isOk } from "../../api.ts"
import { API_BODIES, readForm } from "../../forms.ts"
import { listGroups } from "../../groups.ts"
import { Frame, readSession, signInPath } from "../../session.tsx"
import { define, type State } from "../../utils.ts"

/** The groups page: `GET` lists the person's groups, `POST` creates a shared one. */
export const handler = define.handlers({
  GET: (ctx) => renderGroups(ctx),
  async POST(ctx) {
    const form = await readForm(ctx.req)
    const body = API_BODIES.groupCreate(form)
    const answer = await ctx.state.api.call("POST", "/api/groups", body)
    if (isOk(answer)) return ctx.redirect("/groups", 303)
    return renderGroups(ctx, {
      draftId: body.id,
      name: body.name,
      error: errorMessage(answer, "Group creation failed"),
      status: answer.status,
    })
  },
})

/**
 * The groups page. A refused create keeps the typed name and the id it was sent with, so sending
 * it again cannot create the group twice.
 */
async function renderGroups(
  ctx: FreshContext<State>,
  { draftId = crypto.randomUUID(), name = "", error = null, status = 200 }: {
    draftId?: string
    name?: string
    error?: string | null
    status?: number
  } = {},
): Promise<Response> {
  const session = await readSession(ctx.state.api)
  if (!session.user) return ctx.redirect(signInPath(session), 303)
  const page = await listGroups(ctx.state.api)
  return ctx.render(
    <Frame session={session} path={ctx.url.pathname}>
      <GroupsScreen
        groups={page?.groups ?? []}
        draftId={draftId}
        name={name}
        creating={false}
        loading={false}
        error={error ?? (page ? null : "The groups could not be read")}
      />
    </Frame>,
    { status },
  )
}
