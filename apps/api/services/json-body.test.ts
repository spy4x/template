import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import { MAX_JSON_BODY_BYTES, readApiJson } from "./json-body.ts"

/** A route that echoes the body it read, with Hono's default error handling. */
function buildApp() {
  return new Hono().post("/echo", async (c) => c.json({ body: await readApiJson(c) }))
}

/** A JSON string literal of exactly `bytes` bytes. */
function jsonOfSize(bytes: number): string {
  return JSON.stringify("a".repeat(bytes - 2))
}

describe("readApiJson", () => {
  it("accepts a body of exactly the cap", async () => {
    const body = jsonOfSize(MAX_JSON_BODY_BYTES)
    const response = await buildApp().request("http://local/echo", { method: "POST", body })

    expect(response.status).toBe(200)
    expect((await response.json()).body).toHaveLength(MAX_JSON_BODY_BYTES - 2)
  })

  it("answers a body one byte over the cap with 413", async () => {
    const body = jsonOfSize(MAX_JSON_BODY_BYTES + 1)
    const response = await buildApp().request("http://local/echo", { method: "POST", body })

    expect(response.status).toBe(413)
  })

  it("answers a body that is not JSON with 400", async () => {
    const response = await buildApp().request("http://local/echo", {
      method: "POST",
      body: `{"a":`,
    })

    expect(response.status).toBe(400)
  })
})
