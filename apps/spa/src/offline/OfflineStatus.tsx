import { useState } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { Card, CardBody } from "@spy4x/preact-ui/card"
import { activeLayer } from "./index.ts"
import type { NoteEntry } from "./local-store.ts"

/** What the server holds now, in a conflict: its text, or that the note is gone. */
function serverSide(entry: NoteEntry): string {
  const server = entry.conflict?.server
  return server ? `${server.title}\n${server.body}`.trim() : "The note no longer exists."
}

/** What this person wrote, in a conflict. */
function mySide(entry: NoteEntry): string {
  return entry.kind === "delete"
    ? "You deleted this note."
    : `${entry.payload.title}\n${entry.payload.body}`.trim()
}

/**
 * Shows the notes writes that wait for the network and the ones the server did not take, each with
 * both sides and a choice. Nothing here changes a note until the person picks: a conflict never
 * overwrites the other side on its own. `onResolved` runs after a choice so the list can reread.
 */
export function OfflineStatus(
  { groupId, onResolved }: { groupId: string; onResolved: () => void },
) {
  // Which entry's copy button was pressed last: its seq when it worked, the negative when it did not.
  const [copied, setCopied] = useState(0)
  const layer = activeLayer.value
  if (!layer) return null
  const entries = layer.entries.value.filter((entry) => entry.payload.groupId === groupId)
  const waiting = entries.filter((entry) => entry.status === "pending").length
  const conflicts = entries.filter((entry) => entry.status === "conflict")
  if (waiting === 0 && conflicts.length === 0) return null

  return (
    <section class="mx-auto mb-4 w-full max-w-3xl px-4" aria-label="Sync" data-e2e="offline-status">
      {waiting > 0 && (
        <p class="text-sm text-muted" role="status" data-e2e="offline-pending">
          {waiting === 1 ? "1 change is" : `${waiting} changes are`} waiting to sync.
        </p>
      )}
      {conflicts.map((entry) => (
        <Card key={entry.seq} class="mt-3" data-e2e="note-sync-conflict">
          <CardBody>
            <h2 class="text-base font-semibold" role="alert">{entry.conflict?.message}</h2>
            <div class="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <h3 class="text-sm font-semibold">Your version</h3>
                <p class="whitespace-pre-wrap text-sm" data-e2e="conflict-mine">
                  {mySide(entry)}
                </p>
              </div>
              <div>
                <h3 class="text-sm font-semibold">Server's version</h3>
                <p class="whitespace-pre-wrap text-sm" data-e2e="conflict-theirs">
                  {serverSide(entry)}
                </p>
              </div>
            </div>
            <div class="mt-4 flex flex-wrap gap-3">
              {entry.conflict?.server && (
                <Button
                  type="button"
                  data-e2e="conflict-keep-mine"
                  onClick={async () => {
                    await layer.outbox.keepMine(entry)
                    onResolved()
                  }}
                >
                  Keep mine
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                data-e2e="conflict-copy"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(mySide(entry))
                    setCopied(entry.seq!)
                  } catch (_denied) {
                    setCopied(-entry.seq!)
                  }
                }}
              >
                Copy my text
              </Button>
              {copied === entry.seq && <span role="status" class="text-sm">Copied.</span>}
              {copied === -entry.seq! && (
                <span role="status" class="text-sm">Could not copy: select the text above.</span>
              )}
              <Button
                type="button"
                variant="outline"
                data-e2e="conflict-use-theirs"
                onClick={async () => {
                  await layer.outbox.useTheirs(entry)
                  onResolved()
                }}
              >
                {entry.conflict?.reason === "rejected" ? "Discard mine" : "Use the server's"}
              </Button>
            </div>
          </CardBody>
        </Card>
      ))}
    </section>
  )
}
