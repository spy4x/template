import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { RealtimeRequestError } from "@spy4x/realtime"
import type { OnboardingStatus } from "@domain/identity"
import { createOnboardingStore } from "./onboarding.ts"

const fresh: OnboardingStatus = {
  steps: {
    emailVerified: false,
    noteCreated: false,
    memberInvited: false,
    notificationsOn: false,
    twoFactorOn: false,
  },
  dismissed: false,
  tourSeen: false,
}

/** A fake server holding one person's onboarding. A command waits until `settle` is called. */
function harness(start: OnboardingStatus = fresh) {
  let server = start
  const commands: string[] = []
  let waiting: { resolve(): void; reject(cause: unknown): void } | null = null
  const store = createOnboardingStore({
    query: () => Promise.resolve(server) as Promise<never>,
    command: (name) => {
      commands.push(name)
      return new Promise<never>((resolve, reject) => {
        waiting = {
          resolve: () => {
            server = name === "onboarding.dismiss"
              ? { ...server, dismissed: true }
              : { ...server, tourSeen: true }
            resolve(server as never)
          },
          reject,
        }
      })
    },
  })
  return {
    store,
    commands,
    /** What another tab or a finished step changed on the server. */
    change: (next: Partial<OnboardingStatus>) => server = { ...server, ...next },
    accept: () => waiting!.resolve(),
    refuse: (cause: unknown) => waiting!.reject(cause),
  }
}

describe("onboarding store", () => {
  it("shows nothing until the server has answered, then the checklist of a new account", async () => {
    const { store } = harness()
    expect(store.visible.value).toBe(false)
    expect(store.tourOffered.value).toBe(false)

    await store.refresh()

    expect(store.visible.value).toBe(true)
    expect(store.tourOffered.value).toBe(true)
    expect(store.status.value?.steps.noteCreated).toBe(false)
  })

  it("ticks a step when the next read says it is done", async () => {
    const { store, change } = harness()
    await store.refresh()

    change({ steps: { ...fresh.steps, noteCreated: true } })
    await store.refresh()

    expect(store.status.value?.steps.noteCreated).toBe(true)
  })

  it("stays hidden for a person who dismissed it on another device", async () => {
    const { store } = harness({ ...fresh, dismissed: true })

    await store.refresh()

    expect(store.visible.value).toBe(false)
  })

  it("hides the checklist at once on dismiss and saves it as onboarding.dismiss", async () => {
    const { store, commands, accept } = harness()
    await store.refresh()

    const saving = store.dismiss()
    expect(store.visible.value).toBe(false)
    accept()
    await saving

    expect(commands).toEqual(["onboarding.dismiss"])
    expect(store.visible.value).toBe(false)
    expect(store.status.value?.dismissed).toBe(true)
    expect(store.error.value).toBe(null)
  })

  it("brings the checklist back with the server's message when the dismiss is refused", async () => {
    const { store, refuse } = harness()
    await store.refresh()

    const saving = store.dismiss()
    refuse(new RealtimeRequestError("rate_limited", "Try again later"))
    await saving

    expect(store.visible.value).toBe(true)
    expect(store.error.value).toBe("Try again later")
  })

  it("hides the checklist when a hint's read says another tab dismissed it", async () => {
    const { store, change } = harness()
    await store.refresh()

    change({ dismissed: true })
    await store.refresh()

    expect(store.visible.value).toBe(false)
  })

  it("starts the tour at its first step", async () => {
    const { store } = harness()
    await store.refresh()
    store.tourIndex.value = 2

    store.startTour()

    expect(store.tourOpen.value).toBe(true)
    expect(store.tourIndex.value).toBe(0)
  })

  it("closes the tour, stops offering it at once and saves it as onboarding.tour-seen", async () => {
    const { store, commands, accept } = harness()
    await store.refresh()
    store.startTour()

    const saving = store.endTour()
    expect(store.tourOpen.value).toBe(false)
    expect(store.tourOffered.value).toBe(false)
    accept()
    await saving

    expect(commands).toEqual(["onboarding.tour-seen"])
    expect(store.tourOffered.value).toBe(false)
  })

  it("offers the tour again, with an empty message, when saving its end never got an answer", async () => {
    const { store, refuse } = harness()
    await store.refresh()

    const saving = store.endTour()
    refuse(new Error("offline"))
    await saving

    expect(store.tourOffered.value).toBe(true)
    expect(store.tourOpen.value).toBe(false)
    expect(store.error.value).toBe("")
  })

  it("forgets everything on reset, and drops a read that was still on its way", async () => {
    const { store } = harness()
    await store.refresh()
    const late = store.refresh()

    store.reset()
    await late

    expect(store.status.value).toBe(null)
    expect(store.visible.value).toBe(false)
  })
})
