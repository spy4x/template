import { createInstallPrompt } from "@spy4x/preact-signals/install-prompt"

const DISMISSED_KEY = `install-prompt-dismissed`

/** Whether the app can be installed here, and whether the person said "not now". */
export const install = createInstallPrompt({
  dismissed: {
    read: () => {
      try {
        return localStorage.getItem(DISMISSED_KEY) === `1`
      } catch (_blocked) {
        return false
      }
    },
    write: (value) => {
      try {
        localStorage.setItem(DISMISSED_KEY, value ? `1` : `0`)
      } catch (_blocked) {
        // The offer then shows again after a reload, which is harmless.
      }
    },
  },
})
