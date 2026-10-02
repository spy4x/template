import { SCREEN_PATHS } from "@ui/progressive.tsx"
import { errorMessage, isOk } from "../../api.ts"
import { API_BODIES, readForm } from "../../forms.ts"
import { renderGroups } from "../../groups-page.tsx"
import { renderInvitation } from "../../invitations.tsx"
import { define } from "../../utils.ts"

/**
 * Declines an invitation (`POST /api/invitations/decline`), then shows the groups page. A refusal
 * shows on the page the person answered from.
 */
export const handler = define.handlers({
  async POST(ctx) {
    const body = API_BODIES.invitationAnswer(await readForm(ctx.req))
    const answer = await ctx.state.api.call("POST", "/api/invitations/decline", body)
    if (isOk(answer)) return ctx.redirect(SCREEN_PATHS.groups, 303)
    const message = errorMessage(answer, "The invitation could not be declined")
    return "token" in body
      ? renderInvitation(ctx, body.token, { answerError: message, status: answer.status })
      : renderGroups(ctx, {
        answerError: { invitationId: body.invitationId, message },
        status: answer.status,
      })
  },
})
