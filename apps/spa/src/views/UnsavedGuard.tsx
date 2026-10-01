import { useEffect, useState } from "preact/hooks"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"

/**
 * Warns before the person leaves a page with text they have not saved. While `unsaved`:
 *
 * - closing or reloading the tab asks the browser's own question;
 * - a click on any link inside the app is held back and answered with a dialog, so the sidebar and
 *   the page's own links are covered alike. "Leave" follows the link and runs `onDiscard`; "Stay"
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
      if (!link || event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = link.getAttribute("target")
      if ((target && target !== "_self") || link.hasAttribute("download")) return
      const url = new URL((link as HTMLAnchorElement).href, location.href)
      if (url.origin !== location.origin) return
      event.preventDefault()
      // The capture phase runs before the link's own handler, which would navigate.
      event.stopPropagation()
      setLeaveTo(`${url.pathname}${url.search}${url.hash}`)
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
