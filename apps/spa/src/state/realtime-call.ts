import { REALTIME_USER_HEADER } from "@spy4x/realtime/operations"
import {
  type AvailableCallPort,
  type CallPort,
  createComposedCallPort,
  createHttpCallPort,
  withUnauthorizedHook,
} from "@spy4x/realtime/calls"
import { apiFetch } from "./api.ts"
import { sessionState } from "./session.ts"

/**
 * What is this app's about the calls port (ADR 003): where the call route is, which user a call is
 * sent as, and what an `unauthorized` answer does to the page. The port itself, its retries and its
 * errors are the library's (`@spy4x/realtime/calls`).
 */

/** Where the API serves `POST <base>/<name>` (`apps/api/routes/call.ts`). */
export const CALL_BASE_URL = "/api/call"

/**
 * Signs the page out, as an answer of `unauthorized` must: the session ended, or the cookie now
 * belongs to somebody else. The app then drops the socket, the cursors and the data it holds.
 */
export function signOutPage(): void {
  if (sessionState.value.user === null && !sessionState.value.isMfaRequired) return
  sessionState.value = { ...sessionState.value, user: null, isMfaRequired: false }
}

/** What {@link createAppCallPort} is built from. */
export interface AppCallPortOptions {
  /** The user the page was started for; every call names them. */
  userId: number
  /** The socket module's port, when the product has one: preferred while its socket is open. */
  socket?: AvailableCallPort
  /** Defaults to {@link signOutPage}. */
  onUnauthorized?: () => void
  /** Defaults to the global `fetch`; a test passes its own. */
  fetch?: typeof fetch
}

/**
 * The calls port of one signed-in user: HTTP always, the socket in front of it when there is one.
 * An `unauthorized` answer over either signs the page out, which is how a page with no socket
 * learns that its session ended.
 */
export function createAppCallPort(options: AppCallPortOptions): CallPort {
  const http = createHttpCallPort({
    baseUrl: CALL_BASE_URL,
    userId: String(options.userId),
    fetch: options.fetch,
  })
  const port = options.socket ? createComposedCallPort({ socket: options.socket, http }) : http
  return withUnauthorizedHook(port, options.onUnauthorized ?? signOutPage)
}

/**
 * Whether a call made now reaches the server as `userId`: the page is still signed in as them and
 * the browser has a network. The outbox sends only while this holds (`canSend`), so one person's
 * queue is never sent as another, over the socket or over HTTP.
 */
export function canCallAs(
  userId: number,
  isOnline: () => boolean = () => globalThis.navigator?.onLine !== false,
): boolean {
  return sessionState.value.user?.id === userId && !sessionState.value.isMfaRequired && isOnline()
}

/**
 * A list read (`GET`), which both transports share. It names the user the page was started for,
 * as a call does, and an `unauthorized` answer signs the page out. The caller sees a failed read
 * and so writes nothing to a device copy.
 */
export async function apiRead<T>(path: string, fetcher: typeof apiFetch = apiFetch) {
  const userId = sessionState.value.user?.id
  const result = await fetcher<T>(
    path,
    userId === undefined ? undefined : { headers: { [REALTIME_USER_HEADER]: String(userId) } },
  )
  if (!result.ok && result.status === 401) signOutPage()
  return result
}
