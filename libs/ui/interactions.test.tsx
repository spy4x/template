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
import { GroupsScreen, type GroupsScreenProps } from "./groups-screen.tsx"
import { NotesScreen, type NotesScreenProps } from "./notes-screen.tsx"
import { ProfileScreen, type ProfileScreenProps } from "./profile-screen.tsx"
import { FORM_ACTIONS, NOTE_PATHS } from "./progressive.tsx"

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

    await type("input[name=username]", "ada")
    await type("input[name=password]", "long-enough")

    expect(await submit(FORM_ACTIONS.signIn)).toBe(true)
    expect(signIn.calls).toEqual([[{ login: "ada", password: "long-enough" }]])
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
const notesDefaults: NotesScreenProps = {
  group: { id: groupId, name: "Team", canWrite: true },
  notes: [note],
  loading: false,
  draftId: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111009",
  draft: { title: "", body: "" },
  createErrors: noError,
  creating: false,
  editing: null,
  editErrors: noError,
  saving: false,
  deleting: null,
  listError: null,
  nextPageHref: null,
}

describe("NotesScreen in the browser", () => {
  it("reports the typed title and creates the note through the app's callbacks", async () => {
    const draft = spy<[{ title: string; body: string }]>()
    const create = spy<[]>()
    await mount(<NotesScreen {...notesDefaults} onDraftChange={draft.fn} onCreate={create.fn} />)

    await type("[data-e2e=note-new-title]", "Trip")

    expect(draft.calls).toEqual([[{ title: "Trip", body: "" }]])
    expect(await submit(NOTE_PATHS.list(groupId))).toBe(true)
    expect(create.calls).toHaveLength(1)
  })

  it("deletes the note it belongs to through the app's callback", async () => {
    const remove = spy<[typeof note]>()
    await mount(<NotesScreen {...notesDefaults} onDelete={remove.fn} />)

    expect(await submit(NOTE_PATHS.delete(groupId, note.id))).toBe(true)
    expect(remove.calls).toEqual([[note]])
  })

  it("posts the create and the delete natively when the app takes nothing over", async () => {
    await mount(<NotesScreen {...notesDefaults} />)

    expect(await submit(NOTE_PATHS.list(groupId))).toBe(false)
    expect(await submit(NOTE_PATHS.delete(groupId, note.id))).toBe(false)
  })

  it("moves focus to the title when it gets an error", async () => {
    await mount(<NotesScreen {...notesDefaults} />)

    await rerender(
      <NotesScreen {...notesDefaults} createErrors={{ title: "Enter a title", form: null }} />,
    )

    expect(focused()).toBe("note-new-title")
  })
})

const groupsDefaults: GroupsScreenProps = {
  groups: [{ id: "g-1", name: "Home", kind: GroupKind.PERSONAL, role: GroupRole.OWNER }],
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

  it("follows a group's link through navigate instead of loading the page", async () => {
    const navigate = spy<[string]>()
    await mount(<GroupsScreen {...groupsDefaults} navigate={navigate.fn} />)

    expect(await click(`a[href="${NOTE_PATHS.list("g-1")}"]`)).toBe(true)
    expect(navigate.calls).toEqual([[NOTE_PATHS.list("g-1")]])
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
