import type { RailShellSidebarPlace } from "@spy4x/preact-system/rail-shell"

/**
 * The `data-e2e` hook of a control `RailShell` draws once per place: the labelled sidebar, the icon
 * rail and the phone overlay all sit in the page at once, and CSS shows one of the first two. The
 * sidebar, which the browser tests see at their default width, keeps the plain name; the other two
 * add their place, so every hook still names one element.
 */
export function placeHook(name: string, place: RailShellSidebarPlace): string {
  return place === "sidebar" ? name : `${name}-${place}`
}
