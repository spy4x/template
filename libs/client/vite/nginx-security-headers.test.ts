import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { inlineBlockHashes } from "@spy4x/server/http/security-headers"
import { nginxSecurityHeaders, spaSecurityHeaders } from "./nginx-security-headers.ts"

const PAGE = `<html><head>
<script>document.documentElement.classList.add("dark")</script>
<style>:root { color-scheme: light; }</style>
<script type="module" src="/assets/index.js"></script>
</head><body><div id="app"></div></body></html>`

async function directives(page: string): Promise<string[]> {
  const headers = new Map(await spaSecurityHeaders(page))
  return headers.get("content-security-policy")!.split("; ")
}

describe("spaSecurityHeaders", () => {
  it("allows the page's own inline script and style by their hashes, and no other inline code", async () => {
    const [script] = await inlineBlockHashes(PAGE, "script")
    const [style] = await inlineBlockHashes(PAGE, "style")

    const policy = await directives(PAGE)

    expect(policy).toContain(`script-src 'self' ${script}`)
    expect(policy).toContain(`style-src 'self' ${style} https://fonts.googleapis.com`)
    expect(policy.join("; ")).not.toContain("unsafe")
  })

  it("gives a page with a different inline script a different policy", async () => {
    const changed = PAGE.replace(`classList.add("dark")`, `classList.add("light")`)

    expect(await directives(changed)).not.toEqual(await directives(PAGE))
  })

  it("lets the page reach its own origin, Google's fonts and the error tracker, and nothing else", async () => {
    const policy = await directives(PAGE)

    expect(policy).toContain("default-src 'self'")
    expect(policy).toContain("connect-src 'self' $csp_error_tracker")
    expect(policy).toContain("font-src 'self' https://fonts.gstatic.com")
    expect(policy).toContain("img-src 'self' data:")
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("base-uri 'self'")
    expect(policy).toContain("form-action 'self'")
    expect(policy).toContain("frame-ancestors 'none'")
    const sources = policy.flatMap((directive) => directive.split(" ").slice(1))
    const beyondTheApp = sources.filter((source) => !/^'(self|none|sha256-[^']+)'$/.test(source))
    expect([...new Set(beyondTheApp)].sort()).toEqual([
      "$csp_error_tracker",
      "data:",
      "https://fonts.googleapis.com",
      "https://fonts.gstatic.com",
    ])
  })

  it("sends nosniff, no referrer, the frame ban and HSTS beside the policy", async () => {
    const headers = new Map(await spaSecurityHeaders(PAGE))

    expect(headers.get("x-content-type-options")).toBe("nosniff")
    expect(headers.get("referrer-policy")).toBe("no-referrer")
    expect(headers.get("x-frame-options")).toBe("DENY")
    expect(headers.get("strict-transport-security")).toBe("max-age=15552000; includeSubDomains")
  })
})

describe("nginxSecurityHeaders", () => {
  it("writes every header as one add_header line that nginx also sends with an error page", async () => {
    const headers = await spaSecurityHeaders(PAGE)

    const lines = (await nginxSecurityHeaders(PAGE)).split("\n")
      .filter((line) => line !== "" && !line.startsWith("#"))

    expect(lines).toEqual(headers.map(([name, value]) => `add_header ${name} "${value}" always;`))
    expect(lines.length).toBeGreaterThanOrEqual(5)
  })
})
