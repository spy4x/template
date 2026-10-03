import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { renderToString } from "preact-render-to-string"
import { IconPlus } from "@spy4x/preact-icons"
import { DropdownItem } from "@spy4x/preact-ui/dropdown"
import { PageAction, PageHeader } from "./page-header.tsx"

describe("PageHeader", () => {
  it("draws the title as the page's one-line h1, with its full text as the tooltip", () => {
    const html = renderToString(<PageHeader title="Notes" subtitle="Personal" />)
    expect(html).toMatch(/<h1 class="truncate[^"]*" title="Notes"[^>]*>Notes<\/h1>/)
    expect(html).toContain(">Personal</p>")
  })

  it("names the back arrow after the page it returns to", () => {
    const html = renderToString(
      <PageHeader title="Trip" back={{ href: "/groups", label: "Back to groups" }} />,
    )
    expect(html).toMatch(/<a [^>]*aria-label="Back to groups"[^>]*>/)
    expect(html.match(/<a [^>]*>/)?.[0]).toContain(`href="/groups"`)
  })

  it("puts supplementary actions behind one named More actions menu, only when there are some", () => {
    const withMenu = renderToString(
      <PageHeader title="Trip" menu={<DropdownItem onClick={() => {}}>Leave</DropdownItem>} />,
    )
    expect(withMenu).toContain(`aria-label="More actions"`)
    expect(withMenu).toContain(">Leave</button>")
    expect(renderToString(<PageHeader title="Trip" />)).not.toContain("More actions")
  })
})

describe("PageAction", () => {
  it("keeps its label as the accessible name while a phone shows only the icon", () => {
    const html = renderToString(
      <PageAction label="New note" Icon={IconPlus} onClick={() => {}} dataE2E="note-new" />,
    )
    expect(html).toContain(`<span class="sr-only sm:not-sr-only">New note</span>`)
    expect(html.match(/<button [^>]*>/)?.[0]).toContain(`data-e2e="note-new"`)
  })
})
