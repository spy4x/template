import { computed, signal } from "@preact/signals"
import { createOnboardingState, type OnboardingState } from "@spy4x/preact-signals/onboarding"
import { RealtimeRequestError } from "@spy4x/realtime"
import type { OnboardingStatus } from "@domain/identity"
import { callCommand, callQuery } from "../modules.ts"

/** What the onboarding store needs from the outside. Injected so tests need no socket. */
export interface OnboardingDependencies {
  query<T>(name: string): Promise<T>
  command<T>(name: string): Promise<T>
}

/** The server's message for a refused call, or empty when the call never got an answer. */
function messageOf(cause: unknown): string {
  return cause instanceof RealtimeRequestError ? cause.message : ""
}

/**
 * The first-steps checklist and the tour: what the server says the person has done, and the two
 * answers it keeps for them, so both follow the person to every device. The steps are never ticked
 * here: {@link refresh} reads them again, when the home page opens and when a hint says the person
 * changed something in another tab.
 *
 * Whether the checklist shows is preact-components' `createOnboardingState`, with the server as
 * its port: Dismiss hides the card at once and brings it back if the server refused.
 */
export function createOnboardingStore(dependencies: OnboardingDependencies) {
  /** The last answer of the server; `null` until the first one, and after sign-out. */
  const status = signal<OnboardingStatus | null>(null)
  /** The library's store, made once the first answer says what is dismissed. */
  const shown = signal<OnboardingState | null>(null)
  /** Why the last Dismiss or tour answer was not saved: the server's message, or empty. */
  const error = signal<string | null>(null)
  const tourOpen = signal(false)
  const tourIndex = signal(0)

  const facts = computed(() =>
    Object.entries(status.value?.steps ?? {}).map(([id, done]) => ({ id, done }))
  )
  /** Whether the checklist is on the page: read, and not dismissed. */
  const visible = computed(() => shown.value?.visible.value ?? false)
  /** Whether the tour is still offered: the person has neither finished nor skipped it. */
  const tourOffered = computed(() => status.value !== null && !status.value.tourSeen)

  let reads = 0

  /** Reads the steps and the two answers again. A read that a later one overtook is dropped. */
  async function refresh(): Promise<void> {
    const read = ++reads
    const answer = await dependencies.query<OnboardingStatus>("onboarding.get")
    if (read !== reads) return
    status.value = answer
    // The library reads its port once, so a flag that changed elsewhere (another tab dismissed)
    // needs a new store.
    if (shown.value === null || shown.value.visible.value === answer.dismissed) {
      shown.value = createOnboardingState({
        steps: facts,
        dismissed: {
          read: () => answer.dismissed,
          write: async (value) => {
            // Nothing shows the checklist again, so only "dismissed" is ever written.
            if (value) status.value = await dependencies.command("onboarding.dismiss")
          },
        },
      })
    }
  }

  /** Closes the checklist for good, on every device. It comes back if the server refuses. */
  async function dismiss(): Promise<void> {
    error.value = null
    tourOpen.value = false
    try {
      await shown.value?.dismiss()
    } catch (cause) {
      error.value = messageOf(cause)
    }
  }

  function startTour(): void {
    error.value = null
    tourIndex.value = 0
    tourOpen.value = true
  }

  /** Ends the tour and stops offering it, on every device. The offer returns if the save fails. */
  async function endTour(): Promise<void> {
    const before = status.value
    if (before === null) return
    error.value = null
    tourOpen.value = false
    status.value = { ...before, tourSeen: true }
    reads++
    try {
      status.value = await dependencies.command<OnboardingStatus>("onboarding.tour-seen")
    } catch (cause) {
      status.value = before
      error.value = messageOf(cause)
    }
  }

  function reset(): void {
    reads++
    status.value = null
    shown.value = null
    error.value = null
    tourOpen.value = false
    tourIndex.value = 0
  }

  return {
    status,
    visible,
    error,
    tourOffered,
    tourOpen,
    tourIndex,
    refresh,
    dismiss,
    startTour,
    endTour,
    reset,
  }
}

/** The page's own store, over the socket. */
export const onboardingStore = createOnboardingStore({
  query: (name) => callQuery(name),
  command: (name) => callCommand(name, undefined),
})
