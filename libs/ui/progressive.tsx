import type { ComponentChildren, JSX } from "preact"

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

/**
 * The submit handler of a form that posts natively until a callback takes it over: with `run`, the
 * native post is cancelled and `run` is called; without it, the browser posts to the form's
 * `action` as usual.
 */
export function takeOver(
  run: (() => void) | undefined,
): (event: JSX.TargetedEvent<HTMLFormElement, SubmitEvent>) => void {
  return (event) => {
    if (!run) return
    event.preventDefault()
    run()
  }
}
