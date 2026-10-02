import type { ComponentChildren, JSX } from "preact"
import { EnhancedForm, type EnhancedFormLabels } from "@spy4x/preact-ui/enhanced-form"
import { safeRedirectPath } from "@spy4x/net/redirect-path"

/**
 * Follows an in-app link without a page load. The SPA passes its router's `navigate`; a server
 * rendered page passes nothing and every link is an ordinary one.
 */
export type Navigate = (href: string) => void

/**
 * Where every form on these screens posts when no JavaScript takes it over: the page routes a
 * server-rendered app handles. Each form's field names match the API schema of the same action.
 */
export const FORM_ACTIONS = {
  signIn: "/sign-in",
  signUp: "/sign-up",
  oneTimeCode: "/totp",
  /** Asks for a reset link: `{ email }`. */
  forgotPassword: "/forgot-password",
  /** Sets a new password with the link's code: `{ email, code, newPassword }`. */
  resetPassword: "/reset-password",
  signOut: "/sign-out",
  profile: "/profile/name",
  password: "/profile/password",
  totpStart: "/profile/totp/start",
  totpFinish: "/profile/totp/finish",
  totpDisable: "/profile/totp/disable",
  pushRemove: "/profile/push/remove",
  /** Creates a group: `{ id, name }`. */
  groupCreate: "/groups",
  /** Selects the group the notes show: `{ groupId }`. */
  groupSelect: "/groups/select",
  /** Proves the address waiting for a code: `{ code }`. */
  emailVerify: "/email/verify",
  /** Sends a new code to the address waiting for one: no fields. */
  emailSend: "/email/send",
  /** Moves to a new address once its code proves it: `{ email, password }`. */
  emailChange: "/email/change",
} as const

/**
 * The routes the notes of the selected group post to and live at. A form's field names match the
 * API schema of the same action (`@domain/notes`); the group is the person's selected one, which
 * the server holds (`GET /api/groups/selected`), so no path names it. The notes screens post to
 * these.
 */
export const NOTE_PATHS = {
  /** The list; `POST` creates `{ id, title, body }`. */
  list: "/notes",
  /** The create page: the editor with no note yet. */
  new: "/notes/new",
  /**
   * The create form's action: the list, with the group the page shows. The server refuses the post
   * when that is no longer the selected group, so a note cannot land in a group other than the
   * one on screen.
   */
  create: (groupId: string) => `/notes?${new URLSearchParams({ group: groupId })}`,
  /** One note's page, with its edit form; `POST` updates `{ title, body, version }`. */
  note: (noteId: string) => `/notes/${noteId}`,
  /** `GET` asks "delete this note?" on a page of its own; `POST` deletes `{ version }`. */
  delete: (noteId: string) => `/notes/${noteId}/delete`,
} as const

/** The pages these screens link to. */
export const SCREEN_PATHS = {
  signIn: "/sign-in",
  signUp: "/sign-up",
  oneTimeCode: "/totp",
  forgotPassword: "/forgot-password",
  profile: "/",
  groups: "/groups",
  /** The e-mail address: its code, a new code, a change. */
  email: "/email",
} as const

/**
 * The query parameter, and the hidden field of each auth form, that carries the page a signed-out
 * person asked for through sign-in, so sign-in can return there.
 */
export const NEXT_PARAM = "next"

/**
 * The checked `next` value: `value` when it is a page of this app, the notes list otherwise. The
 * rules are `safeRedirectPath`'s (one leading `/`, no `//`, backslash, scheme or control
 * character, encoded or not), and every `/api` path is refused.
 *
 * Every hop that carries `next` checks it again here, since a person can edit each one: the
 * sign-in and sign-up pages, their posts, the one-time-code page and its post. OAuth sign-in
 * (spy4x/template#141) plugs in here too: its start route checks `next` with this, keeps the
 * result in the flow state (`OAuthPendingFlow`) and redirects to that stored value after the
 * callback, never to a value read from the callback's query.
 */
export function checkedNext(value: string): string {
  return safeRedirectPath(value, { fallback: NOTE_PATHS.list, refuse: ["/api"] })
}

/** The checked `next` of a query or a form, or `null` when it carries none. */
export function readNext(source: { get(name: string): unknown }): string | null {
  const value = source.get(NEXT_PARAM)
  return typeof value === "string" && value !== "" ? checkedNext(value) : null
}

/** `path` with `next` as its query, or `path` alone without one. */
export function withNext(path: string, next: string | null): string {
  return next ? `${path}?${new URLSearchParams({ [NEXT_PARAM]: next })}` : path
}

/** Where a finished sign-in goes: the checked `next`, or the profile without one. */
export function afterSignIn(next: string | null): string {
  return next ?? SCREEN_PATHS.profile
}

/** Where a group's own pages live. */
export const GROUP_PATHS = {
  /** The group's settings page. */
  settings: (groupId: string) => `/groups/${encodeURIComponent(groupId)}`,
  /** `POST` renames the group: `{ name }`. */
  rename: (groupId: string) => `/groups/${encodeURIComponent(groupId)}/rename`,
  /** `POST` deletes the group, which its owner can restore for 30 days. Takes no fields. */
  delete: (groupId: string) => `/groups/${encodeURIComponent(groupId)}/delete`,
  /** `POST` restores a deleted group. Takes no fields. */
  restore: (groupId: string) => `/groups/${encodeURIComponent(groupId)}/restore`,
} as const

/** `EnhancedForm` announces nothing itself: each screen shows its own busy button and error. */
const QUIET: EnhancedFormLabels = { sending: "", done: "", failed: "" }

/**
 * A screen's form: `EnhancedForm` posting to `action`. Without `onSubmit`, the browser posts as
 * usual; with it, the native post is cancelled and `onSubmit` is called. While `pending`, the
 * fields are disabled and a second submit is refused.
 */
export function ScreenForm(
  { action, pending = false, onSubmit, class: className, children }: {
    action: string
    pending?: boolean
    onSubmit?: () => void
    class?: string
    children: ComponentChildren
  },
): JSX.Element {
  return (
    <EnhancedForm
      action={action}
      method="post"
      status={pending ? "sending" : "idle"}
      labels={QUIET}
      onSubmit={onSubmit && (() => onSubmit())}
      // EnhancedForm spaces its fields from its status line, which stays empty here: space-y-0!
      // overrides its space-y-4 (the `!` is needed since preact-components 3), so the empty line
      // takes no room.
      class={className ? `space-y-0! ${className}` : "space-y-0!"}
    >
      {children}
    </EnhancedForm>
  )
}
