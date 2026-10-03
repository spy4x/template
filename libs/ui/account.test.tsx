/**
 * The app frame and the account screens (profile, e-mail address, sign-in) driven in a browser DOM
 * (happy-dom): what opens, what the app's callbacks receive, and where focus goes.
 *
 * A form's native post is never sent here: a submit is dispatched as an event, and "posts
 * natively" means nothing cancelled it, which is what lets the browser post to the form's action.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { renderToString } from "preact-render-to-string"
import { UserMFAStatus, type UserPushTokenPublic } from "@domain/identity"
import { GroupRole } from "@domain/groups"
import { AuthScreen } from "./auth-screen.tsx"
import {
  EMAIL_FAILURES,
  EmailBanner,
  EmailScreen,
  type EmailScreenProps,
  EmailUnavailable,
} from "./email-screen.tsx"
import { AppFrame, navKey, PublicFrame } from "./frame.tsx"
import { ProfileScreen, type ProfileScreenProps } from "./profile-screen.tsx"
import { FORM_ACTIONS, SCREEN_PATHS } from "./progressive.tsx"

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
  const element = document.querySelector(selector)
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

/** Clicks an element and returns whether its default action was cancelled. */
async function click(selector: string, init: { ctrlKey?: boolean } = {}): Promise<boolean> {
  const event = new window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  })
  await act(() => {
    find(selector).dispatchEvent(event as unknown as Event)
  })
  return event.defaultPrevented
}

/** Clicks the button labelled `label` inside the dialog `dialog` names by its `data-e2e`. */
async function clickInDialog(dialog: string, label: string): Promise<void> {
  const button = [...document.querySelectorAll(`[data-e2e=${dialog}] button`)]
    .find((candidate) => candidate.textContent?.trim() === label)
  if (!button) throw new Error(`the ${dialog} dialog has no ${label} button`)
  await act(() => {
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event)
  })
}

/** Whether the dialog `data-e2e` names is open. */
function isOpen(dialog: string): boolean {
  return document.querySelector<HTMLDialogElement>(`dialog[data-e2e=${dialog}]`)?.open === true
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

const ada = { firstName: "Ada", lastName: "Lovelace" }

describe("AppFrame", () => {
  it("signs out from the user menu through the app's callback", async () => {
    const signOut = spy<[]>()
    await mount(<AppFrame user={ada} onSignOut={signOut.fn}>page</AppFrame>)

    await click("[data-e2e=shell-user-menu-button]")
    await click("[data-e2e=signout]")

    expect(signOut.calls).toHaveLength(1)
  })

  it("follows a plain click on a navigation entry through navigate, and leaves a Ctrl-click to the browser", async () => {
    const navigate = spy<[string]>()
    await mount(
      <AppFrame user={ada} onSignOut={() => {}} navigate={navigate.fn}>page</AppFrame>,
    )
    const groups = 'a[data-e2e="rail-shell-entry"][href="/groups"]'

    expect(await click(groups)).toBe(true)
    expect(await click(groups, { ctrlKey: true })).toBe(false)
    expect(navigate.calls).toEqual([["/groups"]])
  })

  it("marks the entry of the page shown, counting a note under Notes and the e-mail page under Profile", async () => {
    await mount(<AppFrame user={ada} onSignOut={() => {}} currentPath="/email">page</AppFrame>)

    const current = [...document.querySelectorAll('[aria-current="page"]')]
    expect(current.map((link) => link.getAttribute("href"))).toEqual(["/", "/"])
    expect(navKey("/notes/abc")).toBe("notes")
    expect(navKey("/groups/abc")).toBe("groups")
    expect(navKey("/billing")).toBe(undefined)
  })

  it("keeps a live connection out of sight but readable, and shows one that is down", async () => {
    await mount(<AppFrame user={ada} onSignOut={() => {}} connection="open">page</AppFrame>)
    const status = find("[data-e2e=shell-ws-status]")
    expect(status.textContent).toBe("Online")
    expect(status.className).toBe("sr-only")

    await rerender(<AppFrame user={ada} onSignOut={() => {}} connection="closed">page</AppFrame>)
    expect(status.textContent).toBe("Offline")
    expect(status.className).not.toContain("sr-only")
  })

  it("selects the group the person picks from the header's list, with a check mark on the current one", async () => {
    const select = spy<[string]>()
    const groups = [
      { id: "g-1", name: "Home", role: GroupRole.OWNER },
      { id: "g-2", name: "Team", role: GroupRole.VIEWER },
    ]
    await mount(
      <AppFrame
        user={ada}
        onSignOut={() => {}}
        groupPicker={{ groups, selectedId: "g-1", onSelect: select.fn }}
      >
        page
      </AppFrame>,
    )
    const input = find<HTMLInputElement>("#sidebar-group-picker")
    expect(input.value).toBe("Home")

    await act(() => {
      input.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }) as unknown as Event,
      )
    })
    const options = [...document.querySelectorAll("#sidebar-group-picker-listbox [role=option]")]
    expect(options.map((option) => option.textContent)).toEqual(["HomeOwner", "TeamViewer"])
    expect(options.map((option) => option.querySelector("svg") !== null)).toEqual([true, false])
    await act(() => {
      options[1].dispatchEvent(
        new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event,
      )
    })

    expect(select.calls).toEqual([["g-2"]])
  })
})

describe("PublicFrame", () => {
  it("signs out through the app's callback, and natively without one", async () => {
    const signOut = spy<[]>()
    await mount(<PublicFrame canSignOut onSignOut={signOut.fn}>page</PublicFrame>)
    expect(await submit(FORM_ACTIONS.signOut)).toBe(true)
    expect(signOut.calls).toHaveLength(1)

    await rerender(<PublicFrame canSignOut>page</PublicFrame>)
    expect(await submit(FORM_ACTIONS.signOut)).toBe(false)
  })

  it("follows the brand link through navigate instead of loading the page", async () => {
    const navigate = spy<[string]>()
    await mount(<PublicFrame canSignOut={false} navigate={navigate.fn}>page</PublicFrame>)

    expect(await click('a[href="/"]')).toBe(true)
    expect(navigate.calls).toEqual([["/"]])
  })
})

describe("AuthScreen", () => {
  it("links to the other mode under the card, keeping the page to return to", () => {
    const html = renderToString(
      <AuthScreen
        screen="sign-up"
        isSignedIn={false}
        isMfaRequired={false}
        busy={false}
        error={null}
        next="/notes"
      />,
    )
    expect(html).toMatch(/Already have an account\? <a [^>]*href="\/sign-in\?next=%2Fnotes"/)
    expect(html).not.toContain("auth-form-mode-switch")
  })
})

const device = {
  id: 1,
  deviceId: "device-0123456789",
  createdAt: new Date("2026-01-02T03:04:05Z"),
} as unknown as UserPushTokenPublic

const profileDefaults: ProfileScreenProps = {
  user: { mfa: UserMFAStatus.NOT_CONFIGURED, ...ada },
  isMfaRequired: false,
  email: { email: "ada@example.com", proven: true, pending: null },
  values: { ...ada, currentPassword: "", newPassword: "", otp: "" },
  onValueChange: () => {},
  errors: { fields: {}, profile: null, password: null, totp: null, push: null },
  pending: { profile: false, password: false, totp: false, push: false },
  enrolment: null,
  pushDevices: [device],
}

describe("ProfileScreen", () => {
  it("shows the name and the address with its state as rows, with no form open", async () => {
    await mount(<ProfileScreen {...profileDefaults} />)

    expect(find("[data-e2e=profile-name]").textContent).toBe("Ada Lovelace")
    expect(find("[data-e2e=profile-email-link]").getAttribute("href")).toBe(SCREEN_PATHS.email)
    expect(document.body.textContent).toContain("ada@example.com")
    expect(document.body.textContent).toContain("Verified")
    expect(document.body.textContent).not.toContain("Not verified")
    expect(isOpen("profile-dialog")).toBe(false)
    expect(isOpen("password-dialog")).toBe(false)
  })

  it("names each settings group by its own h2, under the page's one h1", async () => {
    await mount(<ProfileScreen {...profileDefaults} />)

    const names = [...document.querySelectorAll("section[aria-labelledby]")].map((section) =>
      document.getElementById(section.getAttribute("aria-labelledby") ?? "")?.textContent
    )
    expect(names).toEqual(["Account", "Security", "Push devices"])
    expect([...document.querySelectorAll("h1, h2")].map((h) => h.tagName)).toEqual(
      ["H1", "H2", "H2", "H2"],
    )
  })

  it("edits the name in a dialog, saves it through the app's callback and closes once it is saved", async () => {
    const change = spy<[string, string]>()
    const save = spy<[]>()
    const props = { ...profileDefaults, onValueChange: change.fn, onSaveProfile: save.fn }
    await mount(<ProfileScreen {...props} />)

    await click("[data-e2e=profile-edit]")
    expect(isOpen("profile-dialog")).toBe(true)
    await type("[data-e2e=profile-first-name]", "Grace")
    expect(change.calls).toEqual([["firstName", "Grace"]])
    expect(await submit(FORM_ACTIONS.profile)).toBe(true)
    expect(save.calls).toHaveLength(1)

    await rerender(<ProfileScreen {...props} pending={{ ...props.pending, profile: true }} />)
    expect(isOpen("profile-dialog")).toBe(true)
    await rerender(<ProfileScreen {...props} />)
    expect(isOpen("profile-dialog")).toBe(false)
  })

  it("keeps the password dialog open with the refusal tied to its field", async () => {
    const props = { ...profileDefaults, onChangePassword: () => {} }
    await mount(<ProfileScreen {...props} />)
    await click("[data-e2e=password-open]")
    expect(isOpen("password-dialog")).toBe(true)

    await rerender(<ProfileScreen {...props} pending={{ ...props.pending, password: true }} />)
    await rerender(
      <ProfileScreen
        {...props}
        errors={{ ...props.errors, fields: { newPassword: "must be at least 8 long" } }}
      />,
    )

    expect(isOpen("password-dialog")).toBe(true)
    const field = find("[data-e2e=password-new]")
    const describedBy = field.getAttribute("aria-describedby") ?? ""
    expect(field.getAttribute("aria-invalid")).toBe("true")
    expect(describedBy.split(" ").map((id) => document.getElementById(id)?.textContent))
      .toContain("must be at least 8 long")
    expect(focused()).toBe("password-new")
  })

  it("closes the password dialog once the change went through", async () => {
    await mount(<ProfileScreen {...profileDefaults} />)
    await click("[data-e2e=password-open]")

    const pending = { ...profileDefaults.pending, password: true }
    await rerender(<ProfileScreen {...profileDefaults} pending={pending} />)
    await rerender(<ProfileScreen {...profileDefaults} />)

    expect(isOpen("password-dialog")).toBe(false)
  })

  it("refuses a second save while the first is pending", async () => {
    const save = spy<[]>()
    const pending = { ...profileDefaults.pending, profile: true }
    await mount(<ProfileScreen {...profileDefaults} pending={pending} onSaveProfile={save.fn} />)
    await click("[data-e2e=profile-edit]")

    expect(await submit(FORM_ACTIONS.profile)).toBe(true)
    expect(save.calls).toEqual([])
  })

  it("opens a dialog for the first code of an enrolment, focused on the code, and cancels the enrolment from it", async () => {
    const start = spy<[]>()
    const cancel = spy<[]>()
    const props = { ...profileDefaults, onStartTotp: start.fn, onCancelTotp: cancel.fn }
    await mount(<ProfileScreen {...props} />)
    expect(document.querySelector("[data-e2e=totp-dialog]")).toBe(null)

    expect(await submit(FORM_ACTIONS.totpStart)).toBe(true)
    expect(start.calls).toHaveLength(1)
    await rerender(<ProfileScreen {...props} enrolment={{ qrcode: "<svg/>", secret: "ABC" }} />)

    expect(isOpen("totp-dialog")).toBe(true)
    expect(focused()).toBe("totp-connect-otp")
    expect(find("[data-e2e=totp-dialog]").textContent).toContain("ABC")
    await clickInDialog("totp-dialog", "Cancel")
    expect(cancel.calls).toHaveLength(1)
  })

  it("turns two-factor off only once the person confirms, and moves focus to Turn off when it comes on", async () => {
    const disable = spy<[]>()
    const enrolling = { qrcode: "<svg/>", secret: "ABC" }
    await mount(<ProfileScreen {...profileDefaults} enrolment={enrolling} />)
    const on = { ...profileDefaults.user!, mfa: UserMFAStatus.CONFIGURED }
    await rerender(<ProfileScreen {...profileDefaults} user={on} onDisableTotp={disable.fn} />)
    expect(focused()).toBe("totp-disable")

    await click("[data-e2e=totp-disable]")
    await clickInDialog("totp-disable-confirm", "Keep it on")
    expect(disable.calls).toEqual([])

    await click("[data-e2e=totp-disable]")
    await clickInDialog("totp-disable-confirm", "Turn off")
    expect(disable.calls).toHaveLength(1)
  })

  it("moves no focus when the page first draws a two-factor step", async () => {
    await mount(<ProfileScreen {...profileDefaults} />)

    expect(focused()).toBe("BODY")
  })

  it("offers Add this device in an empty list, and removes a device with its id", async () => {
    const remove = spy<[string]>()
    await mount(<ProfileScreen {...profileDefaults} onRemovePush={remove.fn} />)
    expect(await submit(FORM_ACTIONS.pushRemove)).toBe(true)
    expect(remove.calls).toEqual([[device.deviceId]])

    const register = spy<[]>()
    await rerender(
      <ProfileScreen {...profileDefaults} pushDevices={[]} onRegisterPush={register.fn} />,
    )
    expect(document.body.textContent).toContain("No devices yet")
    await click("[data-e2e=push-register]")
    expect(register.calls).toHaveLength(1)
  })

  it("points a signed-out visitor to sign-in, and a session owing its code to the code page", () => {
    const signedOut = renderToString(<ProfileScreen {...profileDefaults} user={null} />)
    expect(signedOut).toContain(`data-e2e="signin-required"`)
    expect(signedOut).toContain(`href="/sign-in"`)
    expect(renderToString(<ProfileScreen {...profileDefaults} isMfaRequired />))
      .toContain(`href="/totp"`)
  })
})

const emailDefaults: EmailScreenProps = {
  status: { email: "ann@example.com", proven: false, pending: null },
  values: { code: "", email: "", password: "" },
  onValueChange: () => {},
  errors: { verify: null, send: null, change: null },
  notices: { send: null, change: null },
  pending: { verify: false, send: false, change: false },
}

/** The e-mail page while its change request is on its way. */
const changePending = { ...emailDefaults.pending, change: true }

describe("EmailScreen", () => {
  it("reports the typed code and checks it through the app's callback", async () => {
    const change = spy<[string, string]>()
    const verify = spy<[]>()
    await mount(<EmailScreen {...emailDefaults} onValueChange={change.fn} onVerify={verify.fn} />)

    await type("[data-e2e=email-code]", "Ab3_x-9Q")

    expect(change.calls).toEqual([["code", "Ab3_x-9Q"]])
    expect(await submit(FORM_ACTIONS.emailVerify)).toBe(true)
    expect(verify.calls).toHaveLength(1)
  })

  it("refuses a second check while the first is pending", async () => {
    const verify = spy<[]>()
    const pending = { ...emailDefaults.pending, verify: true }
    await mount(<EmailScreen {...emailDefaults} pending={pending} onVerify={verify.fn} />)

    await submit(FORM_ACTIONS.emailVerify)

    expect(verify.calls).toHaveLength(0)
  })

  it("ties a refused code to the code field and moves focus there", async () => {
    await mount(<EmailScreen {...emailDefaults} />)
    find("[data-e2e=email-verify]").focus()

    const errors = { ...emailDefaults.errors, verify: "This code is wrong" }
    await rerender(<EmailScreen {...emailDefaults} errors={errors} />)

    const field = find("[data-e2e=email-code]")
    const describedBy = field.getAttribute("aria-describedby") ?? ""
    expect(describedBy.split(" ").map((id) => document.getElementById(id)?.textContent))
      .toContain("This code is wrong")
    expect(focused()).toBe("email-code")
  })

  it("shows the address with its state, and asks for no code once it is proven", async () => {
    const proven = { email: "ann@example.com", proven: true, pending: null }
    await mount(<EmailScreen {...emailDefaults} status={proven} />)

    expect(find("[data-e2e=email-current]").textContent).toBe("ann@example.com")
    expect(find("[data-e2e=email-state]").textContent).toBe("Verified")
    expect(document.querySelector("[data-e2e=email-verify-card]")).toBe(null)
  })

  it("changes the address in a dialog, which closes and hands focus to the new address's code", async () => {
    const changeAddress = spy<[]>()
    const proven = { email: "ann@example.com", proven: true, pending: null }
    const values = { code: "", email: "new@example.com", password: "Passw0rd!" }
    const props = { ...emailDefaults, status: proven, values, onChange: changeAddress.fn }
    await mount(<EmailScreen {...props} />)
    expect(isOpen("email-change-dialog")).toBe(false)

    await click("[data-e2e=email-change-open]")
    expect(isOpen("email-change-dialog")).toBe(true)
    const form = find<HTMLFormElement>(`form[action="${FORM_ACTIONS.emailChange}"]`)
    expect(Object.fromEntries(new FormData(form))).toEqual({
      email: "new@example.com",
      password: "Passw0rd!",
    })
    expect(await submit(FORM_ACTIONS.emailChange)).toBe(true)
    expect(changeAddress.calls).toHaveLength(1)

    await rerender(<EmailScreen {...props} pending={changePending} />)
    await rerender(<EmailScreen {...props} status={{ ...proven, pending: "new@example.com" }} />)
    expect(isOpen("email-change-dialog")).toBe(false)
    expect(focused()).toBe("email-code")
    expect(find("[data-e2e=email-verify-card]").textContent).toContain("new@example.com")
  })

  it("closes the change dialog when the address already waiting is asked for again", async () => {
    // The API answers a repeated request with the same address and the same notice.
    const waiting = { email: "ann@example.com", proven: true, pending: "new@example.com" }
    const notices = { send: null, change: "Enter the code we mailed to new@example.com." }
    const props = { ...emailDefaults, status: waiting, notices }
    await mount(<EmailScreen {...props} />)
    await click("[data-e2e=email-change-open]")

    await rerender(<EmailScreen {...props} pending={changePending} />)
    await rerender(<EmailScreen {...props} />)
    expect(isOpen("email-change-dialog")).toBe(false)
    expect(focused()).toBe("email-code")
  })

  it("keeps the change dialog closed once the new address is proven", async () => {
    const proven = { email: "ann@example.com", proven: true, pending: null }
    await mount(<EmailScreen {...emailDefaults} status={proven} />)
    await click("[data-e2e=email-change-open]")
    await rerender(<EmailScreen {...emailDefaults} status={proven} pending={changePending} />)
    await rerender(
      <EmailScreen {...emailDefaults} status={{ ...proven, pending: "new@example.com" }} />,
    )

    await rerender(
      <EmailScreen {...emailDefaults} status={{ ...proven, email: "new@example.com" }} />,
    )
    expect(isOpen("email-change-dialog")).toBe(false)
  })

  it("keeps the dialog open and moves focus to the new address when a change is refused", async () => {
    await mount(<EmailScreen {...emailDefaults} />)
    await click("[data-e2e=email-change-open]")

    const errors = { ...emailDefaults.errors, change: "Invalid password" }
    await rerender(<EmailScreen {...emailDefaults} pending={changePending} />)
    await rerender(<EmailScreen {...emailDefaults} errors={errors} />)

    expect(isOpen("email-change-dialog")).toBe(true)
    expect(focused()).toBe("email-new")
    expect(find("[data-e2e=email-change-dialog]").textContent).toContain("Invalid password")
  })

  it("tells a username account that the address replaces the username for sign-in", async () => {
    const status = { email: null, proven: false, pending: null }
    await mount(<EmailScreen {...emailDefaults} status={status} />)
    expect(find("[data-e2e=email-current]").textContent).toContain(
      "You sign in with your username.",
    )

    await click("[data-e2e=email-change-open]")
    expect(find("[data-e2e=email-change-dialog]").textContent)
      .toContain("Once you enter it, you sign in with that address.")
  })

  it("claims no mail was sent, since mail may be off", () => {
    const page = renderToString(<EmailScreen {...emailDefaults} />)
    const banner = renderToString(<EmailBanner status={emailDefaults.status} />)
    for (const html of [page, banner]) expect(html.toLowerCase()).not.toMatch(/\b(sent|mailed)\b/)
  })

  it("retries an unread address through the app's callback, or reloads the page without it", async () => {
    const retry = spy<[]>()
    await mount(<EmailUnavailable onRetry={retry.fn} />)

    expect(find("[role=alert]").textContent).toBe(EMAIL_FAILURES.load)
    await click("[data-e2e=email-retry]")
    expect(retry.calls).toHaveLength(1)

    await mount(<EmailUnavailable />)
    expect(document.querySelectorAll("[data-e2e=email-retry]")[1].getAttribute("href"))
      .toBe(SCREEN_PATHS.email)
  })
})

describe("EmailBanner", () => {
  it("warns with a link to the e-mail page while an address waits for its code", () => {
    const html = renderToString(<EmailBanner status={emailDefaults.status} />)
    expect(html).toMatch(/<a [^>]*href="\/email"[^>]*>Enter the code<\/a>/)
    expect(html).toContain("ann@example.com")
  })

  it("draws nothing once the address is proven, or before its state is known", () => {
    const proven = { email: "ann@example.com", proven: true, pending: null }
    expect(renderToString(<EmailBanner status={proven} />)).toBe("")
    expect(renderToString(<EmailBanner status={null} />)).toBe("")
  })
})
