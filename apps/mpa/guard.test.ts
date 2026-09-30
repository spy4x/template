import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { crossSiteRefusal } from "./guard.ts"

const origin = "https://app.example.com"

function post(headers: Record<string, string>): Request {
  return new Request(`${origin}/sign-out`, { method: "POST", headers })
}

describe("crossSiteRefusal", () => {
  it("lets a post from the app's own page through", () => {
    expect(crossSiteRefusal(post({ origin, "sec-fetch-site": "same-origin" }), origin))
      .toBeUndefined()
  })

  it("lets a same-origin post under no-referrer through, whose origin is null", () => {
    expect(crossSiteRefusal(post({ origin: "null", "sec-fetch-site": "same-origin" }), origin))
      .toBeUndefined()
  })

  it("refuses a post another site's page makes", () => {
    expect(
      crossSiteRefusal(
        post({ origin: "https://attacker.example", "sec-fetch-site": "cross-site" }),
        origin,
      ),
    ).toBe("not-same-origin-fetch")
  })

  it("refuses a post from a sibling subdomain, which the browser calls same-site", () => {
    expect(
      crossSiteRefusal(
        post({ origin: "https://evil.example.com", "sec-fetch-site": "same-site" }),
        origin,
      ),
    ).toBe("not-same-origin-fetch")
  })

  it("refuses a post whose origin is not the app's, whatever Sec-Fetch-Site says", () => {
    expect(
      crossSiteRefusal(
        post({ origin: "https://attacker.example", "sec-fetch-site": "same-origin" }),
        origin,
      ),
    ).toBe("origin-mismatch")
  })

  it("refuses a post without Sec-Fetch-Site, since nothing shows the app's page sent it", () => {
    expect(crossSiteRefusal(post({ origin }), origin)).toBe("not-same-origin-fetch")
  })

  it("lets page loads through unchecked", () => {
    expect(crossSiteRefusal(new Request(`${origin}/groups`), origin)).toBeUndefined()
  })
})
