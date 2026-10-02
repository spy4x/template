import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import type { APIContext } from "./_types.ts"
import { applyBaseMiddleware } from "./base-middleware.ts"

function app() {
  const app = new Hono<APIContext>().basePath("/api")
  applyBaseMiddleware(app, { write: () => {}, parseAuth: async (_c, next) => await next() })
  app.get("/id", (c) => c.text(c.get("requestId")))
  return app
}

describe("the request id of an API call", () => {
  it("keeps an X-Request-Id of 128 characters whole", async () => {
    const id = "r".repeat(128)

    const response = await app().request("/api/id", { headers: { "X-Request-Id": id } })

    expect(await response.text()).toBe(id)
  })

  it("replaces an X-Request-Id of 129 characters, so it fits the audit column", async () => {
    const response = await app().request("/api/id", {
      headers: { "X-Request-Id": "r".repeat(129) },
    })

    const id = await response.text()
    expect(id.length).toBeGreaterThan(0)
    expect(id.length).toBeLessThanOrEqual(128)
  })
})
