import type { ComponentChildren, JSX } from "preact"
import type { UserMFAStatus } from "@domain/identity"
import { AppFrame, PublicFrame } from "@ui/frame.tsx"
import { SCREEN_PATHS } from "@ui/progressive.tsx"
import { type Api, isRecord } from "./api.ts"

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
}

/**
 * Asks the API who the request's session belongs to (`GET /api/auth/me`). 401 means nobody; any
 * other failure throws, so an API outage shows an error page instead of a signed-out one.
 */
export async function readSession(api: Api): Promise<Session> {
  const answer = await api.call("GET", "/api/auth/me")
  if (answer.status === 200 && isRecord(answer.body)) {
    return { user: answer.body as unknown as SessionUser, mfaPending: false }
  }
  if (answer.status === 202) return { user: null, mfaPending: true }
  if (answer.status === 401) return { user: null, mfaPending: false }
  throw new Error(`GET /api/auth/me answered ${answer.status}`)
}

/**
 * Where a page for signed-in users sends a session that is not one: to the one-time code when the
 * password step is done, to sign-in otherwise.
 */
export function signInPath(session: Session): string {
  return session.mfaPending ? SCREEN_PATHS.oneTimeCode : SCREEN_PATHS.signIn
}

/** The frame of a page: the signed-in frame for a user, the public one otherwise. */
export function Frame(
  { session, path, children }: { session: Session; path: string; children: ComponentChildren },
): JSX.Element {
  return session.user
    ? <AppFrame user={session.user} currentPath={path}>{children}</AppFrame>
    : <PublicFrame canSignOut={session.mfaPending}>{children}</PublicFrame>
}
