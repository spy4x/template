import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { billingCheckoutRequestSchema } from "@domain/billing"
import { redirectUrl } from "./billing.tsx"
import { API_BODIES } from "./forms.ts"

describe("the MPA's billing", () => {
  it("sends the chosen plan as the API's checkout schema names it, and nothing else", () => {
    const form = new FormData()
    form.set("planId", "pro")
    form.set("extra", "x")

    const body = API_BODIES.billingCheckout(form)

    expect(body).toEqual({ planId: "pro" })
    expect(billingCheckoutRequestSchema(body)).toEqual({ planId: "pro" })
  })

  it("sends the browser only to a web page the API named", () => {
    expect(redirectUrl({ url: "https://checkout.stripe.com/c/pay/cs_1" }))
      .toBe("https://checkout.stripe.com/c/pay/cs_1")
    expect(redirectUrl({ url: "javascript:alert(1)" })).toBeNull()
    expect(redirectUrl({ url: "not a url" })).toBeNull()
    expect(redirectUrl({})).toBeNull()
    expect(redirectUrl(null)).toBeNull()
  })
})
