import type { ComponentChildren, JSX } from "preact"
import type { EmailStatus, UserMFAStatus } from "@domain/identity"
import { AppFrame, PublicFrame } from "@ui/frame.tsx"
import { EmailBanner } from "@ui/email-screen.tsx"
import type { GroupPickerData } from "@ui/group-picker.tsx"
import { SCREEN_PATHS, withNext } from "@ui/progressive.tsx"
import { type Api, isOk, isRecord } from "./api.ts"
import { readPicker } from "./groups.ts"

/** The signed-in user as the pages show them. */
export interface SessionUser {
  firstName: string
  lastName: string
  mfa: UserMFAStatus
}

/** Who is asking: a user with every factor done, a session that owes its code, or nobody. */
export interface Session {
  user: SessionUser | null
  /** Signed in with the password, the one-time code still owed. */
  mfaPending: boolean
  /** The groups and the selected one, for the side menu; `null` without a user or when unread. */
  picker: GroupPickerData | null
  /** Where the user's address stands, for the banner; `null` without a user or when unread. */
  email: EmailStatus | null
}

/**
 * Asks the API who the request's session belongs to (`GET /api/auth/me`). 401 means nobody; any
 * other failure throws, so an API outage shows an error page instead of a signed-out one.
 */
export async function readSession(api: Api): Promise<Session> {
  const answer = await api.call("GET", "/api/auth/me")
  if (answer.status === 200 && isRecord(answer.body)) {
    const [picker, email] = await Promise.all([readPicker(api), readEmailStatus(api)])
    return { user: answer.body as unknown as SessionUser, mfaPending: false, picker, email }
  }
  if (answer.status === 202) return { user: null, mfaPending: true, picker: null, email: null }
  if (answer.status === 401) return { user: null, mfaPending: false, picker: null, email: null }
  throw new Error(`GET /api/auth/me answered ${answer.status}`)
}

/** Where the user's address stands (`GET /api/auth/email`); `null` when the API did not say. */
export async function readEmailStatus(api: Api): Promise<EmailStatus | null> {
  const answer = await api.call("GET", "/api/auth/email")
  const body = answer.body
  return isOk(answer) && isRecord(body) && typeof body.proven === "boolean"
    ? body as unknown as EmailStatus
    : null
}

/**
 * Where a page for signed-in users sends a session that is not one: to the one-time code when the
 * password step is done, to sign-in otherwise. A `GET` carries its own address as `next`, so
 * sign-in returns there; a post does not, since its address is an action, not a page.
 */
export function signInPath(session: Session, request: Request): string {
  const url = new URL(request.url)
  const next = request.method === "GET" ? `${url.pathname}${url.search}` : null
  return withNext(session.mfaPending ? SCREEN_PATHS.oneTimeCode : SCREEN_PATHS.signIn, next)
}

/** The frame of a page: the signed-in frame for a user, the public one otherwise. */
export function Frame(
  { session, path, children }: { session: Session; path: string; children: ComponentChildren },
): JSX.Element {
  return session.user
    ? (
      <AppFrame
        user={session.user}
        currentPath={path}
        groupPicker={session.picker ?? undefined}
        // The e-mail page itself asks for the code; the banner would only repeat it there.
        banner={path === SCREEN_PATHS.email ? undefined : <EmailBanner status={session.email} />}
      >
        {children}
      </AppFrame>
    )
    : <PublicFrame canSignOut={session.mfaPending}>{children}</PublicFrame>
}
