import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { DEFAULT_SUBSCRIBER_LIST, isSubscriberList, SUBSCRIBER_LISTS } from "./+lib.ts"

describe("subscriber lists", () => {
  it("knows the lists the template ships and refuses any other name", () => {
    expect(SUBSCRIBER_LISTS).toContain(DEFAULT_SUBSCRIBER_LIST)
    expect(isSubscriberList(`news`)).toBe(true)
    expect(isSubscriberList(`admin`)).toBe(false)
    expect(isSubscriberList(undefined)).toBe(false)
  })
})
