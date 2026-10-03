import type { JSX, RefObject } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { ErrorState } from "@spy4x/preact-ui/error-state"

/**
 * Calls `onDone` when an action that was `pending` finishes without `failed`: a dialog closes once
 * its request worked, and stays open with the error when it did not.
 */
export function useClosesWhenDone(pending: boolean, failed: boolean, onDone: () => void): void {
  const was = useRef(pending)
  useEffect(() => {
    if (was.current && !pending && !failed) onDone()
    was.current = pending
  }, [pending, failed])
}

/**
 * Hides an error left from an earlier attempt when its dialog opens again. Call the returned
 * function when the dialog opens: the error that is there then stays hidden until the next attempt
 * starts (`pending` turns true), so a dialog never opens on an old refusal.
 */
export function useFreshError(
  error: string | null,
  pending: boolean,
): [string | null, () => void] {
  const [stale, setStale] = useState<string | null>(null)
  useEffect(() => {
    if (pending) setStale(null)
  }, [pending])
  return [error !== null && error === stale ? null : error, () => setStale(error)]
}

/**
 * Keeps focus on the page when a row leaves a list after its own removal (`pendingId`) was in
 * flight: it moves to the menu of the row that took its place, else of a later row, else to
 * `fallback()`. Without this, focus falls to the page's body with the row's menu.
 *
 * `list` is the list element whose `li` children are the rows, in the order of `ids`.
 */
export function useFocusAfterRemoval(
  list: RefObject<HTMLElement>,
  ids: readonly (string | number)[] | null,
  pendingId: string | number | null,
  fallback: () => HTMLElement | null | undefined,
): void {
  const awaited = useRef<{ id: string | number; index: number } | null>(null)
  const known = useRef(ids)
  if (pendingId !== null && awaited.current?.id !== pendingId) {
    awaited.current = { id: pendingId, index: known.current?.indexOf(pendingId) ?? -1 }
  }
  const key = ids?.join(",") ?? null
  useEffect(() => {
    known.current = ids
    const gone = awaited.current
    if (!gone || ids === null) return
    if (ids.includes(gone.id)) {
      // The request ended and the row stayed (a role change, a refusal): stop waiting for it, so
      // a later departure for another reason leaves focus where the person is.
      if (pendingId === null) awaited.current = null
      return
    }
    awaited.current = null
    const rows = Array.from(list.current?.children ?? []).slice(Math.max(gone.index, 0))
    const menu = rows.map((row) => row.querySelector("button")).find((button) => button !== null)
    ;(menu ?? fallback())?.focus()
  }, [key, pendingId])
}

/**
 * A refusal with no field to sit under: an alert that takes focus when it appears, so a keyboard
 * or screen reader user lands on it.
 */
export function FocusedError(
  { message, dataE2E }: { message: string | null; dataE2E?: string },
): JSX.Element | null {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (message) box.current?.focus()
  }, [message])
  // Nothing is drawn without a message, so an empty box adds no gap to the layout around it.
  if (!message) return null
  return (
    <div ref={box} tabIndex={-1} data-e2e={dataE2E}>
      <ErrorState message={message} />
    </div>
  )
}
