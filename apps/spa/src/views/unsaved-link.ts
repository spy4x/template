/** The parts of a click that decide whether the browser would follow a link in this tab. */
export interface ClickFacts {
  defaultPrevented: boolean
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/** The parts of an anchor that decide where it goes. */
export interface LinkFacts {
  /** The resolved address (`HTMLAnchorElement.href`). */
  href: string
  /** The `target` attribute, or `null`. */
  target: string | null
  download: boolean
  /** The link marked `data-unsaved-ok`: it acts on this page and leaves nothing behind. */
  unsavedOk: boolean
}

/** The page the click happened on. */
export interface Here {
  origin: string
  pathname: string
  search: string
}

/** The paths the SPA's router owns: its routes in `app.tsx`. Keep the two lists the same. */
export function isSpaPath(pathname: string): boolean {
  return pathname === "/" ||
    /^\/(notes|groups|sign-in|sign-up|totp|forgot-password|reset-password)(\/|$)/.test(pathname)
}

/**
 * The in-app address a click on `link` would take the person to, when the unsaved-text guard must
 * hold it back; `null` for everything the browser or the link itself should handle: a click with
 * a modifier key or a button other than the main one, a link that opens elsewhere or downloads, a
 * link marked `data-unsaved-ok`, another origin, a path the SPA's router does not own (`/api/…`,
 * the MPA's pages) and a link that only moves within this page (`#section`).
 */
export function addressToGuard(click: ClickFacts, link: LinkFacts, here: Here): string | null {
  if (click.defaultPrevented || click.button !== 0) return null
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null
  if ((link.target && link.target !== "_self") || link.download || link.unsavedOk) return null
  const url = new URL(link.href, here.origin)
  if (url.origin !== here.origin || !isSpaPath(url.pathname)) return null
  if (url.pathname === here.pathname && url.search === here.search && url.hash !== "") return null
  return `${url.pathname}${url.search}${url.hash}`
}
