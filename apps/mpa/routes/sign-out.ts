import { SCREEN_PATHS } from "@ui/progressive.tsx"
import { errorMessage, isOk } from "../api.ts"
import { define } from "../utils.ts"

/** Signs the session out at the API, which clears the cookie, and goes to sign-in. */
export const handler = define.handlers({
  async POST(ctx) {
    const answer = await ctx.state.api.call("POST", "/api/auth/sign-out")
    if (!isOk(answer)) {
      return new Response(errorMessage(answer, "Sign out failed"), { status: answer.status })
    }
    return ctx.redirect(SCREEN_PATHS.signIn, 303)
  },
})
