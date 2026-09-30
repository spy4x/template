import type { SessionUser } from "../state/session.ts"

const KEY = "offline:session"

/** The slice of `localStorage` this file uses, so a test can pass its own. */
export type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

function browserStorage(): SessionStorage | null {
  let storage: SessionStorage | null = null
  try {
    storage = localStorage
  } catch (_error) {
    // Blocked storage: nothing is remembered.
  }
  return storage
}

/**
 * Remembers who is signed in, so the app can open with no network: the cookie says nothing until
 * the server is reached, and a page that cannot ask must still show the person their notes.
 */
export function rememberUser(user: SessionUser, storage = browserStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(user))
  } catch (_error) {
    // Blocked storage: the next offline start shows the sign-in page.
  }
}

/** Drops the remembered user: sign-out, or a server that says the session ended. */
export function forgetUser(storage = browserStorage()): void {
  try {
    storage?.removeItem(KEY)
  } catch (_error) {
    // Nothing stored, nothing to remove.
  }
}

/** The remembered user, or `null` when none was kept or the stored value is not a user. */
export function recallUser(storage = browserStorage()): SessionUser | null {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? "null")
    if (typeof parsed !== "object" || parsed === null) return null
    return typeof (parsed as { id?: unknown }).id === "number" ? parsed as SessionUser : null
  } catch (_error) {
    return null
  }
}
