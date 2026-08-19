import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import {
  AccessError,
  type Actor,
  assertMfaSatisfied,
  SessionMFAStatus,
  UserMFAStatus,
} from "./+lib.ts"

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: 1,
    userMfa: UserMFAStatus.NOT_CONFIGURED,
    sessionMfa: SessionMFAStatus.NOT_REQUIRED,
    ...overrides,
  }
}

describe("assertMfaSatisfied", () => {
  it("allows a user who has not configured a second factor", () => {
    assertMfaSatisfied(actor())
    assertMfaSatisfied(actor({ userMfa: UserMFAStatus.CONFIGURATION_NOT_FINISHED }))
  })

  it("allows a configured user whose session completed the second factor", () => {
    assertMfaSatisfied(actor({
      userMfa: UserMFAStatus.CONFIGURED,
      sessionMfa: SessionMFAStatus.COMPLETED,
    }))
  })

  it("rejects a configured user whose session has not completed the second factor", () => {
    for (const sessionMfa of [SessionMFAStatus.NOT_REQUIRED, SessionMFAStatus.NOT_PASSED_YET]) {
      const call = () =>
        assertMfaSatisfied(actor({ userMfa: UserMFAStatus.CONFIGURED, sessionMfa }))
      expect(call).toThrow(AccessError)
      expect(call).toThrow("Second factor")
    }
  })

  it("carries a code the transport can map to a status", () => {
    try {
      assertMfaSatisfied(actor({
        userMfa: UserMFAStatus.CONFIGURED,
        sessionMfa: SessionMFAStatus.NOT_PASSED_YET,
      }))
      throw new Error("expected AccessError")
    } catch (error) {
      expect(error).toBeInstanceOf(AccessError)
      expect((error as AccessError).code).toBe("MFA_REQUIRED")
    }
  })
})
