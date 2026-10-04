import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { parseNotificationChange } from "./notification-hint.ts"

describe("parseNotificationChange", () => {
  it("reads a well-formed inbox change", () => {
    expect(parseNotificationChange(`{"userId":7}`)).toEqual({ userId: 7 })
  })

  it("drops a payload that does not name a positive integer user", () => {
    for (
      const bad of [`{}`, `{"userId":0}`, `{"userId":"7"}`, `{"userId":1.5}`, `[]`, `null`, `x`]
    ) {
      expect(parseNotificationChange(bad)).toBeNull()
    }
  })
})
