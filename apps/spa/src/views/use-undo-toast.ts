import { effect } from "@preact/signals"
import { useEffect } from "preact/hooks"
import type { notesStore } from "../state/notes.ts"
import { toasts } from "../state/toasts.ts"

/**
 * Shows the toast that follows a delete in the app's one toast list: the note's title and an Undo
 * button. It lasts as long as the offer does, and goes when the offer ends or the list leaves the
 * screen. An offer that ended while another page was open is not shown late.
 */
export function useUndoToast(store: typeof notesStore): void {
  const offer = store.undo.value
  useEffect(() => {
    if (!offer) return
    const left = offer.until - Date.now()
    if (left <= 0) return
    toasts.info({
      id: offer.id,
      title: "Note deleted",
      body: offer.title ? `"${offer.title}" was deleted.` : "The note was deleted.",
      duration: left,
      dataE2E: "note-undo-toast",
      action: { label: "Undo", dataE2E: "note-undo", onAction: () => void store.undoDelete() },
    })
    // Dismiss and the toast's own timer take it off the list: that ends the offer too, so it does
    // not come back when the person returns to the list.
    const stop = effect(() => {
      if (!toasts.list.value.some((toast) => toast.id === offer.id)) store.dismissUndo()
    })
    return () => {
      stop()
      toasts.remove(offer.id)
    }
  }, [offer, store])
}
