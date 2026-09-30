import type { FreshContext } from "fresh"
import type { UserPushTokenPublic } from "@domain/identity"
import {
  PROFILE_FAILURES,
  type ProfileErrors,
  ProfileScreen,
  type ProfileValues,
  type TotpEnrolment,
} from "@ui/profile-screen.tsx"
import { SCREEN_PATHS } from "@ui/progressive.tsx"
import { type ApiAnswer, errorMessage, isOk, isRecord } from "./api.ts"
import { readForm } from "./forms.ts"
import { Frame, readSession } from "./session.tsx"
import { define, type State } from "./utils.ts"

const NO_ERRORS: ProfileErrors = { profile: null, password: null, push: null }

/**
 * The profile page. `values` keeps what the person typed into a form that was refused; `enrolment`
 * shows the QR code of an authenticator app being connected.
 */
export async function renderProfile(
  ctx: FreshContext<State>,
  { errors = {}, values = {}, enrolment = null, status = 200 }: {
    errors?: Partial<ProfileErrors>
    values?: Partial<ProfileValues>
    enrolment?: TotpEnrolment | null
    status?: number
  } = {},
): Promise<Response> {
  const { api } = ctx.state
  const session = await readSession(api)
  const devices = session.user ? await api.call("GET", "/api/push/devices") : null
  const pushDevices = devices && isOk(devices) && isRecord(devices.body) &&
      Array.isArray(devices.body.data)
    ? devices.body.data as UserPushTokenPublic[]
    : []
  return ctx.render(
    <Frame session={session} path={ctx.url.pathname}>
      <ProfileScreen
        user={session.user}
        isMfaRequired={session.mfaPending}
        values={{
          firstName: session.user?.firstName ?? "",
          lastName: session.user?.lastName ?? "",
          currentPassword: "",
          newPassword: "",
          otp: "",
          ...values,
        }}
        onValueChange={() => {}}
        errors={{
          ...NO_ERRORS,
          push: devices && !isOk(devices) ? errorMessage(devices, PROFILE_FAILURES.push) : null,
          ...errors,
        }}
        pending={{ profile: false, password: false, totp: false, push: false }}
        enrolment={enrolment}
        pushDevices={pushDevices}
      />
    </Frame>,
    { status },
  )
}

/**
 * The handler of one profile form: sends its fields to the API, then goes back to the profile, or
 * shows the profile again with the API's message under `errorAt` and what the person typed.
 */
export function profileAction(
  { method, path, body, errorAt, failure, keep = () => ({}) }: {
    method: string
    path: `/api/${string}`
    body?: (form: FormData) => unknown
    errorAt: keyof ProfileErrors
    failure: string
    keep?: (form: FormData) => Partial<ProfileValues>
  },
) {
  return define.handlers({
    async POST(ctx) {
      const form = await readForm(ctx.req)
      const answer: ApiAnswer = await ctx.state.api.call(method, path, body?.(form))
      if (isOk(answer)) return ctx.redirect(SCREEN_PATHS.profile, 303)
      return renderProfile(ctx, {
        errors: { [errorAt]: errorMessage(answer, failure) },
        values: keep(form),
        status: answer.status,
      })
    },
  })
}
