import { NOTE_PATHS } from "@ui/progressive.tsx"
import { errorMessage, isOk, planRefusalOf } from "../../api.ts"
import { API_BODIES, readForm } from "../../forms.ts"
import { renderGroups } from "../../groups-page.tsx"
import { renderInvitation } from "../../invitations.tsx"
import { define } from "../../utils.ts"

/**
 * Accepts an invitation (`POST /api/invitations/accept`) by a link's token or by the id of one sent
 * to the person's address. The API selects the joined group, so the notes open next. A refusal
 * shows on the page the person answered from: the invitation page, or the groups page.
 */
export const handler = define.handlers({
  async POST(ctx) {
    const body = API_BODIES.invitationAnswer(await readForm(ctx.req))
    const answer = await ctx.state.api.call("POST", "/api/invitations/accept", body)
    if (isOk(answer)) return ctx.redirect(NOTE_PATHS.list, 303)
    const message = errorMessage(answer, "The invitation could not be accepted")
    const plan = planRefusalOf(answer)
    return "token" in body
      ? renderInvitation(ctx, body.token, {
        answerError: plan ? null : message,
        answerRefusal: plan,
        status: answer.status,
      })
      : renderGroups(ctx, {
        answerError: { invitationId: body.invitationId, message, plan },
        status: answer.status,
      })
  },
})
