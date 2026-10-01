import { useEffect, useState } from "preact/hooks"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { addressToGuard } from "./unsaved-link.ts"

// Local until it moves into `@spy4x/preact-ui`: https://github.com/spy4x/preact-components/issues/536
/**
 * Warns before the person leaves a page with text they have not saved. While `unsaved`:
 *
 * - closing or reloading the tab asks the browser's own question;
 * - a click on a link to another page of the SPA is held back and answered with a dialog, so the
 *   sidebar and the page's own links are covered alike. Links that stay on the page, such as
 *   "Load the latest version" (`data-unsaved-ok`), and links the SPA's router does not own are the
 *   browser's. "Leave" follows the link and runs `onDiscard`; "Stay"
 *   closes the dialog.
 *
 * The browser's Back button is not held back: the page has already changed when the app hears of
 * it.
 */
export function UnsavedGuard(
  { unsaved, navigate, onDiscard }: {
    unsaved: boolean
    navigate: (to: string) => void
    onDiscard: () => void
  },
) {
  const [leaveTo, setLeaveTo] = useState<string | null>(null)

  useEffect(() => {
    if (!unsaved) return
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    const onClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null
      if (!link) return
      const to = addressToGuard(event, {
        href: (link as HTMLAnchorElement).href,
        target: link.getAttribute("target"),
        download: link.hasAttribute("download"),
        unsavedOk: link.hasAttribute("data-unsaved-ok"),
      }, location)
      if (to === null) return
      event.preventDefault()
      // The capture phase runs before the link's own handler, which would navigate.
      event.stopPropagation()
      setLeaveTo(to)
    }
    addEventListener("beforeunload", beforeUnload)
    document.addEventListener("click", onClick, true)
    return () => {
      removeEventListener("beforeunload", beforeUnload)
      document.removeEventListener("click", onClick, true)
    }
  }, [unsaved])

  if (leaveTo === null) return null
  return (
    <ConfirmDialog
      title="Leave without saving?"
      message="Your changes to this note have not been saved. If you leave, they are lost."
      confirmLabel="Leave"
      cancelLabel="Stay"
      tone="danger"
      dataE2E="unsaved-dialog"
      onConfirm={() => {
        const to = leaveTo
        setLeaveTo(null)
        onDiscard()
        navigate(to)
      }}
      onCancel={() => setLeaveTo(null)}
    />
  )
}
