import { useEffect, useRef } from "preact/hooks"

/**
 * Calls `onDone` when an action that was pending ends without `failed`: how a dialog learns that
 * its form went through and it can close.
 */
export function useSucceeded(pending: boolean, failed: boolean, onDone: () => void): void {
  const was = useRef(pending)
  useEffect(() => {
    if (was.current && !pending && !failed) onDone()
    was.current = pending
  }, [pending, failed])
}
