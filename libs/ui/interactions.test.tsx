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
import { GroupRole } from "@domain/groups"
import type { PlanRefusal } from "@domain/billing"
import { BILLING_PATHS, SeatPriceConfirm } from "./billing-screen.tsx"
import { AuthScreen, type AuthScreenProps } from "./auth-screen.tsx"
import { AppFrame, PublicFrame } from "./frame.tsx"
import { GroupSettingsScreen } from "./group-settings-screen.tsx"
import {
  EMPTY_INVITATION_DRAFT,
  GroupInvitationsSection,
  type GroupInvitationsSectionProps,
  type InvitationDraft,
  type InvitationPreviewRow,
  InvitationScreen,
  MyInvitationsSection,
} from "./group-invitations.tsx"
import {
  EMPTY_TRANSFER_DRAFT,
  GroupTransferSection,
  type GroupTransferSectionProps,
  type TransferDraft,
} from "./group-transfer.tsx"
import { GroupsScreen, type GroupsScreenProps } from "./groups-screen.tsx"
import { NoteEditorScreen, type NoteEditorScreenProps } from "./note-editor-screen.tsx"
import { NotesScreen } from "./notes-screen.tsx"
import { ProfileScreen, type ProfileScreenProps } from "./profile-screen.tsx"
import { FORM_ACTIONS, GROUP_PATHS, NOTE_PATHS, SCREEN_PATHS } from "./progressive.tsx"
import {
  ForgotPasswordScreen,
  type ForgotPasswordScreenProps,
  ResetPasswordScreen,
  type ResetPasswordScreenProps,
} from "./password-reset-screen.tsx"
import {
  EMAIL_FAILURES,
  EmailScreen,
  type EmailScreenProps,
  EmailUnavailable,
} from "./email-screen.tsx"

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

const targets = [
  { id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111003", name: "Family" },
  { id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111004", name: "Work" },
]

describe("moving notes in the browser", () => {
  const list = {
    group: { id: groupId, name: "Team", canWrite: true },
    notes: [note, { ...note, id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111005", title: "Trip" }],
    loading: false,
    listError: null,
    nextPageHref: null,
    moveTargets: targets,
  }

  async function tick(selector: string): Promise<void> {
    const box = find<HTMLInputElement>(selector)
    box.checked = true
    await act(() => {
      box.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event)
    })
  }

  it("hands the app the ticked notes and the chosen group, and cancels the native post", async () => {
    const move = spy<[{ toGroupId: string; noteIds: string[] }]>()
    await mount(<NotesScreen {...list} onMove={move.fn} />)

    await tick(`[data-e2e=note-${list.notes[1].id}] [data-e2e=note-select]`)
    const select = find<HTMLSelectElement>("[data-e2e=notes-move-to]")
    select.value = targets[1].id
    await act(() => {
      select.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event)
    })

    expect(await submit(NOTE_PATHS.moveMany(groupId))).toBe(true)
    expect(move.calls).toEqual([[{ toGroupId: targets[1].id, noteIds: [list.notes[1].id] }]])
  })

  it("posts natively when the app takes nothing over", async () => {
    await mount(<NotesScreen {...list} />)

    expect(await submit(NOTE_PATHS.moveMany(groupId))).toBe(false)
  })

  it("moves one note from its page with the chosen group", async () => {
    const move = spy<[string]>()
    await mount(
      <NoteEditorScreen
        {...editorDefaults}
        note={existing}
        value={note}
        moveTargets={targets}
        onMove={move.fn}
      />,
    )

    expect(await submit(NOTE_PATHS.move(note.id))).toBe(true)
    expect(move.calls).toEqual([[targets[0].id]])
  })

  it("shows the refusal beside the move button", async () => {
    await mount(<NotesScreen {...list} moveError="Tick the notes you want to move." />)

    expect(find("[data-e2e=notes-move]").parentElement?.textContent).toContain(
      "Tick the notes you want to move.",
    )
  })

  it("refuses a second move while the first is pending", async () => {
    const move = spy<[{ toGroupId: string; noteIds: string[] }]>()
    await mount(<NotesScreen {...list} moving onMove={move.fn} />)

    expect(await submit(NOTE_PATHS.moveMany(groupId))).toBe(true)
    expect(move.calls).toEqual([])
  })
})

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

  it("moves focus to the plan's refusal and follows its upgrade link through navigate", async () => {
    const navigate = spy<[string]>()
    const refusal: PlanRefusal = {
      code: "PLAN_LIMIT_REACHED",
      entitlement: "maxNotes",
      limit: 10,
      canUpgrade: true,
    }
    await mount(<NoteEditorScreen {...editorDefaults} navigate={navigate.fn} />)

    await rerender(
      <NoteEditorScreen
        {...editorDefaults}
        navigate={navigate.fn}
        errors={{ title: null, form: "Upgrade", plan: refusal }}
      />,
    )

    expect(focused()).toBe("plan-refusal")
    expect(await click("[data-e2e=plan-refusal] a")).toBe(true)
    expect(navigate.calls).toEqual([[BILLING_PATHS.pricing(groupId)]])
  })
})

const groupsDefaults: GroupsScreenProps = {
  groups: [{ id: "g-1", name: "Home", role: GroupRole.OWNER }],
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
    const groups = [{ id: "g-1", name: "Home", role: GroupRole.OWNER }]
    await mount(<GroupsScreen {...groupsDefaults} groups={groups} onOpen={open.fn} />)

    expect(await submit(FORM_ACTIONS.groupSelect)).toBe(true)
    expect(open.calls).toEqual([["g-1"]])

    await rerender(<GroupsScreen {...groupsDefaults} groups={groups} />)
    expect(await submit(FORM_ACTIONS.groupSelect)).toBe(false)
  })
  it("moves focus to the message when a restore is refused", async () => {
    const deleted = [{ id: "d-1", name: "Old trip", deletedAt: "2026-10-01T12:00:00.000Z" }]
    const screen = (restoreError: string | null) => (
      <GroupsScreen {...groupsDefaults} deleted={deleted} restoreError={restoreError} />
    )
    await mount(screen(null))
    expect(focused()).not.toBe("group-restore-error")

    await rerender(screen("Group not found"))

    expect(focused()).toBe("group-restore-error")
  })

  it("restores a deleted group through the app's callback, and posts natively without one", async () => {
    const restore = spy<[string]>()
    const deleted = [{ id: "d-1", name: "Old trip", deletedAt: "2026-10-01T12:00:00.000Z" }]
    await mount(<GroupsScreen {...groupsDefaults} deleted={deleted} onRestore={restore.fn} />)

    expect(await submit(GROUP_PATHS.restore("d-1"))).toBe(true)
    expect(restore.calls).toEqual([["d-1"]])

    await rerender(<GroupsScreen {...groupsDefaults} deleted={deleted} />)
    expect(await submit(GROUP_PATHS.restore("d-1"))).toBe(false)
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
  const group = { id: "g-1", name: "Home", role: GroupRole.OWNER }

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

  it("reports the typed name and renames through the app's callbacks, and posts natively without them", async () => {
    const name = spy<[string]>()
    const rename = spy<[]>()
    const screen = (props: Partial<Parameters<typeof GroupSettingsScreen>[0]> = {}) => (
      <GroupSettingsScreen group={group} selected={false} loading={false} {...props} />
    )
    await mount(screen({ onNameChange: name.fn, onRename: rename.fn }))

    await type("[data-e2e=group-rename-name]", "Trip")
    expect(name.calls).toEqual([["Trip"]])
    expect(await submit(GROUP_PATHS.rename("g-1"))).toBe(true)
    expect(rename.calls).toHaveLength(1)

    await rerender(screen())
    expect(await submit(GROUP_PATHS.rename("g-1"))).toBe(false)
  })

  it("moves focus to the name field when a rename is refused", async () => {
    const screen = (renameError: string | null) => (
      <GroupSettingsScreen
        group={group}
        selected={false}
        loading={false}
        renameError={renameError}
      />
    )
    await mount(screen(null))
    expect(focused()).not.toBe("group-rename-name")

    await rerender(screen("Only an admin can"))

    expect(focused()).toBe("group-rename-name")
  })

  it("moves focus to the message when a delete is refused", async () => {
    const screen = (deleteError: string | null) => (
      <GroupSettingsScreen
        group={group}
        selected={false}
        loading={false}
        deleteError={deleteError}
      />
    )
    await mount(screen(null))
    expect(focused()).not.toBe("group-delete-error")

    await rerender(screen("Only the owner can delete a group"))

    expect(focused()).toBe("group-delete-error")
  })

  it("deletes through the app's callback, refuses a second delete while one is pending, and posts natively without it", async () => {
    const del = spy<[]>()
    const screen = (props: Partial<Parameters<typeof GroupSettingsScreen>[0]> = {}) => (
      <GroupSettingsScreen group={group} selected={false} loading={false} {...props} />
    )
    await mount(screen({ onDelete: del.fn }))
    expect(await submit(GROUP_PATHS.delete("g-1"))).toBe(true)
    expect(del.calls).toHaveLength(1)

    await rerender(screen({ onDelete: del.fn, deleting: true }))
    expect(await submit(GROUP_PATHS.delete("g-1"))).toBe(true)
    expect(del.calls).toHaveLength(1)

    await rerender(screen())
    expect(await submit(GROUP_PATHS.delete("g-1"))).toBe(false)
  })

  it("lets nothing delete the only group: the button is disabled and no form is there", async () => {
    await mount(
      <GroupSettingsScreen group={group} selected={false} loading={false} isLastGroup />,
    )

    expect(find<HTMLButtonElement>("[data-e2e=group-delete]").disabled).toBe(true)
    expect(root?.querySelector(`form[action="${GROUP_PATHS.delete("g-1")}"]`)).toBeNull()
  })
})

describe("GroupSettingsScreen members and leave in the browser", () => {
  const group = { id: "g-1", name: "Home", role: GroupRole.ADMIN }
  const members = [
    {
      userId: 1,
      name: "Olga Owner",
      email: "olga@example.com",
      role: GroupRole.OWNER,
      joinedAt: "2026-01-01T00:00:00.000Z",
      isYou: false,
    },
    {
      userId: 7,
      name: "Vic Viewer",
      email: "vic@example.com",
      role: GroupRole.VIEWER,
      joinedAt: "2026-02-01T00:00:00.000Z",
      isYou: false,
    },
  ]
  const screen = (props: Partial<Parameters<typeof GroupSettingsScreen>[0]> = {}) => (
    <GroupSettingsScreen
      group={group}
      selected={false}
      loading={false}
      members={members}
      {...props}
    />
  )

  it("changes a role to the one chosen through the app's callback, and posts natively without it", async () => {
    const roles = spy<[number, GroupRole]>()
    await mount(screen({ onRoleChange: roles.fn }))

    const select = find<HTMLSelectElement>("[data-e2e=group-member-role-select]")
    select.value = String(GroupRole.EDITOR)
    await act(() => {
      select.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event)
    })
    expect(await submit(GROUP_PATHS.memberRole("g-1", 7))).toBe(true)
    expect(roles.calls).toEqual([[7, GroupRole.EDITOR]])

    await rerender(screen())
    expect(await submit(GROUP_PATHS.memberRole("g-1", 7))).toBe(false)
  })

  it("removes a member through the app's callback, refuses a second submit while pending, and posts natively without it", async () => {
    const remove = spy<[number]>()
    await mount(screen({ onRemoveMember: remove.fn }))
    expect(await submit(GROUP_PATHS.memberRemove("g-1", 7))).toBe(true)
    expect(remove.calls).toEqual([[7]])

    await rerender(screen({ onRemoveMember: remove.fn, memberPendingId: 7 }))
    expect(await submit(GROUP_PATHS.memberRemove("g-1", 7))).toBe(true)
    expect(remove.calls).toHaveLength(1)

    await rerender(screen())
    expect(await submit(GROUP_PATHS.memberRemove("g-1", 7))).toBe(false)
  })

  it("moves focus to the message under the member whose change was refused", async () => {
    await mount(screen({ memberError: null }))
    expect(focused()).not.toBe("group-member-error")

    await rerender(screen({ memberError: { userId: 7, message: "Only an admin can" } }))

    expect(focused()).toBe("group-member-error")
    expect(document.activeElement?.closest("[data-e2e=group-member]")?.getAttribute("data-user-id"))
      .toBe("7")
  })

  it("moves focus to the plan's refusal under the member whose role change it refused", async () => {
    const refusal: PlanRefusal = {
      code: "PLAN_FEATURE_MISSING",
      entitlement: "memberRoles",
      limit: null,
      canUpgrade: false,
    }
    await mount(screen({ memberError: null }))

    await rerender(screen({ memberError: { userId: 7, message: "Upgrade", plan: refusal } }))

    expect(focused()).toBe("plan-refusal")
    expect(document.activeElement?.closest("[data-e2e=group-member]")?.getAttribute("data-user-id"))
      .toBe("7")
    expect(find("[data-e2e=plan-refusal-ask-owner]").textContent).toContain("Ask the group's owner")
  })

  it("leaves through the app's callback, and posts natively without it", async () => {
    const leave = spy<[]>()
    await mount(screen({ onLeave: leave.fn }))
    expect(await submit(GROUP_PATHS.leave("g-1"))).toBe(true)
    expect(leave.calls).toHaveLength(1)

    await rerender(screen())
    expect(await submit(GROUP_PATHS.leave("g-1"))).toBe(false)
  })

  it("opens the confirmation and moves focus to the message when a leave is refused", async () => {
    await mount(screen({ leaveError: null }))
    expect(focused()).not.toBe("group-leave-error")

    await rerender(screen({ leaveError: "You cannot leave your only group" }))

    expect(find<HTMLDetailsElement>("[data-e2e=group-leave-details]").open).toBe(true)
    expect(focused()).toBe("group-leave-error")
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

describe("EmailScreen in the browser", () => {
  it("reports the typed code and checks it through the app's callback", async () => {
    const change = spy<[string, string]>()
    const verify = spy<[]>()
    await mount(<EmailScreen {...emailDefaults} onValueChange={change.fn} onVerify={verify.fn} />)

    await type("[data-e2e=email-code]", "Ab3_x-9Q")

    expect(change.calls).toEqual([["code", "Ab3_x-9Q"]])
    expect(await submit(FORM_ACTIONS.emailVerify)).toBe(true)
    expect(verify.calls).toHaveLength(1)
  })

  it("posts each form natively when the app takes nothing over", async () => {
    const values = { code: "Ab3_x-9Q", email: "new@example.com", password: "Passw0rd!" }
    await mount(<EmailScreen {...emailDefaults} values={values} />)

    const sent = (action: string) =>
      Object.fromEntries(new FormData(find<HTMLFormElement>(`form[action="${action}"]`)))
    expect(sent(FORM_ACTIONS.emailVerify)).toEqual({ code: "Ab3_x-9Q" })
    expect(sent(FORM_ACTIONS.emailChange)).toEqual({
      email: "new@example.com",
      password: "Passw0rd!",
    })
    for (const action of [FORM_ACTIONS.emailVerify, FORM_ACTIONS.emailSend]) {
      expect(await submit(action)).toBe(false)
    }
  })

  it("refuses a second check while the first is pending", async () => {
    const verify = spy<[]>()
    await mount(
      <EmailScreen
        {...emailDefaults}
        pending={{ ...emailDefaults.pending, verify: true }}
        onVerify={verify.fn}
      />,
    )

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

  it("moves focus to the code field once a change asks for the new address's code", async () => {
    const proven = { email: "ann@example.com", proven: true, pending: null }
    await mount(<EmailScreen {...emailDefaults} status={proven} />)
    find("[data-e2e=email-change]").focus()

    await rerender(
      <EmailScreen {...emailDefaults} status={{ ...proven, pending: "new@example.com" }} />,
    )

    expect(focused()).toBe("email-code")
  })

  it("moves focus to the new address when a change is refused", async () => {
    await mount(<EmailScreen {...emailDefaults} />)
    find("[data-e2e=email-change]").focus()

    const errors = { ...emailDefaults.errors, change: "Invalid password" }
    await rerender(<EmailScreen {...emailDefaults} errors={errors} />)

    expect(focused()).toBe("email-new")
    expect(find("[data-e2e=email-change]").closest("form")?.textContent).toContain(
      "Invalid password",
    )
  })

  it("retries an unread address through the app's callback, or reloads the page without it", async () => {
    const retry = spy<[]>()
    await mount(<EmailUnavailable onRetry={retry.fn} />)

    expect(find("[role=alert]").textContent).toBe(EMAIL_FAILURES.load)
    await click("[data-e2e=email-retry]")
    expect(retry.calls).toHaveLength(1)

    await mount(<EmailUnavailable />)
    expect(find("[data-e2e=email-retry]").getAttribute("href")).toBe(SCREEN_PATHS.email)
  })
})

describe("GroupInvitationsSection in the browser", () => {
  const defaults: GroupInvitationsSectionProps = {
    groupId: "g-1",
    actorRole: GroupRole.OWNER,
    invitations: [{
      id: "i-1",
      role: GroupRole.EDITOR,
      email: null,
      maxUses: 3,
      uses: 0,
      expiresAt: "2026-10-09T10:00:00.000Z",
      createdBy: { name: "Ann" },
    }],
    draft: EMPTY_INVITATION_DRAFT,
  }

  it("reports each typed field as a new draft and creates through the app's callback", async () => {
    const drafts = spy<[InvitationDraft]>()
    const create = spy<[]>()
    await mount(
      <GroupInvitationsSection {...defaults} onDraftChange={drafts.fn} onCreate={create.fn} />,
    )

    await type("[data-e2e=invitation-uses]", "5")
    await type("[data-e2e=invitation-email]", "friend@example.com")

    expect(drafts.calls.map(([draft]) => draft)).toEqual([
      { ...EMPTY_INVITATION_DRAFT, maxUses: 5 },
      { ...EMPTY_INVITATION_DRAFT, email: "friend@example.com" },
    ])
    expect(await submit(GROUP_PATHS.invitationCreate("g-1"))).toBe(true)
    expect(create.calls).toHaveLength(1)
  })

  it("turns an editor draft into a viewer on a plan without member roles", async () => {
    const drafts = spy<[InvitationDraft]>()
    await mount(
      <GroupInvitationsSection {...defaults} memberRoles={false} onDraftChange={drafts.fn} />,
    )

    expect(drafts.calls).toEqual([[{ ...EMPTY_INVITATION_DRAFT, role: GroupRole.VIEWER }]])
  })

  it("posts the create and the revoke natively when the app takes nothing over", async () => {
    await mount(<GroupInvitationsSection {...defaults} />)

    expect(await submit(GROUP_PATHS.invitationCreate("g-1"))).toBe(false)
    expect(await submit(GROUP_PATHS.invitationRevoke("g-1", "i-1"))).toBe(false)
  })

  it("revokes through the app's callback with that invitation's id", async () => {
    const revoke = spy<[string]>()
    await mount(<GroupInvitationsSection {...defaults} onRevoke={revoke.fn} />)

    expect(await submit(GROUP_PATHS.invitationRevoke("g-1", "i-1"))).toBe(true)
    expect(revoke.calls).toEqual([["i-1"]])
  })

  it("reports the price confirmation to the app and posts it with a create the app takes over", async () => {
    const ticks = spy<[boolean]>()
    const create = spy<[]>()
    const seatPrice = { seats: 2, amount: 900, currency: "EUR" }
    const section = (checked: boolean) => (
      <GroupInvitationsSection
        {...defaults}
        onCreate={create.fn}
        seatPrice={<SeatPriceConfirm seatPrice={seatPrice} checked={checked} onChange={ticks.fn} />}
      />
    )
    await mount(section(false))

    await click("[data-e2e=seat-price-accept]")
    expect(ticks.calls).toEqual([[true]])
    await rerender(section(true))

    expect(await submit(GROUP_PATHS.invitationCreate("g-1"))).toBe(true)
    expect(create.calls).toHaveLength(1)
    const form = find<HTMLFormElement>(`form[action="${GROUP_PATHS.invitationCreate("g-1")}"]`)
    expect(new window.FormData(form as never).get("acceptSeatPrice")).toBe("true")
  })

  it("moves focus to the price confirmation when a create is refused for it, not to the address", async () => {
    const seatPrice = { seats: 2, amount: 900, currency: "EUR" }
    const section = (error: string | null) => (
      <GroupInvitationsSection
        {...defaults}
        seatPrice={<SeatPriceConfirm seatPrice={seatPrice} checked={false} error={error} />}
      />
    )
    await mount(section(null))
    expect(focused()).not.toBe("seat-price-accept")

    await rerender(section("Confirm the price"))

    expect(focused()).toBe("seat-price-accept")
    expect(find("[data-e2e=seat-price-accept]").getAttribute("aria-describedby")).toContain(
      "invitation-seat-price-error",
    )
  })

  it("moves focus to the address field when a create is refused, and to the new link once made", async () => {
    await mount(<GroupInvitationsSection {...defaults} />)
    expect(focused()).not.toBe("invitation-email")

    await rerender(<GroupInvitationsSection {...defaults} createError="Enter a valid address" />)
    expect(focused()).toBe("invitation-email")
    expect(find("[data-e2e=invitation-email]").getAttribute("aria-describedby")).toContain(
      "invitation-email",
    )

    await rerender(
      <GroupInvitationsSection
        {...defaults}
        created={{ link: "https://app.example.com/invite/x", mailAsked: false, mailSent: false }}
      />,
    )
    expect(focused()).toBe("invitation-created")
  })

  it("moves focus to the message under the row when a revoke is refused", async () => {
    await mount(<GroupInvitationsSection {...defaults} />)
    await rerender(
      <GroupInvitationsSection
        {...defaults}
        revokeError={{ invitationId: "i-1", message: "Already used" }}
      />,
    )

    expect(focused()).toBe("invitation-error")
    expect(find("[data-e2e=invitation-error]").textContent).toContain("Already used")
  })
})

describe("invitation answers in the browser", () => {
  const invitation: InvitationPreviewRow = {
    id: "i-1",
    groupId: "g-1",
    groupName: "Team",
    inviterName: "Ann",
    role: GroupRole.EDITOR,
    addressed: true,
    forYou: true,
    expiresAt: "2026-10-09T10:00:00.000Z",
  }

  it("accepts and declines a link through the app's callbacks, and posts natively without them", async () => {
    const accept = spy<[]>()
    const decline = spy<[]>()
    await mount(
      <InvitationScreen
        token="t"
        invitation={invitation}
        loading={false}
        onAccept={accept.fn}
        onDecline={decline.fn}
      />,
    )

    expect(await submit(FORM_ACTIONS.invitationAccept)).toBe(true)
    expect(await submit(FORM_ACTIONS.invitationDecline)).toBe(true)
    expect([accept.calls.length, decline.calls.length]).toEqual([1, 1])

    await rerender(<InvitationScreen token="t" invitation={invitation} loading={false} />)
    expect(await submit(FORM_ACTIONS.invitationAccept)).toBe(false)
  })

  it("moves focus to the message when an accept is refused", async () => {
    await mount(<InvitationScreen token="t" invitation={invitation} loading={false} />)
    await rerender(
      <InvitationScreen
        token="t"
        invitation={invitation}
        loading={false}
        answerError="This invitation has been used up"
      />,
    )

    expect(focused()).toBe("invitation-answer-error")
  })

  it("answers an invitation in the list through the app's callbacks with its id", async () => {
    const accept = spy<[string]>()
    const decline = spy<[string]>()
    await mount(
      <MyInvitationsSection
        invitations={[invitation]}
        onAccept={accept.fn}
        onDecline={decline.fn}
      />,
    )

    expect(await submit(FORM_ACTIONS.invitationAccept)).toBe(true)
    expect(await submit(FORM_ACTIONS.invitationDecline)).toBe(true)
    expect([accept.calls, decline.calls]).toEqual([[["i-1"]], [["i-1"]]])
  })
})

describe("GroupTransferSection in the browser", () => {
  const member = (userId: number, role: GroupRole) => ({
    userId,
    name: `Member ${userId}`,
    email: null,
    role,
    joinedAt: "2026-09-01T08:00:00.000Z",
    isYou: role === GroupRole.OWNER,
  })
  const defaults: GroupTransferSectionProps = {
    groupId: "g-1",
    groupName: "Team",
    role: GroupRole.OWNER,
    members: [member(1, GroupRole.OWNER), member(5, GroupRole.EDITOR), member(6, GroupRole.ADMIN)],
    draft: { ...EMPTY_TRANSFER_DRAFT, userId: 5 },
  }

  it("puts the first member offered into the app's draft when none is picked", async () => {
    const drafts = spy<[TransferDraft]>()
    await mount(
      <GroupTransferSection {...defaults} draft={EMPTY_TRANSFER_DRAFT} onDraftChange={drafts.fn} />,
    )

    expect(drafts.calls).toEqual([[{ ...EMPTY_TRANSFER_DRAFT, userId: 5 }]])
  })

  it("reports each typed field as a new draft and transfers through the app's callback", async () => {
    const drafts = spy<[TransferDraft]>()
    const transfer = spy<[]>()
    await mount(
      <GroupTransferSection {...defaults} onDraftChange={drafts.fn} onTransfer={transfer.fn} />,
    )

    await type("[data-e2e=group-transfer-name]", "Team")
    await type("[data-e2e=group-transfer-password]", "secret")

    expect(drafts.calls.map(([draft]) => draft)).toEqual([
      { userId: 5, name: "Team", password: "" },
      { userId: 5, name: "", password: "secret" },
    ])
    expect(await submit(GROUP_PATHS.transfer("g-1"))).toBe(true)
    expect(transfer.calls).toHaveLength(1)
  })

  it("posts the transfer natively when the app takes nothing over", async () => {
    await mount(<GroupTransferSection {...defaults} />)

    expect(await submit(GROUP_PATHS.transfer("g-1"))).toBe(false)
  })

  it("moves focus to the field a refusal names, and to the message when it names none", async () => {
    await mount(<GroupTransferSection {...defaults} />)
    expect(focused()).not.toBe("group-transfer-name")

    await rerender(
      <GroupTransferSection {...defaults} error={{ field: "name", message: "Type it exactly" }} />,
    )
    expect(focused()).toBe("group-transfer-name")

    await rerender(
      <GroupTransferSection {...defaults} error={{ field: "password", message: "Wrong" }} />,
    )
    expect(focused()).toBe("group-transfer-password")

    await rerender(
      <GroupTransferSection {...defaults} error={{ field: null, message: "Not a member" }} />,
    )
    expect(focused()).toBe("group-transfer-error")
  })
})
