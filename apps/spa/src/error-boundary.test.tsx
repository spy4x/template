import { expect } from "@std/expect"
import { afterAll, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { act } from "preact/test-utils"
import { ErrorBoundary } from "./error-boundary.tsx"
import { startErrorReporting } from "./error-reporting.ts"

const window = new Window({ url: "http://app.localhost/" })
const own = { document: globalThis.document }

beforeAll(() => {
  Object.assign(globalThis, { document: window.document })
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

function Broken(): never {
  throw new Error("view blew up")
}

function mount(vnode: preact.ComponentChildren): HTMLElement {
  const root = window.document.createElement("div") as unknown as HTMLElement
  act(() => render(vnode, root))
  return root
}

describe("ErrorBoundary", () => {
  it("shows a reload message instead of a blank page, and reports the error once", async () => {
    const bodies: string[] = []
    startErrorReporting(
      { ERROR_REPORT_DSN: "https://key@errors.example.com/3" },
      new EventTarget(),
      () => "https://app.example.com/",
      ((_url: string, init: RequestInit) => {
        bodies.push(String(init.body))
        return Promise.resolve(new Response("{}"))
      }) as unknown as typeof fetch,
    )

    const root = mount(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(root.querySelector(`[role="alert"]`)?.textContent).toContain("Something went wrong.")
    expect(root.querySelector(`[data-e2e="render-error-reload"]`)?.textContent).toContain(
      "Reload the page",
    )
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toContain("view blew up")
  })

  it("draws its children untouched when nothing throws", () => {
    const root = mount(
      <ErrorBoundary>
        <p>fine</p>
      </ErrorBoundary>,
    )

    expect(root.innerHTML).toBe("<p>fine</p>")
  })
})
