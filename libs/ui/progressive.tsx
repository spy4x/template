import type { ComponentChildren, JSX } from "preact"
import { EnhancedForm, type EnhancedFormLabels } from "@spy4x/preact-ui/enhanced-form"

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
  /** Creates a shared group: `{ id, kind, name }`. */
  groupCreate: "/groups",
  /** Selects the group the notes show: `{ groupId }`. */
  groupSelect: "/groups/select",
} as const

/**
 * The routes the notes of the selected group post to and live at. A form's field names match the
 * API schema of the same action (`@domain/notes`); the group is the person's selected one, which
 * the server holds (`GET /api/groups/selected`), so no path names it. The notes screen posts to
 * these.
 */
export const NOTE_PATHS = {
  /** The list and the create form; `POST` creates `{ id, title, body }`. */
  list: "/notes",
  /**
   * The create form's action: the list, with the group the page shows. The server refuses the post
   * when that is no longer the selected group, so a note cannot land in a group other than the
   * one on screen.
   */
  create: (groupId: string) => `/notes?${new URLSearchParams({ group: groupId })}`,
  /** One note's edit form; `POST` updates `{ title, body, version }`. */
  note: (noteId: string) => `/notes/${noteId}`,
  /** `POST` deletes `{ version }`. */
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
} as const

/** Where a group's own pages live. */
export const GROUP_PATHS = {
  /** The group's settings page. */
  settings: (groupId: string) => `/groups/${encodeURIComponent(groupId)}`,
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
      // EnhancedForm spaces its fields from its status line, which stays empty here: space-y-0
      // replaces its space-y-4, so the empty line takes no room.
      class={className ? `space-y-0 ${className}` : "space-y-0"}
    >
      {children}
    </EnhancedForm>
  )
}
