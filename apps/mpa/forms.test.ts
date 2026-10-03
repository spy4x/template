import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { API_BODIES, FormRejected, MAX_FORM_BYTES, readForm } from "./forms.ts"

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}

describe("API_BODIES", () => {
  it("sends the subscription forms' fields as the API names them", () => {
    expect(API_BODIES.subscribe(form({ email: "ada@example.com", list: "news" })))
      .toEqual({ email: "ada@example.com", list: "news" })
    expect(API_BODIES.subscriptionToken(form({ list: "news", token: "t" })))
      .toEqual({ list: "news", token: "t" })
  })
})

describe("readForm", () => {
  it("reads a form post", async () => {
    const request = new Request("http://app.localhost/subscribe", {
      method: "POST",
      body: new URLSearchParams({ email: "ada@example.com" }),
    })
    expect((await readForm(request)).get("email")).toBe("ada@example.com")
  })

  it("answers 413 to a form over the cap instead of buffering it", async () => {
    const request = new Request("http://app.localhost/subscribe", {
      method: "POST",
      body: new URLSearchParams({ body: "x".repeat(MAX_FORM_BYTES) }),
    })
    const error = await readForm(request).catch((error) => error)
    expect(error).toBeInstanceOf(FormRejected)
    expect(error.status).toBe(413)
  })
})
