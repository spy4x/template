import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { API_BODIES, FormRejected, MAX_FORM_BYTES, readForm } from "./forms.ts"

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}

describe("API_BODIES", () => {
  it("sends the auth forms' username, password and otp as the API names them", () => {
    expect(API_BODIES.credentials(form({ username: "ada", password: "secret-pass" })))
      .toEqual({ username: "ada", password: "secret-pass" })
    expect(API_BODIES.oneTimeCode(form({ otp: "012345" }))).toEqual({ otp: "012345" })
  })

  it("sends a note's version and a group's kind as numbers, the way the API's schema takes them", () => {
    expect(API_BODIES.noteUpdate(form({ title: "T", body: "B", version: "3" })))
      .toEqual({ title: "T", body: "B", version: 3 })
    expect(API_BODIES.groupCreate(form({ id: "g", kind: "2", name: "Trip" })))
      .toEqual({ id: "g", kind: 2, name: "Trip" })
  })

  it("leaves a version that is not a whole number for the API to refuse", () => {
    expect(API_BODIES.noteDelete(form({ version: "1e3" }))).toEqual({ version: "1e3" })
  })

  it("sends only the fields the API's schema names", () => {
    expect(API_BODIES.noteCreate(form({ id: "n", title: "T", body: "B", extra: "x" })))
      .toEqual({ id: "n", title: "T", body: "B" })
  })
})

describe("readForm", () => {
  it("reads a form post", async () => {
    const request = new Request("http://app.localhost/sign-in", {
      method: "POST",
      body: new URLSearchParams({ username: "ada" }),
    })
    expect((await readForm(request)).get("username")).toBe("ada")
  })

  it("answers 413 to a form over the cap instead of buffering it", async () => {
    const request = new Request("http://app.localhost/sign-in", {
      method: "POST",
      body: new URLSearchParams({ body: "x".repeat(MAX_FORM_BYTES) }),
    })
    const error = await readForm(request).catch((error) => error)
    expect(error).toBeInstanceOf(FormRejected)
    expect(error.status).toBe(413)
  })
})
