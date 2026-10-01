import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { addressToGuard, type ClickFacts, isSpaPath, type LinkFacts } from "./unsaved-link.ts"

const here = { origin: "http://app.localhost", pathname: "/notes/abc", search: "" }
const plainClick: ClickFacts = {
  defaultPrevented: false,
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
}
const link = (href: string, more: Partial<LinkFacts> = {}): LinkFacts => ({
  href,
  target: null,
  download: false,
  unsavedOk: false,
  ...more,
})
const guard = (l: LinkFacts, click: Partial<ClickFacts> = {}) =>
  addressToGuard({ ...plainClick, ...click }, l, here)

describe("the link the unsaved-text guard holds back", () => {
  it("holds back a plain click on a page of the SPA, and keeps its query and hash", () => {
    expect(guard(link("http://app.localhost/notes"))).toBe("/notes")
    expect(guard(link("http://app.localhost/groups?x=1#top"))).toBe("/groups?x=1#top")
  })

  it("leaves a click with a modifier key, another button or a cancelled default to the browser", () => {
    const to = link("http://app.localhost/notes")
    expect(guard(to, { metaKey: true })).toBe(null)
    expect(guard(to, { ctrlKey: true })).toBe(null)
    expect(guard(to, { shiftKey: true })).toBe(null)
    expect(guard(to, { altKey: true })).toBe(null)
    expect(guard(to, { button: 1 })).toBe(null)
    expect(guard(to, { defaultPrevented: true })).toBe(null)
  })

  it("leaves a link that opens in another tab or downloads, but not one aimed at _self", () => {
    expect(guard(link("http://app.localhost/notes", { target: "_blank" }))).toBe(null)
    expect(guard(link("http://app.localhost/notes", { download: true }))).toBe(null)
    expect(guard(link("http://app.localhost/notes", { target: "_self" }))).toBe("/notes")
  })

  it("leaves a link marked as acting on this page", () => {
    expect(guard(link("http://app.localhost/notes/abc", { unsavedOk: true }))).toBe(null)
  })

  it("leaves a link that only moves within this page", () => {
    expect(guard(link("http://app.localhost/notes/abc#section"))).toBe(null)
    // The same path with a hash is a move within the page; another path with a hash is not.
    expect(guard(link("http://app.localhost/notes#section"))).toBe("/notes#section")
  })

  it("leaves another origin and paths the SPA's router does not own to the browser", () => {
    expect(guard(link("https://example.org/notes"))).toBe(null)
    expect(guard(link("http://app.localhost/api/groups"))).toBe(null)
    expect(guard(link("http://app.localhost/health"))).toBe(null)
  })

  it("knows the SPA's own paths", () => {
    for (const path of ["/", "/notes", "/notes/new", "/groups", "/sign-in", "/totp"]) {
      expect(isSpaPath(path), path).toBe(true)
    }
    for (const path of ["/api/ws", "/notesx", "/assets/app.js"]) {
      expect(isSpaPath(path), path).toBe(false)
    }
  })
})
