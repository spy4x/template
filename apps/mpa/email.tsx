import type { FreshContext } from "fresh"
import {
  EMAIL_FAILURES,
  type EmailMessages,
  EmailScreen,
  EmailUnavailable,
  type EmailValues,
} from "@ui/email-screen.tsx"
import { SCREEN_PATHS } from "@ui/progressive.tsx"
import { type ApiAnswer, errorMessage, isOk, isRecord } from "./api.ts"
import { API_BODIES, readForm } from "./forms.ts"
import { Frame, readSession, signInPath } from "./session.tsx"
import { define, type State } from "./utils.ts"

const NO_MESSAGES: EmailMessages = { verify: null, send: null, change: null }

/**
 * The e-mail page. `errors` and `notices` carry what the API said about the form just posted;
 * `values` keeps the new address that was refused, never a password.
 */
async function renderEmail(
  ctx: FreshContext<State>,
  { errors = {}, notices = {}, values = {}, answer }: {
    errors?: Partial<EmailMessages>
    notices?: Partial<Pick<EmailMessages, "send" | "change">>
    values?: Partial<EmailValues>
    /** The API answer the page reports: its status and `Retry-After` carry over. */
    answer?: ApiAnswer
  } = {},
): Promise<Response> {
  const session = await readSession(ctx.state.api)
  if (!session.user) return ctx.redirect(signInPath(session), 303)
  if (!session.email) {
    return ctx.render(
      <Frame session={session} path={SCREEN_PATHS.email}>
        <EmailUnavailable />
      </Frame>,
      { status: 502 },
    )
  }
  return ctx.render(
    <Frame session={session} path={SCREEN_PATHS.email}>
      <EmailScreen
        status={session.email}
        values={{ code: "", email: "", password: "", ...values }}
        onValueChange={() => {}}
        errors={{ ...NO_MESSAGES, ...errors }}
        notices={{ send: null, change: null, ...notices }}
        pending={{ verify: false, send: false, change: false }}
      />
    </Frame>,
    {
      status: answer && !isOk(answer) ? answer.status : 200,
      headers: answer?.retryAfter ? { "retry-after": answer.retryAfter } : undefined,
    },
  )
}

/** The API's message on a success, such as "a code is on its way". */
function successMessage(answer: ApiAnswer): string | null {
  return isRecord(answer.body) && typeof answer.body.message === "string"
    ? answer.body.message
    : null
}

/** `GET /email`: the page. */
export const emailPageHandlers = define.handlers({
  GET: (ctx) => renderEmail(ctx),
})

/** `POST /email/verify`: checks the code, then shows the page as it now stands. */
export const emailVerifyHandlers = define.handlers({
  async POST(ctx) {
    const body = API_BODIES.emailVerify(await readForm(ctx.req))
    const answer = await ctx.state.api.call("POST", "/api/auth/email/verify", body)
    // A changed address comes with a new session cookie, which the redirect hands the browser.
    if (isOk(answer)) return ctx.redirect(SCREEN_PATHS.email, 303)
    return renderEmail(ctx, {
      errors: { verify: errorMessage(answer, EMAIL_FAILURES.verify) },
      answer,
    })
  },
})

/** `POST /email/send`: asks for a new code and says it is on its way. */
export const emailSendHandlers = define.handlers({
  async POST(ctx) {
    await readForm(ctx.req)
    const answer = await ctx.state.api.call("POST", "/api/auth/email/send")
    if (isOk(answer)) return renderEmail(ctx, { notices: { send: successMessage(answer) } })
    return renderEmail(ctx, { errors: { send: errorMessage(answer, EMAIL_FAILURES.send) }, answer })
  },
})

/** `POST /email/change`: asks to move to a new address, which waits for its code. */
export const emailChangeHandlers = define.handlers({
  async POST(ctx) {
    const body = API_BODIES.emailChange(await readForm(ctx.req))
    const answer = await ctx.state.api.call("POST", "/api/auth/email/change", body)
    if (isOk(answer)) return renderEmail(ctx, { notices: { change: successMessage(answer) } })
    return renderEmail(ctx, {
      errors: { change: errorMessage(answer, EMAIL_FAILURES.change) },
      values: { email: body.email },
      answer,
    })
  },
})
