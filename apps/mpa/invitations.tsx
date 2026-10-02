import type { FreshContext } from "fresh"
import type { PlanRefusal } from "@domain/billing"
import { canManageInvitations, type GroupRole } from "@domain/groups"
import {
  type InvitationPreviewRow,
  type InvitationRow,
  InvitationScreen,
} from "@ui/group-invitations.tsx"
import { type Api, errorMessage, isOk, isRecord } from "./api.ts"
import { Frame, readSession, signInPath } from "./session.tsx"
import type { State } from "./utils.ts"

/**
 * The page an invitation link opens, for its `GET` and for a refused accept or decline, which shows
 * why under the invitation. A signed-out visitor goes to sign-in with this page as `next`. The
 * token is in the address, so the page tells the browser to send no referrer from it.
 */
export async function renderInvitation(
  ctx: FreshContext<State>,
  token: string,
  { answerError = null, answerRefusal = null, status }: {
    answerError?: string | null
    answerRefusal?: PlanRefusal | null
    status?: number
  } = {},
): Promise<Response> {
  const session = await readSession(ctx.state.api)
  if (!session.user) return ctx.redirect(signInPath(session, ctx.req), 303)
  const answer = await ctx.state.api.call("POST", "/api/invitations/preview", { token })
  const invitation = isOk(answer) && isRecord(answer.body) && isRecord(answer.body.invitation)
    ? answer.body.invitation as unknown as InvitationPreviewRow
    : null
  const response = await ctx.render(
    <Frame session={session} path={ctx.url.pathname}>
      <InvitationScreen
        token={token}
        invitation={invitation}
        loading={false}
        error={invitation ? null : errorMessage(answer, "The invitation could not be read")}
        answerError={answerError}
        answerRefusal={answerRefusal}
      />
    </Frame>,
    { status: status ?? (invitation ? 200 : answer.status) },
  )
  response.headers.set("referrer-policy", "no-referrer")
  return response
}

/** The pending invitations sent to the person's proved address, or none when the read failed. */
export async function readMyInvitations(api: Api): Promise<InvitationPreviewRow[]> {
  const answer = await api.call("GET", "/api/invitations/mine")
  if (!isOk(answer) || !isRecord(answer.body) || !Array.isArray(answer.body.invitations)) return []
  return answer.body.invitations as InvitationPreviewRow[]
}

/**
 * A group's pending invitations, for its owner and admins; `null` with the reason when the read
 * failed, and an empty list without a read for anyone else, who sees no Invitations section.
 */
export async function readGroupInvitations(
  api: Api,
  groupId: string,
  role: GroupRole | undefined,
): Promise<{ invitations: InvitationRow[] | null; error: string | null }> {
  if (role === undefined || !canManageInvitations(role)) return { invitations: [], error: null }
  const answer = await api.call("GET", `/api/groups/${encodeURIComponent(groupId)}/invitations`)
  if (!isOk(answer) || !isRecord(answer.body) || !Array.isArray(answer.body.invitations)) {
    return { invitations: null, error: errorMessage(answer, "The invitations could not be read") }
  }
  return { invitations: answer.body.invitations as InvitationRow[], error: null }
}
