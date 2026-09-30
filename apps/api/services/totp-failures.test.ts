import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { FIRST_LOCK_MS, FREE_FAILURES, lockDelayMs, MAX_LOCK_MS } from "./totp-failures.ts"

describe("lockDelayMs", () => {
  it("lets the first five wrong codes through with no wait", () => {
    for (let failures = 1; failures <= FREE_FAILURES; failures++) {
      expect(lockDelayMs(failures)).toBe(0)
    }
  })

  it("waits 15 minutes after the sixth wrong code and doubles for each one after", () => {
    expect(lockDelayMs(6)).toBe(FIRST_LOCK_MS)
    expect(lockDelayMs(7)).toBe(2 * FIRST_LOCK_MS)
    expect(lockDelayMs(8)).toBe(4 * FIRST_LOCK_MS)
    expect(lockDelayMs(9)).toBe(8 * FIRST_LOCK_MS)
  })

  it("never waits longer than one day, however many codes were wrong", () => {
    expect(lockDelayMs(12)).toBe(16 * 60 * 60_000)
    expect(lockDelayMs(13)).toBe(MAX_LOCK_MS)
    expect(lockDelayMs(1_000_000)).toBe(MAX_LOCK_MS)
  })

  it("keeps a guesser under a 1% chance a year of hitting a valid code", () => {
    // The worst case: the guesser tries again the moment each lock ends, for a year.
    const year = 365 * 24 * 60 * 60_000
    let now = 0
    let guesses = 0
    while (now < year) {
      guesses += 1
      now += lockDelayMs(guesses)
    }
    // The package accepts 3 codes at any moment (TOTP_WINDOW = 1) out of 10^6.
    const chancePerGuess = 3 / 1_000_000
    const chance = 1 - (1 - chancePerGuess) ** guesses
    expect(guesses).toBeLessThan(400)
    expect(chance).toBeLessThan(0.01)
  })
})
