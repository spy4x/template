import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { JSX } from "preact"
import { ScreenLink, takeOver } from "./progressive.tsx"

/** A stand-in for a DOM event: records whether `preventDefault` was called. */
function fakeEvent(init: Partial<MouseEvent> = {}) {
  const event = {
    button: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    ...init,
    preventDefault() {
      event.defaultPrevented = true
    },
  }
  return event
}

/** Clicks a `ScreenLink` rendered with `navigate`, and reports what happened. */
function click(init: Partial<MouseEvent> = {}) {
  const visited: string[] = []
  const link = ScreenLink({
    href: "/sign-in",
    navigate: (href) => visited.push(href),
    children: "Sign in",
  }) as JSX.Element & { props: { onClick: (event: MouseEvent) => void } }
  const event = fakeEvent(init)
  link.props.onClick(event as unknown as MouseEvent)
  return { visited, prevented: event.defaultPrevented }
}

describe("ScreenLink", () => {
  it("follows a plain click through navigate instead of loading the page", () => {
    expect(click()).toEqual({ visited: ["/sign-in"], prevented: true })
  })

  it("leaves a modified or non-primary click to the browser", () => {
    for (
      const init of [
        { ctrlKey: true },
        { metaKey: true },
        { shiftKey: true },
        { altKey: true },
        { button: 1 },
      ]
    ) {
      expect(click(init)).toEqual({ visited: [], prevented: false })
    }
  })

  it("leaves every click to the browser without navigate", () => {
    const link = ScreenLink({ href: "/sign-in", children: "Sign in" }) as JSX.Element & {
      props: { href: string; onClick: (event: MouseEvent) => void }
    }
    const event = fakeEvent()
    link.props.onClick(event as unknown as MouseEvent)
    expect(event.defaultPrevented).toBe(false)
    expect(link.props.href).toBe("/sign-in")
  })
})

describe("takeOver", () => {
  it("cancels the native post and runs the callback", () => {
    let runs = 0
    const event = fakeEvent()
    takeOver(() => runs++)(event as unknown as JSX.TargetedEvent<HTMLFormElement, SubmitEvent>)
    expect({ runs, prevented: event.defaultPrevented }).toEqual({ runs: 1, prevented: true })
  })

  it("lets the browser post when there is no callback", () => {
    const event = fakeEvent()
    takeOver(undefined)(event as unknown as JSX.TargetedEvent<HTMLFormElement, SubmitEvent>)
    expect(event.defaultPrevented).toBe(false)
  })
})
