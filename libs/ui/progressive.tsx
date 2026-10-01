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
  signOut: "/sign-out",
  profile: "/profile/name",
  password: "/profile/password",
  totpStart: "/profile/totp/start",
  totpFinish: "/profile/totp/finish",
  totpDisable: "/profile/totp/disable",
  pushRemove: "/profile/push/remove",
  /** Creates a shared group: `{ id, kind, name }`. */
  groupCreate: "/groups",
} as const

/**
 * The routes a group's notes post to and live at, built from the ids in the path. A form's field
 * names match the API schema of the same action (`@domain/notes`); the path carries the group and
 * the note. The notes screen posts to these.
 */
export const NOTE_PATHS = {
  /** The list and the create form; `POST` creates `{ id, title, body }`. */
  list: (groupId: string) => `/groups/${groupId}/notes`,
  /** One note's edit form; `POST` updates `{ title, body, version }`. */
  note: (groupId: string, noteId: string) => `/groups/${groupId}/notes/${noteId}`,
  /** `POST` deletes `{ version }`. */
  delete: (groupId: string, noteId: string) => `/groups/${groupId}/notes/${noteId}/delete`,
} as const

/** The pages these screens link to. */
export const SCREEN_PATHS = {
  signIn: "/sign-in",
  signUp: "/sign-up",
  oneTimeCode: "/totp",
  profile: "/",
  groups: "/groups",
} as const

/**
 * Whether a click is one the page may take over: the primary button with no modifier. Ctrl or Meta
 * opens a new tab, Shift a new window and Alt a download, so those stay the browser's.
 */
function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
    !event.altKey
}

/**
 * A real `<a href>`. With `navigate`, a plain click goes through it instead of loading the page;
 * without it, or on a modified click, the browser follows the link as usual.
 */
export function ScreenLink(
  { href, navigate, class: className, children }: {
    href: string
    navigate?: Navigate
    class?: string
    children: ComponentChildren
  },
): JSX.Element {
  const onClick = (event: MouseEvent) => {
    if (!navigate || event.defaultPrevented || !isPlainClick(event)) return
    event.preventDefault()
    navigate(href)
  }
  return <a href={href} class={className} onClick={onClick}>{children}</a>
}

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
