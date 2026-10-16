import { useState } from "preact/hooks"
import type { PreferencesGroupProps } from "@ui/preferences.tsx"
import { PREFERENCES_FAILURES } from "@ui/preferences.tsx"
import { preferencesState } from "../state/preferences.ts"
import { themeStore } from "../state/theme.ts"

/**
 * The props of the profile page's "Language and region" group, wired to the page's preferences
 * store and theme store. The theme row writes the theme store, which saves to the server and paints
 * at once, offline too; the dialog's Save waits for the server's answer.
 */
export function usePreferencesProps(): PreferencesGroupProps {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const state = preferencesState

  return {
    value: state.value.value,
    device: state.device.value,
    systemTheme: themeStore.system.value,
    otherZone: state.otherZone.value,
    conflict: state.conflict.value?.value ?? null,
    pending,
    error,
    announcement: state.announcement.value,
    now: new Date(),
    onTheme: (theme) => themeStore.set(theme as Parameters<typeof themeStore.set>[0]),
    onSave: async (next) => {
      setError(null)
      state.dismissConflict()
      setPending(true)
      const outcome = await state.save(next)
      setPending(false)
      if (outcome.ok || outcome.reason === `conflict`) return
      setError(
        outcome.reason === `failed` ? PREFERENCES_FAILURES.network : PREFERENCES_FAILURES.invalid,
      )
    },
    onUseDeviceZone: () => void state.useDeviceZone(),
    onKeepZone: state.keepZone,
    onCloseDialog: () => {
      setError(null)
      state.dismissConflict()
    },
  }
}
