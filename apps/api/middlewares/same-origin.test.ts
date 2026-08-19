import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import type { APIContext } from "../_types.ts"
import { createSameOriginMutationGuard } from "./same-origin.ts"

function buildApp() {
  const app = new Hono<APIContext>()
  app.post(
    "/mutation",
    createSameOriginMutationGuard((c) => c.json({ rejected: true }, 403)),
    (c) => c.json({ accepted: true }),
  )
  return app
}

const acceptedHeaders = {
  cookie: "sessionIdToken=1:token",
  origin: "https://app.example.com",
  "sec-fetch-site": "same-origin",
}

describe("same-origin mutation guard", () => {
  it("accepts exact same-origin cookie requests", async () => {
    const response = await buildApp().request("https://app.example.com/mutation", {
      method: "POST",
      headers: acceptedHeaders,
    })
    expect(response.status).toBe(200)
  })

  it("rejects cross-origin requests", async () => {
    const response = await buildApp().request("https://app.example.com/mutation", {
      method: "POST",
      headers: {
        ...acceptedHeaders,
        origin: "https://evil.example.net",
        "sec-fetch-site": "cross-site",
      },
    })
    expect(response.status).toBe(403)
  })

  it("rejects same-site sibling origins", async () => {
    const response = await buildApp().request("https://app.example.com/mutation", {
      method: "POST",
      headers: {
        ...acceptedHeaders,
        origin: "https://admin.example.com",
        "sec-fetch-site": "same-site",
      },
    })
    expect(response.status).toBe(403)
  })

  it("rejects missing browser metadata", async () => {
    const response = await buildApp().request("https://app.example.com/mutation", {
      method: "POST",
      headers: { cookie: acceptedHeaders.cookie },
    })
    expect(response.status).toBe(403)
  })

  it("rejects current cookie route without a session cookie", async () => {
    const response = await buildApp().request("https://app.example.com/mutation", {
      method: "POST",
      headers: {
        origin: acceptedHeaders.origin,
        "sec-fetch-site": acceptedHeaders["sec-fetch-site"],
      },
    })
    expect(response.status).toBe(403)
  })
})
