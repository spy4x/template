import type { FreshContext } from "fresh"
import { authFailureMessage, AuthScreen, type AuthScreenKind } from "@ui/auth-screen.tsx"
import { afterSignIn, readNext, SCREEN_PATHS, withNext } from "@ui/progressive.tsx"
import { errorMessage } from "./api.ts"
import { API_BODIES, readForm } from "./forms.ts"
import { Frame, readSession } from "./session.tsx"
import { define, type State } from "./utils.ts"

/** The API call behind each auth form, and how its fields are translated. */
const CALLS: Record<AuthScreenKind, { path: `/api/${string}`; body: (form: FormData) => unknown }> =
  {
    "sign-in": { path: "/api/auth/password/check", body: API_BODIES.signIn },
    "sign-up": { path: "/api/auth/password/sign-up", body: API_BODIES.signUp },
    "one-time-code": { path: "/api/auth/totp/check", body: API_BODIES.oneTimeCode },
  }

/**
 * The page of one auth screen: `GET` shows it, `POST` sends its form to the API. A session that
 * still owes its one-time code goes on to the code page; any other success goes to the page the
 * person asked for (`next`), or the profile without one. A refusal shows the form again with the
 * API's message, status and `Retry-After`.
 *
 * `next` comes from the page's query on `GET` and from the form's hidden field on `POST`, and is
 * checked again on each of them (`readNext`): the code page gets it from the sign-in post's
 * redirect, never from an earlier check.
 */
export function authHandlers(screen: AuthScreenKind) {
  return define.handlers({
    GET: (ctx) => renderAuth(ctx, screen, readNext(ctx.url.searchParams), null, 200),
    async POST(ctx) {
      const form = await readForm(ctx.req)
      const next = readNext(form)
      const call = CALLS[screen]
      const answer = await ctx.state.api.call("POST", call.path, call.body(form))
      if (answer.status === 202) {
        return ctx.redirect(withNext(SCREEN_PATHS.oneTimeCode, next), 303)
      }
      if (answer.status === 200) return ctx.redirect(afterSignIn(next), 303)
      return renderAuth(
        ctx,
        screen,
        next,
        errorMessage(answer, authFailureMessage(screen)),
        answer.status,
        answer.retryAfter,
      )
    },
  })
}

async function renderAuth(
  ctx: FreshContext<State>,
  screen: AuthScreenKind,
  next: string | null,
  error: string | null,
  status: number,
  retryAfter?: string,
): Promise<Response> {
  const session = await readSession(ctx.state.api)
  return ctx.render(
    <Frame session={session} path={ctx.url.pathname}>
      <AuthScreen
        screen={screen}
        isSignedIn={session.user !== null}
        isMfaRequired={session.mfaPending}
        busy={false}
        error={error}
        next={next}
      />
    </Frame>,
    // A locked account or a spent rate limit says when to try again, as the API does.
    { status, headers: retryAfter ? { "retry-after": retryAfter } : undefined },
  )
}
