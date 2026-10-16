import { signal } from "@preact/signals"
import type { StoredSettings } from "@spy4x/platform/universal/settings"
import { preferencesDefinition } from "@domain/identity"
import { type AppFormat, appFormat } from "@ui/format.tsx"
import type { AdminFetch } from "./state.ts"

/** Where the API answers the signed-in operator's own preferences. */
export const OWN_PREFERENCES_PATH = `/api/admin/me/preferences`

/**
 * The operator's own formatter (#163): every date in the admin app follows the region format, time
 * zone and clock the operator chose in the product's app. Until the answer comes, or when it fails,
 * the device's own format is used, so a screen never waits on it.
 */
export function createOperatorFormat(request: AdminFetch) {
  const format = signal<AppFormat>(appFormat())
  /** Counts the loads, so an answer for a session that ended never lands in the next one. */
  let generation = 0

  /** Reads the operator's preferences; a failure keeps the device's format. */
  async function load(): Promise<void> {
    const mine = ++generation
    try {
      const answer = await request<StoredSettings>(OWN_PREFERENCES_PATH)
      if (mine !== generation || !answer.ok) return
      format.value = appFormat(preferencesDefinition.resolve(answer.data).value)
    } catch (_error) {
      // The network is down: the device's format stays.
    }
  }

  /** Signing out: back to the device's format. */
  function reset(): void {
    generation++
    format.value = appFormat()
  }

  return { format, load, reset }
}

export type OperatorFormat = ReturnType<typeof createOperatorFormat>
