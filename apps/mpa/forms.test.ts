import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { API_BODIES, FormRejected, MAX_FORM_BYTES, readForm } from "./forms.ts"

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}

describe("API_BODIES", () => {
  it("sends the auth forms' fields as the API names them", () => {
    expect(API_BODIES.signIn(form({ login: "ada@example.com", password: "secret-pass" })))
      .toEqual({ login: "ada@example.com", password: "secret-pass" })
    expect(API_BODIES.signUp(form({ email: "ada@example.com", password: "secret-pass" })))
      .toEqual({ email: "ada@example.com", password: "secret-pass" })
    expect(API_BODIES.oneTimeCode(form({ otp: "012345" }))).toEqual({ otp: "012345" })
    expect(API_BODIES.forgotPassword(form({ email: "ada@example.com" })))
      .toEqual({ email: "ada@example.com" })
    expect(
      API_BODIES.resetPassword(form({ email: "ada@example.com", code: "c", newPassword: "pw" })),
    ).toEqual({ email: "ada@example.com", code: "c", newPassword: "pw" })
  })

  it("sends the subscription forms' fields as the API names them", () => {
    expect(API_BODIES.subscribe(form({ email: "ada@example.com", list: "news" })))
      .toEqual({ email: "ada@example.com", list: "news" })
    expect(API_BODIES.subscriptionToken(form({ list: "news", token: "t" })))
      .toEqual({ list: "news", token: "t" })
  })

  it("sends a note's version as a number, the way the API's schema takes it", () => {
    expect(API_BODIES.noteUpdate(form({ title: "T", body: "B", version: "3" })))
      .toEqual({ title: "T", body: "B", version: 3 })
  })

  it("sends a group's create and rename as the API's schema names the fields", () => {
    expect(API_BODIES.groupCreate(form({ id: "g", name: "Trip", kind: "2" })))
      .toEqual({ id: "g", name: "Trip" })
    expect(API_BODIES.groupRename(form({ name: "Trek", extra: "x" }))).toEqual({ name: "Trek" })
  })

  it("sends a member's new role as a number, and leaves anything else for the API to refuse", () => {
    expect(API_BODIES.groupMemberRole(form({ role: "2", userId: "7" }))).toEqual({ role: 2 })
    expect(API_BODIES.groupMemberRole(form({ role: "admin" }))).toEqual({ role: "admin" })
  })

  it("sends an invitation's numbers as numbers and its boxes as booleans, unticked as false", () => {
    const fields = { role: "2", expiresInDays: "7", maxUses: "3", email: "" }
    expect(
      API_BODIES.invitationCreate(form({ ...fields, sendEmail: "true", acceptSeatPrice: "true" })),
    ).toEqual({
      role: 2,
      expiresInDays: 7,
      maxUses: 3,
      email: "",
      sendEmail: true,
      acceptSeatPrice: true,
    })
    expect(API_BODIES.invitationCreate(form(fields)).sendEmail).toBe(false)
    expect(API_BODIES.invitationCreate(form(fields)).acceptSeatPrice).toBe(false)
  })

  it("answers an invitation by its token, or by its id when the form has no token", () => {
    expect(API_BODIES.invitationAnswer(form({ token: "t", invitationId: "i" })))
      .toEqual({ token: "t" })
    expect(API_BODIES.invitationAnswer(form({ invitationId: "i" }))).toEqual({ invitationId: "i" })
  })

  it("leaves a version that is not a whole number for the API to refuse", () => {
    expect(API_BODIES.noteDelete(form({ version: "1e3" }))).toEqual({ version: "1e3" })
  })

  it("reads every ticked note of the move form, in the order of the page", () => {
    const data = form({ toGroupId: "g" })
    data.append("noteIds", "a")
    data.append("noteIds", "b")

    expect(API_BODIES.noteMoveMany(data)).toEqual({ toGroupId: "g", noteIds: ["a", "b"] })
  })

  it("names the one note moved by the address, not by a field of the form", () => {
    const data = form({ toGroupId: "g", noteIds: "other" })

    expect(API_BODIES.noteMoveOne(data, "n")).toEqual({ toGroupId: "g", noteIds: ["n"] })
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
