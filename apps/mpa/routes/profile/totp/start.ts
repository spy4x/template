import { errorMessage, isOk, isRecord } from "../../../api.ts"
import { readForm } from "../../../forms.ts"
import { renderProfile } from "../../../profile.tsx"
import { define } from "../../../utils.ts"

/**
 * Starts connecting an authenticator app. The QR code and secret exist only in this answer, so the
 * profile is rendered right here, not after a redirect.
 */
export const handler = define.handlers({
  async POST(ctx) {
    await readForm(ctx.req)
    const answer = await ctx.state.api.call("POST", "/api/auth/totp/connect/start")
    const body = answer.body
    if (
      isOk(answer) && isRecord(body) && typeof body.qrcode === "string" &&
      typeof body.secret === "string"
    ) {
      return renderProfile(ctx, { enrolment: { qrcode: body.qrcode, secret: body.secret } })
    }
    return renderProfile(ctx, {
      errors: { profile: errorMessage(answer, "Failed to start 2FA") },
      status: isOk(answer) ? 502 : answer.status,
    })
  },
})
