import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import { requestIdMiddleware } from "./request-id.ts"

function app() {
  const app = new Hono<{ Variables: { requestId: string } }>()
  app.use(requestIdMiddleware())
  app.get("/", (c) => c.text(c.get("requestId")))
  return app
}

describe("the request id of a REST call", () => {
  it("keeps an X-Request-Id of 128 characters whole", async () => {
    const id = "r".repeat(128)

    const response = await app().request("/", { headers: { "X-Request-Id": id } })

    expect(await response.text()).toBe(id)
  })

  it("replaces an X-Request-Id of 129 characters, so it fits the audit column", async () => {
    const response = await app().request("/", { headers: { "X-Request-Id": "r".repeat(129) } })

    const id = await response.text()
    expect(id.length).toBeGreaterThan(0)
    expect(id.length).toBeLessThanOrEqual(128)
    expect(id).not.toContain("rrrr")
  })
})
