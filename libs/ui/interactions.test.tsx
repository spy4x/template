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
import { UserMFAStatus, type UserPushTokenPublic } from "@domain/identity"
import { GroupKind, GroupRole } from "@domain/groups"
import { AuthScreen, type AuthScreenProps } from "./auth-screen.tsx"
import { AppFrame, PublicFrame } from "./frame.tsx"
import { GroupSettingsScreen } from "./group-settings-screen.tsx"
import { GroupsScreen, type GroupsScreenProps } from "./groups-screen.tsx"
import { NoteEditorScreen, type NoteEditorScreenProps } from "./note-editor-screen.tsx"
import { ProfileScreen, type ProfileScreenProps } from "./profile-screen.tsx"
import { FORM_ACTIONS, NOTE_PATHS } from "./progressive.tsx"
import {
  ForgotPasswordScreen,
  type ForgotPasswordScreenProps,
  ResetPasswordScreen,
  type ResetPasswordScreenProps,
} from "./password-reset-screen.tsx"

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

/** Clicks an element and returns whether its default action was cancelled. */
async function click(selector: string): Promise<boolean> {
  const event = new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
  await act(() => {
    find(selector).dispatchEvent(event as unknown as Event)
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

const device = {
  id: 1,
  deviceId: "device-0123456789",
  createdAt: new Date("2026-01-02T03:04:05Z"),
} as unknown as UserPushTokenPublic

const profileDefaults: ProfileScreenProps = {
  user: { mfa: UserMFAStatus.NOT_CONFIGURED },
  isMfaRequired: false,
  values: { firstName: "Ada", lastName: "Lovelace", currentPassword: "", newPassword: "", otp: "" },
  onValueChange: () => {},
  errors: { fields: {}, profile: null, password: null, totp: null, push: null },
  pending: { profile: false, password: false, totp: false, push: false },
  enrolment: null,
  pushDevices: [device],
}

describe("ProfileScreen in the browser", () => {
  it("reports each change to a field to the app", async () => {
    const change = spy<[string, string]>()
    await mount(<ProfileScreen {...profileDefaults} onValueChange={change.fn} />)

    await type("[data-e2e=profile-first-name]", "Grace")

    expect(change.calls).toEqual([["firstName", "Grace"]])
  })

  it("saves the name through the app's callback, and posts it natively without one", async () => {
    const save = spy<[]>()
    await mount(<ProfileScreen {...profileDefaults} onSaveProfile={save.fn} />)
    expect(await submit(FORM_ACTIONS.profile)).toBe(true)
    expect(save.calls).toHaveLength(1)

    await rerender(<ProfileScreen {...profileDefaults} />)
    expect(await submit(FORM_ACTIONS.profile)).toBe(false)
  })

  it("refuses a second save while the first is pending", async () => {
    const save = spy<[]>()
    await mount(
      <ProfileScreen
        {...profileDefaults}
        pending={{ ...profileDefaults.pending, profile: true }}
        onSaveProfile={save.fn}
      />,
    )

    expect(await submit(FORM_ACTIONS.profile)).toBe(true)
    expect(save.calls).toEqual([])
  })

  it("ties a field's error to the field and marks it invalid", async () => {
    await mount(
      <ProfileScreen
        {...profileDefaults}
        errors={{ ...profileDefaults.errors, fields: { newPassword: "must be at least 8 long" } }}
      />,
    )

    const field = find("[data-e2e=password-new]")
    const describedBy = field.getAttribute("aria-describedby") ?? ""
    expect(field.getAttribute("aria-invalid")).toBe("true")
    expect(describedBy.split(" ").map((id) => document.getElementById(id)?.textContent))
      .toContain("must be at least 8 long")
  })

  it("moves focus to the first field with an error after a failed submit", async () => {
    await mount(<ProfileScreen {...profileDefaults} />)
    find("[data-e2e=password-save]").focus()

    await rerender(
      <ProfileScreen
        {...profileDefaults}
        errors={{
          ...profileDefaults.errors,
          fields: { newPassword: "too short", lastName: "too long" },
        }}
      />,
    )

    expect(focused()).toBe("profile-last-name")
  })

  it("moves focus to the code field after Enable 2FA, and to Disable 2FA once it is on", async () => {
    await mount(<ProfileScreen {...profileDefaults} />)
    find("[data-e2e=totp-start]").focus()

    await rerender(
      <ProfileScreen {...profileDefaults} enrolment={{ qrcode: "<svg/>", secret: "ABC" }} />,
    )
    expect(focused()).toBe("totp-connect-otp")

    await rerender(<ProfileScreen {...profileDefaults} user={{ mfa: UserMFAStatus.CONFIGURED }} />)
    expect(focused()).toBe("totp-disable")
  })

  it("moves no focus when the page first draws a two-factor step", async () => {
    await mount(
      <ProfileScreen {...profileDefaults} enrolment={{ qrcode: "<svg/>", secret: "ABC" }} />,
    )

    expect(focused()).toBe("BODY")
  })

  it("removes a push device through the app's callback with that device's id", async () => {
    const remove = spy<[string]>()
    await mount(<ProfileScreen {...profileDefaults} onRemovePush={remove.fn} />)

    expect(await submit(FORM_ACTIONS.pushRemove)).toBe(true)
    expect(remove.calls).toEqual([[device.deviceId]])
  })
})

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
const note = {
  id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001",
  title: "Groceries",
  body: "",
  version: 3,
}
const noError = { title: null, form: null }
const editorDefaults: NoteEditorScreenProps = {
  group: { id: groupId, name: "Team", canWrite: true },
  loading: false,
  notFound: false,
  note: null,
  value: { title: "", body: "" },
  draftId: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111009",
  errors: noError,
  saving: false,
  deleting: false,
}
const existing = { id: note.id, version: 3, conflict: false }

/** Clicks the first button of the open delete dialog with this label. */
async function clickDialogButton(label: string): Promise<void> {
  const button = [...document.querySelectorAll("[data-e2e=note-delete-dialog] button")]
    .find((candidate) => candidate.textContent?.trim() === label)
  if (!button) throw new Error(`the dialog has no ${label} button`)
  await act(() => {
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event)
  })
}

describe("NoteEditorScreen in the browser", () => {
  it("reports the typed title and creates the note through the app's callbacks", async () => {
    const change = spy<[{ title: string; body: string }]>()
    const save = spy<[]>()
    await mount(<NoteEditorScreen {...editorDefaults} onChange={change.fn} onSave={save.fn} />)

    await type("[data-e2e=note-title]", "Trip")

    expect(change.calls).toEqual([[{ title: "Trip", body: "" }]])
    expect(await submit(NOTE_PATHS.create(groupId))).toBe(true)
    expect(save.calls).toHaveLength(1)
  })

  it("posts natively when the app takes nothing over", async () => {
    await mount(<NoteEditorScreen {...editorDefaults} />)

    expect(await submit(NOTE_PATHS.create(groupId))).toBe(false)
  })

  it("asks before deleting, and deletes only when the person confirms", async () => {
    const remove = spy<[]>()
    await mount(
      <NoteEditorScreen {...editorDefaults} note={existing} value={note} onDelete={remove.fn} />,
    )

    await click("[data-e2e=note-delete]")
    expect(remove.calls).toEqual([])
    expect(find("[data-e2e=note-delete-dialog]").textContent).toContain("Delete this note?")

    await clickDialogButton("Delete")
    expect(remove.calls).toHaveLength(1)
  })

  it("deletes nothing when the person keeps the note", async () => {
    const remove = spy<[]>()
    await mount(
      <NoteEditorScreen {...editorDefaults} note={existing} value={note} onDelete={remove.fn} />,
    )
    await click("[data-e2e=note-delete]")

    await clickDialogButton("Keep it")

    expect(remove.calls).toEqual([])
    expect(document.querySelector("[data-e2e=note-delete-dialog]")).toBe(null)
  })

  it("moves focus to the title when it gets an error", async () => {
    await mount(<NoteEditorScreen {...editorDefaults} />)

    await rerender(
      <NoteEditorScreen {...editorDefaults} errors={{ title: "Enter a title", form: null }} />,
    )

    expect(focused()).toBe("note-title")
  })
})

const groupsDefaults: GroupsScreenProps = {
  groups: [{ id: "g-1", name: "Home", kind: GroupKind.PERSONAL, role: GroupRole.OWNER }],
  selectedId: "g-1",
  name: "",
  creating: false,
  loading: false,
  error: null,
}

describe("GroupsScreen in the browser", () => {
  it("reports the typed name, creates the group and refreshes through the app's callbacks", async () => {
    const name = spy<[string]>()
    const create = spy<[]>()
    const refresh = spy<[]>()
    await mount(
      <GroupsScreen
        {...groupsDefaults}
        onNameChange={name.fn}
        onCreate={create.fn}
        onRefresh={refresh.fn}
      />,
    )

    await type("[data-e2e=group-name]", "Trip")
    expect(name.calls).toEqual([["Trip"]])
    expect(await submit(FORM_ACTIONS.groupCreate)).toBe(true)
    expect(create.calls).toHaveLength(1)
    await click("[data-e2e=group-refresh]")
    expect(refresh.calls).toHaveLength(1)
  })

  it("refuses a second create while the first is pending, and posts natively without a callback", async () => {
    const create = spy<[]>()
    await mount(<GroupsScreen {...groupsDefaults} creating onCreate={create.fn} />)
    expect(await submit(FORM_ACTIONS.groupCreate)).toBe(true)
    expect(create.calls).toEqual([])

    await rerender(<GroupsScreen {...groupsDefaults} />)
    expect(await submit(FORM_ACTIONS.groupCreate)).toBe(false)
  })

  it("opens a group's notes through the app's callback, and posts natively without one", async () => {
    const open = spy<[string]>()
    const groups = [{ id: "g-1", name: "Home", kind: GroupKind.PERSONAL, role: GroupRole.OWNER }]
    await mount(<GroupsScreen {...groupsDefaults} groups={groups} onOpen={open.fn} />)

    expect(await submit(FORM_ACTIONS.groupSelect)).toBe(true)
    expect(open.calls).toEqual([["g-1"]])

    await rerender(<GroupsScreen {...groupsDefaults} groups={groups} />)
    expect(await submit(FORM_ACTIONS.groupSelect)).toBe(false)
  })
})

describe("the group picker in the browser", () => {
  const groups = [
    { id: "g-1", name: "Home", role: GroupRole.OWNER },
    { id: "g-2", name: "Team", role: GroupRole.VIEWER },
  ]
  const frame = (
    picker: Parameters<typeof AppFrame>[0]["groupPicker"],
    navigate?: (href: string) => void,
  ) => (
    <AppFrame user={{ firstName: "Ada", lastName: "" }} groupPicker={picker} navigate={navigate}>
      page
    </AppFrame>
  )

  it("selects the group the person picks from the list, through the app's callback", async () => {
    const select = spy<[string]>()
    await mount(frame({ groups, selectedId: "g-1", onSelect: select.fn }))
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
    const options = [...root!.querySelectorAll("#sidebar-group-picker-listbox [role=option]")]
    expect(options.map((option) => option.textContent)).toEqual(["HomeOwner", "TeamViewer"])
    await act(() => {
      options[1].dispatchEvent(
        new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event,
      )
    })

    expect(select.calls).toEqual([["g-2"]])
  })

  it("follows the cog to the groups page through navigate", async () => {
    const navigate = spy<[string]>()
    await mount(frame({ groups, selectedId: "g-1", onSelect: () => {} }, navigate.fn))

    expect(await click("[data-e2e=group-manage]")).toBe(true)
    expect(navigate.calls).toEqual([["/groups"]])
  })

  it("posts the form natively when the app does not take the choice over", async () => {
    await mount(frame({ groups, selectedId: "g-1" }))

    expect(await submit(FORM_ACTIONS.groupSelect)).toBe(false)
  })
})

describe("frames in the browser", () => {
  it("signs out of the public frame through the app's callback, and natively without one", async () => {
    const signOut = spy<[]>()
    await mount(<PublicFrame canSignOut onSignOut={signOut.fn}>page</PublicFrame>)
    expect(await submit(FORM_ACTIONS.signOut)).toBe(true)
    expect(signOut.calls).toHaveLength(1)

    await rerender(<PublicFrame canSignOut>page</PublicFrame>)
    expect(await submit(FORM_ACTIONS.signOut)).toBe(false)
  })

  it("signs out from the user menu of the signed-in frame through the app's callback", async () => {
    const signOut = spy<[]>()
    await mount(
      <AppFrame user={{ firstName: "Ada", lastName: "" }} onSignOut={signOut.fn}>page</AppFrame>,
    )

    await click("[data-e2e=shell-user-menu-button]")

    expect(await submit(FORM_ACTIONS.signOut)).toBe(true)
    expect(signOut.calls).toHaveLength(1)
  })

  it("follows the brand link through navigate instead of loading the page", async () => {
    const navigate = spy<[string]>()
    await mount(<PublicFrame canSignOut={false} navigate={navigate.fn}>page</PublicFrame>)

    expect(await click('a[href="/"]')).toBe(true)
    expect(navigate.calls).toEqual([["/"]])
  })
})

describe("GroupsScreen links in the browser", () => {
  it("follows a group's settings link through the app's navigate instead of loading a page", async () => {
    const navigate = spy<[string]>()
    await mount(<GroupsScreen {...groupsDefaults} navigate={navigate.fn} />)

    await click("[data-e2e=group-settings]")

    expect(navigate.calls).toEqual([["/groups/g-1"]])
  })
})

describe("GroupSettingsScreen in the browser", () => {
  const group = { id: "g-1", name: "Home", kind: GroupKind.PERSONAL, role: GroupRole.OWNER }

  it("opens the group's notes through the app's callback, and posts natively without one", async () => {
    const open = spy<[string]>()
    await mount(
      <GroupSettingsScreen group={group} selected={false} loading={false} onOpen={open.fn} />,
    )

    expect(await submit(FORM_ACTIONS.groupSelect)).toBe(true)
    expect(open.calls).toEqual([["g-1"]])

    await rerender(<GroupSettingsScreen group={group} selected={false} loading={false} />)
    expect(await submit(FORM_ACTIONS.groupSelect)).toBe(false)
  })
})
