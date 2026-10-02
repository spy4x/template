import { SCREEN_PATHS, withNext } from "@ui/progressive.tsx"
import type { SessionState } from "../state/session.ts"

/** The pages only a signed-in person can use: the notes, the groups and the e-mail address. */
const MEMBERS_ONLY = /^\/(notes|groups|email)(\/|$)/

/**
 * Where a visit to `path` goes when the session is not fully signed in: to sign-in, or to the code
 * page while the code is owed, with the page as `next` (its `search` too, given without the `?`)
 * so sign-in returns there. `null` when the page stays: the session is signed in, or the page is
 * open to anyone. The MPA's pages answer the same way on the server (`signInPath`).
 */
export function signInRedirect(
  path: string,
  search: string,
  session: Pick<SessionState, "user" | "isMfaRequired">,
): string | null {
  if ((session.user && !session.isMfaRequired) || !MEMBERS_ONLY.test(path)) return null
  const page = search ? `${path}?${search}` : path
  return withNext(session.isMfaRequired ? SCREEN_PATHS.oneTimeCode : SCREEN_PATHS.signIn, page)
}
