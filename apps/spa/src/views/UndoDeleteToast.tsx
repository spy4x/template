import { Button } from "@spy4x/preact-ui/button"
import { Toastr } from "@spy4x/preact-ui/toastr"
import type { notesStore } from "../state/notes.ts"

/**
 * The toast that follows a delete: the note's title and an Undo button, for ten seconds. It is its
 * own `Toastr` because the app's toast list takes text only, and it sits bottom right (above the tab
 * bar on a phone), away from the app's other toasts at the top right and clear of the desktop rail.
 * An offer that ended while another page was open is not shown late.
 */
export function UndoDeleteToast({ store }: { store: typeof notesStore }) {
  const offer = store.undo.value
  const left = offer ? offer.until - Date.now() : 0
  if (!offer || left <= 0) return null
  return (
    <Toastr
      corner="bottom-right"
      class="max-sm:bottom-24"
      label="Note deleted, undo available"
      dataE2E="undo-toasts"
      onDismiss={() => store.dismissUndo()}
      toasts={[{
        id: offer.id,
        type: "info",
        title: "Note deleted",
        duration: left,
        dataE2E: "note-undo-toast",
        body: (
          <span class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span class="min-w-0 break-words">
              {offer.title ? `"${offer.title}" was deleted.` : "The note was deleted."}
            </span>
            <Button
              type="button"
              variant="outline"
              class="min-h-11"
              onClick={() => void store.undoDelete()}
              data-e2e="note-undo"
            >
              Undo
            </Button>
          </span>
        ),
      }]}
    />
  )
}
