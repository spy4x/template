import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { isSpaPath } from "./spa-paths.ts"

describe("isSpaPath", () => {
  it("knows the SPA's own paths", () => {
    for (const path of ["/", "/notes", "/notes/new", "/groups", "/sign-in", "/totp", "/email"]) {
      expect(isSpaPath(path), path).toBe(true)
    }
  })

  it("leaves server paths to the browser", () => {
    for (const path of ["/api/ws", "/notesx", "/assets/app.js"]) {
      expect(isSpaPath(path), path).toBe(false)
    }
  })
})
