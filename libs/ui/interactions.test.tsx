/**
 * Every `libs/ui` component driven in a browser DOM (happy-dom): typing, submitting with and
 * without the app's callback, and where focus goes. `screens.test.tsx` covers what the server
 * renders; this file covers what a person does once the page runs.
 *
 * A form's native post is never sent here: a submit is dispatched as an event, and "posts
 * natively" means nothing cancelled it, which is what lets the browser post to the form's action.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { AuthScreen, type AuthScreenProps } from "./auth-screen.tsx"
import { FORM_ACTIONS } from "./progressive.tsx"
import {
  ForgotPasswordScreen,
  type ForgotPasswordScreenProps,
  ResetPasswordScreen,
  type ResetPasswordScreenProps,
} from "./password-reset-screen.tsx"
import {
  SUBSCRIBE_FAILURES,
  SubscribeForm,
  type SubscribeFormProps,
  SubscriptionConfirmScreen,
  type SubscriptionConfirmScreenProps,
  UnsubscribeScreen,
  type UnsubscribeScreenProps,
} from "./subscribe-screen.tsx"

const window = new Window({ url: "http://app.localhost/" })
const own = { document: globalThis.document, FormData: globalThis.FormData }

beforeAll(() => {
  // Preact draws into `document`; EnhancedForm reads a form with `new FormData(form)`, which only
  // the DOM's own FormData can do.
  Object.assign(globalThis, { document: window.document, FormData: window.FormData })
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

let root: HTMLElement | null = null

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  document.body.innerHTML = ""
  root = null
})

/** Renders `node` into a fresh element in the page, effects run. */
async function mount(node: VNode): Promise<HTMLElement> {
  root = document.createElement("div")
  document.body.append(root)
  await act(() => render(node, root!))
  return root
}

/** Renders `node` in place of what `mount` drew, the way an app re-renders with new props. */
async function rerender(node: VNode): Promise<void> {
  await act(() => render(node, root!))
}

/** The one element `selector` finds, or a failure naming it. */
function find<T extends Element = HTMLElement>(selector: string): T {
  const element = root?.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

/** Types `value` into a field the way a person does: the value changes, then `input` fires. */
async function type(selector: string, value: string): Promise<void> {
  const field = find<HTMLInputElement>(selector)
  field.value = value
  await act(() => {
    field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  })
}

/**
 * Submits the form posting to `action`, from its submit button, and lets EnhancedForm's callback
 * run. Returns whether the native post was cancelled.
 */
async function submit(action: string): Promise<boolean> {
  const form = find<HTMLFormElement>(`form[action="${action}"]`)
  form.querySelector<HTMLButtonElement>("button[type=submit]")?.focus()
  const event = new window.SubmitEvent("submit", { bubbles: true, cancelable: true })
  await act(async () => {
    form.dispatchEvent(event as unknown as Event)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return event.defaultPrevented
}

/**
 * What has focus: its `data-e2e`, or its tag name when it has none. A string, so a failed check
 * prints two names instead of diffing two DOM nodes, which never finishes.
 */
function focused(): string | undefined {
  const element = document.activeElement
  return element?.getAttribute("data-e2e") ?? element?.tagName
}

/** Records every call made to the function it hands out. */
function spy<A extends unknown[]>(): { calls: A[]; fn: (...args: A) => void } {
  const calls: A[] = []
  return { calls, fn: (...args: A) => void calls.push(args) }
}

const authDefaults: AuthScreenProps = {
  screen: "sign-in",
  isSignedIn: false,
  isMfaRequired: false,
  busy: false,
  error: null,
}

describe("AuthScreen in the browser", () => {
  it("signs in with what the person typed through the app's callback instead of the native post", async () => {
    const signIn = spy<[{ login: string; password: string }]>()
    await mount(<AuthScreen {...authDefaults} onSignIn={signIn.fn} />)

    await type("input[name=login]", "ada@example.com")
    await type("input[name=password]", "long-enough")

    expect(await submit(FORM_ACTIONS.signIn)).toBe(true)
    expect(signIn.calls).toEqual([[{ login: "ada@example.com", password: "long-enough" }]])
  })

  it("posts the sign-in natively when the app takes nothing over", async () => {
    await mount(<AuthScreen {...authDefaults} />)

    expect(await submit(FORM_ACTIONS.signIn)).toBe(false)
  })

  it("sends the one-time code through the app's callback", async () => {
    const code = spy<[string]>()
    await mount(
      <AuthScreen {...authDefaults} screen="one-time-code" isMfaRequired onOneTimeCode={code.fn} />,
    )

    await type("input[name=otp]", "012345")

    expect(await submit(FORM_ACTIONS.oneTimeCode)).toBe(true)
    expect(code.calls).toEqual([["012345"]])
  })
})

const forgotDefaults: ForgotPasswordScreenProps = {
  email: "",
  onEmailChange: () => {},
  sent: false,
  error: null,
  pending: false,
}

describe("ForgotPasswordScreen in the browser", () => {
  it("reports the typed address and asks for the link through the app's callback", async () => {
    const change = spy<[string]>()
    const send = spy<[]>()
    await mount(
      <ForgotPasswordScreen {...forgotDefaults} onEmailChange={change.fn} onSubmit={send.fn} />,
    )

    await type("[data-e2e=forgot-password-email]", "ada@example.com")

    expect(change.calls).toEqual([["ada@example.com"]])
    expect(await submit(FORM_ACTIONS.forgotPassword)).toBe(true)
    expect(send.calls).toHaveLength(1)
  })

  it("posts the address natively when the app takes nothing over", async () => {
    await mount(<ForgotPasswordScreen {...forgotDefaults} email="ada@example.com" />)

    const form = find<HTMLFormElement>(`form[action="${FORM_ACTIONS.forgotPassword}"]`)
    expect(Object.fromEntries(new FormData(form))).toEqual({ email: "ada@example.com" })
    expect(await submit(FORM_ACTIONS.forgotPassword)).toBe(false)
  })

  it("ties an error to the address field and moves focus there", async () => {
    await mount(<ForgotPasswordScreen {...forgotDefaults} />)
    find("[data-e2e=forgot-password-submit]").focus()

    await rerender(
      <ForgotPasswordScreen {...forgotDefaults} error="Enter a valid e-mail address" />,
    )

    const field = find("[data-e2e=forgot-password-email]")
    const describedBy = field.getAttribute("aria-describedby") ?? ""
    expect(field.getAttribute("aria-invalid")).toBe("true")
    expect(describedBy.split(" ").map((id) => document.getElementById(id)?.textContent))
      .toContain("Enter a valid e-mail address")
    expect(focused()).toBe("forgot-password-email")
  })
})

const resetDefaults: ResetPasswordScreenProps = {
  email: "ada@example.com",
  code: "code-from-the-link",
  newPassword: "",
  onNewPasswordChange: () => {},
  done: false,
  error: null,
  pending: false,
}

describe("ResetPasswordScreen in the browser", () => {
  it("reports the new password and saves it through the app's callback", async () => {
    const change = spy<[string]>()
    const save = spy<[]>()
    await mount(
      <ResetPasswordScreen
        {...resetDefaults}
        onNewPasswordChange={change.fn}
        onSubmit={save.fn}
      />,
    )

    await type("[data-e2e=reset-password-new]", "battery-staple")

    expect(change.calls).toEqual([["battery-staple"]])
    expect(await submit(FORM_ACTIONS.resetPassword)).toBe(true)
    expect(save.calls).toHaveLength(1)
  })

  it("posts the link's address and code with the new password when the app takes nothing over", async () => {
    await mount(<ResetPasswordScreen {...resetDefaults} newPassword="battery-staple" />)

    const form = find<HTMLFormElement>(`form[action="${FORM_ACTIONS.resetPassword}"]`)
    const sent = Object.fromEntries(new FormData(form))
    expect(sent).toEqual({
      email: "ada@example.com",
      code: "code-from-the-link",
      newPassword: "battery-staple",
    })
    expect(await submit(FORM_ACTIONS.resetPassword)).toBe(false)
  })

  it("ties an error to the new password field and moves focus there", async () => {
    await mount(<ResetPasswordScreen {...resetDefaults} />)
    find("[data-e2e=reset-password-submit]").focus()

    await rerender(<ResetPasswordScreen {...resetDefaults} error="This link is used" />)

    const field = find("[data-e2e=reset-password-new]")
    const describedBy = field.getAttribute("aria-describedby") ?? ""
    expect(describedBy.split(" ").map((id) => document.getElementById(id)?.textContent))
      .toContain("This link is used")
    expect(focused()).toBe("reset-password-new")
  })
})

const subscribeDefaults: SubscribeFormProps = {
  email: "",
  onEmailChange: () => {},
  list: "news",
  sent: false,
  error: null,
  pending: false,
}

describe("SubscribeForm in the browser", () => {
  it("reports the typed address and subscribes through the app's callback", async () => {
    const change = spy<[string]>()
    const send = spy<[]>()
    await mount(
      <SubscribeForm {...subscribeDefaults} onEmailChange={change.fn} onSubmit={send.fn} />,
    )

    await type("[data-e2e=subscribe-email]", "ada@example.com")

    expect(change.calls).toEqual([["ada@example.com"]])
    expect(await submit(FORM_ACTIONS.subscribe)).toBe(true)
    expect(send.calls).toHaveLength(1)
  })

  it("posts the address and the list natively when the app takes nothing over", async () => {
    await mount(<SubscribeForm {...subscribeDefaults} email="ada@example.com" />)

    const form = find<HTMLFormElement>(`form[action="${FORM_ACTIONS.subscribe}"]`)
    expect(Object.fromEntries(new FormData(form))).toEqual({
      list: "news",
      email: "ada@example.com",
    })
    expect(await submit(FORM_ACTIONS.subscribe)).toBe(false)
  })

  it("ties an error to the address field and moves focus there", async () => {
    await mount(<SubscribeForm {...subscribeDefaults} />)
    find("[data-e2e=subscribe-submit]").focus()

    await rerender(<SubscribeForm {...subscribeDefaults} error="Enter a valid e-mail address" />)

    const field = find("[data-e2e=subscribe-email]")
    const describedBy = field.getAttribute("aria-describedby") ?? ""
    expect(describedBy.split(" ").map((id) => document.getElementById(id)?.textContent))
      .toContain("Enter a valid e-mail address")
    expect(focused()).toBe("subscribe-email")
  })

  it("moves focus to the outcome once the link is sent", async () => {
    await mount(<SubscribeForm {...subscribeDefaults} />)
    find("[data-e2e=subscribe-submit]").focus()

    await rerender(<SubscribeForm {...subscribeDefaults} sent />)

    expect(focused()).toBe("subscribe-sent-status")
  })

  it("leaves focus alone on a page that opens on the outcome", async () => {
    await mount(<SubscribeForm {...subscribeDefaults} sent />)

    expect(focused()).not.toBe("subscribe-sent-status")
  })
})

const confirmDefaults: SubscriptionConfirmScreenProps = {
  state: "confirm",
  list: "news",
  token: "token-from-the-link",
  error: null,
  pending: false,
}

describe("SubscriptionConfirmScreen in the browser", () => {
  it("confirms through the app's callback", async () => {
    const confirm = spy<[]>()
    await mount(<SubscriptionConfirmScreen {...confirmDefaults} onSubmit={confirm.fn} />)

    expect(await submit(FORM_ACTIONS.subscribeConfirm)).toBe(true)
    expect(confirm.calls).toHaveLength(1)
  })

  it("posts the link's list and token natively when the app takes nothing over", async () => {
    await mount(<SubscriptionConfirmScreen {...confirmDefaults} />)

    const form = find<HTMLFormElement>(`form[action="${FORM_ACTIONS.subscribeConfirm}"]`)
    expect(Object.fromEntries(new FormData(form)))
      .toEqual({ list: "news", token: "token-from-the-link" })
    expect(await submit(FORM_ACTIONS.subscribeConfirm)).toBe(false)
  })

  it("shows a failed confirm under the form and moves focus there", async () => {
    await mount(<SubscriptionConfirmScreen {...confirmDefaults} />)
    find("[data-e2e=subscription-confirm-submit]").focus()

    await rerender(<SubscriptionConfirmScreen {...confirmDefaults} state="error" />)

    expect(find("[data-e2e=subscription-confirm-error]").textContent)
      .toBe(SUBSCRIBE_FAILURES.confirm)
    expect(focused()).toBe("subscription-confirm-error")
  })

  it("moves focus to the outcome once the subscription is confirmed", async () => {
    await mount(<SubscriptionConfirmScreen {...confirmDefaults} />)
    find("[data-e2e=subscription-confirm-submit]").focus()

    await rerender(<SubscriptionConfirmScreen {...confirmDefaults} state="done" />)

    expect(focused()).toBe("subscription-confirm-done-status")
  })
})

const unsubscribeDefaults: UnsubscribeScreenProps = {
  state: "confirm",
  list: "news",
  token: "token-from-the-link",
  error: null,
  pending: false,
}

describe("UnsubscribeScreen in the browser", () => {
  it("unsubscribes through the app's callback", async () => {
    const leave = spy<[]>()
    await mount(<UnsubscribeScreen {...unsubscribeDefaults} onSubmit={leave.fn} />)

    expect(await submit(FORM_ACTIONS.unsubscribe)).toBe(true)
    expect(leave.calls).toHaveLength(1)
  })

  it("posts the link's list and token natively when the app takes nothing over", async () => {
    await mount(<UnsubscribeScreen {...unsubscribeDefaults} />)

    const form = find<HTMLFormElement>(`form[action="${FORM_ACTIONS.unsubscribe}"]`)
    expect(Object.fromEntries(new FormData(form)))
      .toEqual({ list: "news", token: "token-from-the-link" })
    expect(await submit(FORM_ACTIONS.unsubscribe)).toBe(false)
  })

  it("shows a failed unsubscribe under the form and moves focus there", async () => {
    await mount(<UnsubscribeScreen {...unsubscribeDefaults} />)
    find("[data-e2e=unsubscribe-submit]").focus()

    await rerender(<UnsubscribeScreen {...unsubscribeDefaults} state="error" />)

    expect(find("[data-e2e=unsubscribe-error]").textContent).toBe(SUBSCRIBE_FAILURES.unsubscribe)
    expect(focused()).toBe("unsubscribe-error")
  })

  it("moves focus to the outcome once the address is removed", async () => {
    await mount(<UnsubscribeScreen {...unsubscribeDefaults} />)
    find("[data-e2e=unsubscribe-submit]").focus()

    await rerender(<UnsubscribeScreen {...unsubscribeDefaults} state="done" />)

    expect(focused()).toBe("unsubscribe-done-status")
  })
})
