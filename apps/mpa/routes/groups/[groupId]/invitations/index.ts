import { EMPTY_INVITATION_DRAFT } from "@ui/group-invitations.tsx"
import { invitationPagePath } from "@ui/progressive.tsx"
import type { InvitationErrorCode } from "@domain/groups"
import { errorCode, errorMessage, isOk, isRecord, planRefusalOf } from "../../../../api.ts"
import { API_BODIES, readForm } from "../../../../forms.ts"
import { renderGroupSettings } from "../../../../group-settings.tsx"
import { define } from "../../../../utils.ts"

/**
 * Creates an invitation (`POST /api/groups/:groupId/invitations`). The answer is the settings page
 * with the new link drawn this once, not a redirect: only the link's hash is stored, so a page read
 * after a redirect could not show it. A refusal keeps what the person filled in.
 */
export const handler = define.handlers({
  async POST(ctx) {
    const { groupId } = ctx.params
    const body = API_BODIES.invitationCreate(await readForm(ctx.req))
    const answer = await ctx.state.api.call(
      "POST",
      `/api/groups/${encodeURIComponent(groupId)}/invitations`,
      body,
    )
    if (isOk(answer) && isRecord(answer.body) && typeof answer.body.token === "string") {
      return renderGroupSettings(ctx, {
        created: {
          link: new URL(invitationPagePath(answer.body.token), ctx.state.webAppOrigin).href,
          mailAsked: body.sendEmail,
          mailSent: answer.body.mailSent === true,
        },
      })
    }
    const plan = planRefusalOf(answer)
    const message = errorMessage(answer, "The invitation could not be created")
    // A create refused for want of the price confirmation shows its message at the confirmation.
    const seatRefused = errorCode(answer) ===
      ("SEAT_PRICE_NOT_ACCEPTED" satisfies InvitationErrorCode)
    const fallback = EMPTY_INVITATION_DRAFT
    return renderGroupSettings(ctx, {
      // A value the API refused as not a number goes back as the default; the message says why.
      invitationDraft: {
        role: typeof body.role === "number" ? body.role : fallback.role,
        expiresInDays: typeof body.expiresInDays === "number"
          ? body.expiresInDays
          : fallback.expiresInDays,
        maxUses: typeof body.maxUses === "number" ? body.maxUses : fallback.maxUses,
        email: body.email,
        sendEmail: body.sendEmail,
      },
      createError: plan || seatRefused ? null : message,
      createRefusal: plan,
      acceptSeatPrice: body.acceptSeatPrice,
      seatPriceError: seatRefused ? message : null,
      status: answer.status,
    })
  },
})
