/// <reference lib="deno.ns" />
/// <reference lib="deno.unstable" />
import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import plugin from "./boundary.ts"

/** The messages the boundary rule reports for `source`, as if it were a file in `libs/ui`. */
function report(source: string): string[] {
  return Deno.lint.runPlugin(plugin, "/repo/libs/ui/screen.tsx", source)
    .map((diagnostic) => diagnostic.message)
}

describe("libs/ui boundary rule", () => {
  it("rejects importing a signals store", () => {
    expect(report(`import { signal } from "@preact/signals"\nexport const s = signal(1)`))
      .toHaveLength(1)
    expect(report(`import { x } from "@spy4x/preact-signals/theme"\nexport const y = x`))
      .toHaveLength(1)
  })

  it("rejects importing the router", () => {
    expect(report(`import { useLocation } from "wouter-preact"\nexport const u = useLocation`))
      .toHaveLength(1)
  })

  it("rejects importing app code by alias or by relative path", () => {
    expect(
      report(`import { sessionState } from "@spa/state/session.ts"\nexport const s = sessionState`),
    )
      .toHaveLength(1)
    expect(report(`import { x } from "@api/services/sign-in.ts"\nexport const y = x`))
      .toHaveLength(1)
    expect(report(`import { x } from "../../apps/spa/src/state/auth.ts"\nexport const y = x`))
      .toHaveLength(1)
    expect(report(`export * from "../../apps/mpa/routes/index.tsx"`)).toHaveLength(1)
  })

  it("rejects fetch and the browser's page globals", () => {
    expect(report(`export const load = () => fetch("/api/auth/me")`)).toHaveLength(1)
    expect(report(`export const load = () => globalThis.fetch("/api")`)).toHaveLength(1)
    expect(report(`export const go = () => { location.href = "/" }`)).toHaveLength(1)
    expect(report(`export const w = () => window.innerWidth`)).toHaveLength(1)
  })

  it("allows library components, domain types and property names that match a global", () => {
    const source = [
      `import { Button } from "@spy4x/preact-ui/button"`,
      `import type { User } from "@domain/identity"`,
      `import { ScreenLink } from "./progressive.tsx"`,
      `export const a = { location: 1, fetch: 2 }`,
      `export const b = (e: { location: string }) => e.location`,
      `export const c = [Button, ScreenLink] as unknown as User`,
    ].join("\n")
    expect(report(source)).toEqual([])
  })
})
