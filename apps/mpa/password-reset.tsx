import type { FreshContext } from "fresh"
import {
  ForgotPasswordScreen,
  PASSWORD_RESET_FAILURES,
  ResetPasswordScreen,
} from "@ui/password-reset-screen.tsx"
import { errorMessage, isRecord } from "./api.ts"
import { API_BODIES, readForm } from "./forms.ts"
import { Frame, readSession } from "./session.tsx"
import { define, type State } from "./utils.ts"

/**
 * The reset pages carry the link's code in their address, so they tell the browser to send no
 * `Referer` from them: the code must not reach another page's request, or a log that records it.
 */
const NO_REFERRER = { "referrer-policy": "no-referrer" }

/** `GET` shows the "forgot password" form; `POST` asks the API for a link and says it is sent. */
export const forgotPasswordHandlers = define.handlers({
  GET: (ctx) => renderForgot(ctx, { email: "", sent: null, error: null, status: 200 }),
  async POST(ctx) {
    const form = await readForm(ctx.req)
    const body = API_BODIES.forgotPassword(form)
    const answer = await ctx.state.api.call("POST", "/api/auth/password/forgot", body)
    if (answer.status === 200) {
      const message = isRecord(answer.body) && typeof answer.body.message === "string"
        ? answer.body.message
        : undefined
      return renderForgot(ctx, { email: "", sent: message ?? "", error: null, status: 200 })
    }
    return renderForgot(ctx, {
      email: body.email,
      sent: null,
      error: errorMessage(answer, PASSWORD_RESET_FAILURES.forgot),
      status: answer.status,
      retryAfter: answer.retryAfter,
    })
  },
})

/**
 * `GET` shows the new-password form for the link's `email` and `code`; `POST` sends all three to
 * the API and says the password is changed.
 */
export const resetPasswordHandlers = define.handlers({
  GET(ctx) {
    const email = ctx.url.searchParams.get("email") ?? ""
    const code = ctx.url.searchParams.get("code") ?? ""
    return renderReset(ctx, { email, code, done: false, error: null, status: 200 })
  },
  async POST(ctx) {
    const form = await readForm(ctx.req)
    const body = API_BODIES.resetPassword(form)
    const answer = await ctx.state.api.call("POST", "/api/auth/password/reset", body)
    if (answer.status === 200) {
      return renderReset(ctx, { ...body, done: true, error: null, status: 200 })
    }
    return renderReset(ctx, {
      ...body,
      done: false,
      error: errorMessage(answer, PASSWORD_RESET_FAILURES.reset),
      status: answer.status,
      retryAfter: answer.retryAfter,
    })
  },
})

async function renderForgot(
  ctx: FreshContext<State>,
  page: {
    email: string
    /** The API's message once a link is requested, `""` for the screen's own wording. */
    sent: string | null
    error: string | null
    status: number
    retryAfter?: string
  },
): Promise<Response> {
  const session = await readSession(ctx.state.api)
  return ctx.render(
    <Frame session={session} path={ctx.url.pathname}>
      <ForgotPasswordScreen
        email={page.email}
        onEmailChange={() => {}}
        sent={page.sent !== null}
        sentMessage={page.sent || undefined}
        error={page.error}
        pending={false}
      />
    </Frame>,
    {
      status: page.status,
      headers: page.retryAfter ? { "retry-after": page.retryAfter } : undefined,
    },
  )
}

async function renderReset(
  ctx: FreshContext<State>,
  page: {
    email: string
    code: string
    done: boolean
    error: string | null
    status: number
    retryAfter?: string
  },
): Promise<Response> {
  const session = await readSession(ctx.state.api)
  return ctx.render(
    <Frame session={session} path={ctx.url.pathname}>
      <ResetPasswordScreen
        email={page.email}
        code={page.code}
        newPassword=""
        onNewPasswordChange={() => {}}
        done={page.done}
        error={page.error}
        pending={false}
      />
    </Frame>,
    {
      status: page.status,
      headers: page.retryAfter ? { ...NO_REFERRER, "retry-after": page.retryAfter } : NO_REFERRER,
    },
  )
}
