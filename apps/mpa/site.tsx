import type { ComponentChildren, JSX } from "preact"
import { Page } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"

/** The frame of every page of the public website: the brand, a link to the app, the content. */
export function SiteFrame(
  { spaOrigin, children }: { spaOrigin: string; children: ComponentChildren },
): JSX.Element {
  return (
    <>
      <header class="border-b border-subtle">
        <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="/" class="font-semibold">Template</a>
          <Link href={`${spaOrigin}/`}>Open the app</Link>
        </div>
      </header>
      <Page as="main" class="py-8">{children}</Page>
    </>
  )
}
