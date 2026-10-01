import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { VNode } from "preact"
import { renderToString } from "preact-render-to-string"
import {
  authOTPSchema,
  authPasswordChangeSchema,
  authPasswordForgotSchema,
  authPasswordResetSchema,
  authSignInSchema,
  authSignUpSchema,
  UserMFAStatus,
  userProfileBaseSchema,
  type UserPushTokenPublic,
} from "@domain/identity"
import { pushUnsubscribeRequestSchema } from "@spy4x/platform/model"
import { AuthScreen, type AuthScreenProps } from "./auth-screen.tsx"
import { AppFrame, PublicFrame } from "./frame.tsx"
import { GroupKind, GroupRole, parseSelectGroupRequest } from "@domain/groups"
import { GroupSettingsScreen, type GroupSettingsScreenProps } from "./group-settings-screen.tsx"
import { GroupsScreen, type GroupsScreenProps, ROLE_TEXT } from "./groups-screen.tsx"
import { ProfileScreen, type ProfileScreenProps } from "./profile-screen.tsx"
import { FORM_ACTIONS, GROUP_PATHS, NOTE_PATHS, SCREEN_PATHS } from "./progressive.tsx"
import {
  noteCreateRequestSchema,
  noteDeleteRequestSchema,
  noteUpdateRequestSchema,
} from "@domain/notes"
import { NoteEditorScreen, type NoteEditorScreenProps } from "./note-editor-screen.tsx"
import { NotesScreen, type NotesScreenProps } from "./notes-screen.tsx"
import { ForgotPasswordScreen, ResetPasswordScreen } from "./password-reset-screen.tsx"

/** One `<form>` in rendered HTML: its attributes and the names of the fields it submits. */
interface RenderedForm {
  action: string | undefined
  method: string | undefined
  fields: string[]
}

/** The rendered page, reduced to what works without JavaScript: forms, links, loose buttons. */
interface NoScriptSurface {
  forms: RenderedForm[]
  links: string[]
  /** `data-e2e` of every button outside a form, or of a non-submit button inside one. */
  scriptOnlyButtons: string[]
}

function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
}

/** Renders `node` on the server and lists what a browser without JavaScript can act on. */
function noScriptSurface(node: VNode): NoScriptSurface {
  const html = renderToString(node)
  const forms: RenderedForm[] = []
  const outside = html.replace(/<form\b([^>]*)>([\s\S]*?)<\/form>/g, (_all, attrs, body) => {
    forms.push({
      action: attribute(` ${attrs}`, "action"),
      method: attribute(` ${attrs}`, "method"),
      fields: [...body.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)]
        .map(([tag]) => attribute(tag, "name"))
        .filter((name): name is string => name !== undefined)
        .sort(),
    })
    // Keep the non-submit buttons inside forms visible to the button scan below.
    return [...body.matchAll(/<button\b[^>]*>/g)]
      .map(([tag]) => tag)
      .filter((tag) => attribute(tag, "type") !== "submit")
      .join("")
  })
  const links = [...html.matchAll(/<a\b[^>]*>/g)].map(([tag]) => attribute(tag, "href") ?? "")
  const scriptOnlyButtons = [...outside.matchAll(/<button\b[^>]*>/g)]
    .map(([tag]) => attribute(tag, "data-e2e") ?? "(unnamed)")
  return { forms, links, scriptOnlyButtons }
}

/** The keys an API schema accepts, sorted: what a form's field names must be. */
function schemaKeys(schema: { props: readonly { key: string | symbol }[] }): string[] {
  return schema.props.map((prop) => String(prop.key)).sort()
}

function formAt(surface: NoScriptSurface, action: string): RenderedForm {
  const form = surface.forms.find((candidate) => candidate.action === action)
  if (!form) throw new Error(`no form posts to ${action}; forms: ${JSON.stringify(surface.forms)}`)
  return form
}

const authDefaults: AuthScreenProps = {
  screen: "sign-in",
  isSignedIn: false,
  isMfaRequired: false,
  busy: false,
  error: null,
}

describe("AuthScreen without JavaScript", () => {
  it("posts the sign-in credentials to the sign-in route and links to a password reset", () => {
    const surface = noScriptSurface(<AuthScreen {...authDefaults} />)
    expect(surface.forms).toEqual([
      {
        action: FORM_ACTIONS.signIn,
        method: "post",
        fields: schemaKeys(authSignInSchema),
      },
    ])
    expect(surface.links).toEqual([SCREEN_PATHS.signUp, SCREEN_PATHS.forgotPassword])
    expect(surface.scriptOnlyButtons).toEqual(["auth-form-password-toggle"])
  })

  it("switches between sign in and sign up with a plain link", () => {
    // Sign-in also links to a password reset.
    expect(noScriptSurface(<AuthScreen {...authDefaults} />).links).toEqual([
      "/sign-up",
      SCREEN_PATHS.forgotPassword,
    ])
    expect(noScriptSurface(<AuthScreen {...authDefaults} screen="sign-up" />).links)
      .toEqual(["/sign-in"])
  })

  it("posts the sign-up credentials to the sign-up route", () => {
    const surface = noScriptSurface(<AuthScreen {...authDefaults} screen="sign-up" />)
    expect(surface.forms).toEqual([
      {
        action: FORM_ACTIONS.signUp,
        method: "post",
        fields: schemaKeys(authSignUpSchema),
      },
    ])
  })

  it("posts the one-time code to its route and links back to sign in", () => {
    const surface = noScriptSurface(
      <AuthScreen {...authDefaults} screen="one-time-code" isMfaRequired />,
    )
    expect(surface.forms).toEqual([
      { action: FORM_ACTIONS.oneTimeCode, method: "post", fields: schemaKeys(authOTPSchema) },
    ])
    expect(surface.links).toEqual(["/sign-in"])
    expect(surface.scriptOnlyButtons).toEqual([])
  })

  it("links a signed-in user on to the profile instead of asking again", () => {
    const signedIn = noScriptSurface(<AuthScreen {...authDefaults} isSignedIn />)
    const noCodeOwed = noScriptSurface(<AuthScreen {...authDefaults} screen="one-time-code" />)
    for (const surface of [signedIn, noCodeOwed]) {
      expect(surface.forms).toEqual([])
      expect(surface.links).toEqual(["/"])
    }
  })
})

describe("ForgotPasswordScreen without JavaScript", () => {
  const props = { email: "", onEmailChange: () => {}, error: null, pending: false }

  it("posts the address to the forgot-password route and links back to sign in", () => {
    const surface = noScriptSurface(<ForgotPasswordScreen {...props} sent={false} />)
    expect(surface.forms).toEqual([
      {
        action: FORM_ACTIONS.forgotPassword,
        method: "post",
        fields: schemaKeys(authPasswordForgotSchema),
      },
    ])
    expect(surface.links).toEqual([SCREEN_PATHS.signIn])
    expect(surface.scriptOnlyButtons).toEqual([])
  })

  it("says the link is on its way and asks nothing more once it is sent", () => {
    const surface = noScriptSurface(<ForgotPasswordScreen {...props} sent />)
    expect(surface.forms).toEqual([])
    expect(surface.links).toEqual([SCREEN_PATHS.signIn])
  })
})

describe("ResetPasswordScreen without JavaScript", () => {
  const props = {
    email: "ada@example.com",
    code: "code-from-the-link",
    newPassword: "",
    onNewPasswordChange: () => {},
    done: false,
    error: null,
    pending: false,
  }

  it("posts the link's address and code with the new password to the reset route", () => {
    const node = <ResetPasswordScreen {...props} />
    const surface = noScriptSurface(node)
    expect(surface.forms).toEqual([
      {
        action: FORM_ACTIONS.resetPassword,
        method: "post",
        fields: schemaKeys(authPasswordResetSchema),
      },
    ])
    expect(surface.links).toEqual([SCREEN_PATHS.forgotPassword])
    const html = renderToString(node)
    expect(html).toContain(`name="email" value="ada@example.com"`)
    expect(html).toContain(`name="code" value="code-from-the-link"`)
  })

  it("points to sign-in once the password is changed", () => {
    const surface = noScriptSurface(<ResetPasswordScreen {...props} done />)
    expect(surface.forms).toEqual([])
    expect(surface.links).toEqual([SCREEN_PATHS.signIn])
  })

  it("offers a new link instead of a form when the link lacks its address or code", () => {
    for (const broken of [{ email: "" }, { code: "" }]) {
      const surface = noScriptSurface(<ResetPasswordScreen {...props} {...broken} />)
      expect(surface.forms).toEqual([])
      expect(surface.links).toEqual([SCREEN_PATHS.forgotPassword])
    }
  })
})

const device: UserPushTokenPublic = {
  id: 1,
  deviceId: "device-0123456789",
  createdAt: new Date("2026-01-02T03:04:05Z"),
} as unknown as UserPushTokenPublic

const profileDefaults: ProfileScreenProps = {
  user: { mfa: UserMFAStatus.NOT_CONFIGURED },
  isMfaRequired: false,
  connection: "open",
  values: { firstName: "Ada", lastName: "Lovelace", currentPassword: "", newPassword: "", otp: "" },
  onValueChange: () => {},
  errors: { fields: {}, profile: null, password: null, totp: null, push: null },
  pending: { profile: false, password: false, totp: false, push: false },
  enrolment: null,
  pushDevices: [device],
}

describe("ProfileScreen without JavaScript", () => {
  it("posts the name, the password change, 2FA start and device removal with the API's field names", () => {
    const surface = noScriptSurface(<ProfileScreen {...profileDefaults} />)
    expect(surface.forms.every((form) => form.method === "post")).toBe(true)
    expect(formAt(surface, FORM_ACTIONS.profile).fields).toEqual(schemaKeys(userProfileBaseSchema))
    expect(formAt(surface, FORM_ACTIONS.password).fields).toEqual(
      schemaKeys(authPasswordChangeSchema),
    )
    expect(formAt(surface, FORM_ACTIONS.totpStart).fields).toEqual([])
    expect(formAt(surface, FORM_ACTIONS.pushRemove).fields).toEqual(
      schemaKeys(pushUnsubscribeRequestSchema),
    )
    expect(surface.forms).toHaveLength(4)
    expect(surface.scriptOnlyButtons).toEqual([])
  })

  it("offers Add device only to an app that can register push, which needs the browser's push manager", () => {
    expect(
      noScriptSurface(<ProfileScreen {...profileDefaults} onRegisterPush={() => {}} />)
        .scriptOnlyButtons,
    ).toEqual(["push-register"])
    expect(noScriptSurface(<ProfileScreen {...profileDefaults} />).scriptOnlyButtons).toEqual([])
  })

  it("posts the first code of an enrolment with the API's field name", () => {
    const surface = noScriptSurface(
      <ProfileScreen {...profileDefaults} enrolment={{ qrcode: "<svg/>", secret: "ABC" }} />,
    )
    expect(formAt(surface, FORM_ACTIONS.totpFinish).fields).toEqual(schemaKeys(authOTPSchema))
    expect(surface.forms.some((form) => form.action === FORM_ACTIONS.totpStart)).toBe(false)
  })

  it("posts 2FA removal once an authenticator app is connected", () => {
    const surface = noScriptSurface(
      <ProfileScreen {...profileDefaults} user={{ mfa: UserMFAStatus.CONFIGURED }} />,
    )
    expect(formAt(surface, FORM_ACTIONS.totpDisable)).toEqual({
      action: FORM_ACTIONS.totpDisable,
      method: "post",
      fields: [],
    })
  })

  it("links a signed-out visitor to sign in and sign up", () => {
    const surface = noScriptSurface(<ProfileScreen {...profileDefaults} user={null} />)
    expect(surface.forms).toEqual([])
    expect(surface.links).toEqual(["/sign-in", "/sign-up"])
  })

  it("shows the live connection only when the app has one", () => {
    const { connection: _, ...withoutConnection } = profileDefaults

    expect(renderToString(<ProfileScreen {...profileDefaults} />)).toContain('data-e2e="ws-status"')
    expect(renderToString(<ProfileScreen {...withoutConnection} />)).not.toContain("ws-status")
  })

  it("links a session that owes its one-time code to the code screen", () => {
    const surface = noScriptSurface(<ProfileScreen {...profileDefaults} isMfaRequired />)
    expect(surface.forms).toEqual([])
    expect(surface.links).toEqual(["/totp"])
  })
})

describe("frames without JavaScript", () => {
  it("posts sign-out from the public frame and links the brand home", () => {
    const surface = noScriptSurface(<PublicFrame canSignOut>page</PublicFrame>)
    expect(surface.forms).toEqual([{ action: FORM_ACTIONS.signOut, method: "post", fields: [] }])
    expect(surface.links).toEqual(["/"])
  })

  it("links the brand and the navigation of the signed-in frame, and posts sign-out from the user menu when the app takes sign-out over", () => {
    const surface = noScriptSurface(
      <AppFrame user={{ firstName: "Ada", lastName: "" }} connection="open" onSignOut={() => {}}>
        page
      </AppFrame>,
    )
    const [skipLink, ...pages] = surface.links
    expect(skipLink).toMatch(/^#./)
    // The navigation is drawn twice (sidebar and drawer), the brand once.
    expect(pages.filter((href) => href === "/")).toHaveLength(3)
    expect(pages.filter((href) => href === "/notes")).toHaveLength(2)
    expect(pages.filter((href) => href === "/groups")).toHaveLength(2)
    expect(pages).toHaveLength(7)
    // "Sign out" is a form in the user menu; only the button that opens the menu needs a script.
    expect(surface.forms).toEqual([{ action: FORM_ACTIONS.signOut, method: "post", fields: [] }])
    expect(surface.scriptOnlyButtons).toEqual(["shell-user-menu-button"])
  })

  it("posts sign-out from the signed-in frame when no app takes it over, and shows no connection it does not have", () => {
    const frame = <AppFrame user={{ firstName: "Ada", lastName: "" }}>page</AppFrame>
    const surface = noScriptSurface(frame)
    expect(surface.forms).toEqual([{ action: FORM_ACTIONS.signOut, method: "post", fields: [] }])
    expect(renderToString(frame)).not.toContain("shell-ws-status")
  })
})

const pickerGroups = [
  { id: "g-1", name: "Home", role: GroupRole.OWNER },
  { id: "g-2", name: "Team", role: GroupRole.VIEWER },
]

describe("the group picker without JavaScript", () => {
  const frame = (picker = { groups: pickerGroups, selectedId: "g-2" as string | null }) => (
    <AppFrame user={{ firstName: "Ada", lastName: "" }} groupPicker={picker}>page</AppFrame>
  )

  it("posts the chosen group to the select route from the side menu and from the drawer", () => {
    const surface = noScriptSurface(frame())
    const pickerForms = surface.forms.filter((form) => form.action === FORM_ACTIONS.groupSelect)

    // Shell draws its sidebar slot twice: once in the side menu, once in the mobile drawer.
    expect(pickerForms).toEqual([
      { action: FORM_ACTIONS.groupSelect, method: "post", fields: ["groupId"] },
      { action: FORM_ACTIONS.groupSelect, method: "post", fields: ["groupId"] },
    ])
    // The field names are what the API's request parser takes, and nothing else.
    const body = Object.fromEntries(
      pickerForms[0].fields.map((name) => [name, "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"]),
    )
    expect(parseSelectGroupRequest(body)).toEqual(body)
  })

  it("draws the form through ScreenForm, so it has EnhancedForm's status line and not a plain form's", () => {
    const html = renderToString(frame())
    const forms = [...html.matchAll(/<form\b[^>]*action="\/groups\/select"[^>]*>[\s\S]*?<\/form>/g)]

    expect(forms).toHaveLength(2)
    for (const [form] of forms) {
      expect(form).toContain('class="space-y-0 ')
      expect(form).toContain('<p role="status" aria-live="polite"')
    }
  })

  it("lists every group with the person's role, marks the selected one, and gives each copy its own ids", () => {
    const html = renderToString(frame())

    expect(html.match(/<option value="g-1">Home · Owner<\/option>/g)).toHaveLength(2)
    expect(html.match(/<option selected value="g-2">Team · Viewer<\/option>/g)).toHaveLength(2)
    const ids = [...html.matchAll(/<select\b[^>]*\sid="([^"]*)"/g)].map(([, id]) => id)
    expect(new Set(ids).size).toBe(2)
  })

  it("links a cog named Manage groups to the groups page", () => {
    const html = renderToString(frame())
    const cogs = [...html.matchAll(/<a\b[^>]*data-e2e="group-manage"[^>]*>/g)].map(([tag]) => tag)

    expect(cogs).toHaveLength(2)
    for (const cog of cogs) {
      expect(attribute(cog, "href")).toBe("/groups")
      expect(attribute(cog, "aria-label")).toBe("Manage groups")
    }
  })

  it("draws no picker when the app has no groups to offer", () => {
    expect(renderToString(<AppFrame user={{ firstName: "Ada", lastName: "" }}>page</AppFrame>))
      .not.toContain("group-picker")
  })
})

const groupsDefaults: GroupsScreenProps = {
  groups: [],
  selectedId: null,
  name: "",
  onNameChange: () => {},
  creating: false,
  loading: false,
  error: null,
  onCreate: () => {},
  onRefresh: () => {},
}

describe("GroupsScreen", () => {
  it("lists each group with its kind and the person's role", () => {
    const html = renderToString(
      <GroupsScreen
        {...groupsDefaults}
        groups={[
          { id: "g-1", name: "Home", kind: GroupKind.PERSONAL, role: GroupRole.OWNER },
          { id: "g-2", name: "Team", kind: GroupKind.SHARED, role: GroupRole.VIEWER },
        ]}
      />,
    )

    expect(html).toContain("Home")
    expect(html).toContain("Personal · Owner")
    expect(html).toContain("Team")
    expect(html).toContain("Shared · Viewer")
    expect(html).not.toContain("No groups yet.")
  })

  it("says so when there are no groups, and says loading while it fetches", () => {
    expect(renderToString(<GroupsScreen {...groupsDefaults} />)).toContain("No groups yet.")
    expect(renderToString(<GroupsScreen {...groupsDefaults} loading />)).toContain(
      "Loading groups...",
    )
  })

  it("shows the error and keeps the typed name in the create form", () => {
    const html = renderToString(
      <GroupsScreen {...groupsDefaults} name="Trip" error="Group id is already in use" />,
    )

    expect(html).toContain("Group id is already in use")
    expect(html).toContain('value="Trip"')
  })

  it("posts a new shared group with the API's field names and the id it was drawn with", () => {
    const draftId = "5f0c7c2e-2a4b-4c7e-9b1d-3e2f1a0b9c8d"
    const screen = <GroupsScreen {...groupsDefaults} draftId={draftId} />
    const html = renderToString(screen)

    expect(formAt(noScriptSurface(screen), FORM_ACTIONS.groupCreate)).toEqual({
      action: "/groups",
      method: "post",
      fields: ["id", "kind", "name"],
    })
    expect(html).toContain(`name="id" value="${draftId}"`)
    expect(html).toContain(`name="kind" value="${GroupKind.SHARED}"`)
  })

  it("offers Refresh only to an app that can read the list again", () => {
    const { onRefresh: _, ...withoutRefresh } = groupsDefaults

    expect(noScriptSurface(<GroupsScreen {...groupsDefaults} />).scriptOnlyButtons)
      .toEqual(["group-refresh"])
    expect(noScriptSurface(<GroupsScreen {...withoutRefresh} />).scriptOnlyButtons).toEqual([])
  })

  it("gives each group a form that selects it and opens its notes, named after the group", () => {
    const screen = (
      <GroupsScreen
        {...groupsDefaults}
        groups={[
          { id: "g-1", name: "Home", kind: GroupKind.PERSONAL, role: GroupRole.OWNER },
          { id: "g-2", name: "Team", kind: GroupKind.SHARED, role: GroupRole.VIEWER },
        ]}
      />
    )
    const html = renderToString(screen)
    const surface = noScriptSurface(screen)

    const selects = surface.forms.filter((form) => form.action === FORM_ACTIONS.groupSelect)
    expect(selects).toEqual([
      { action: FORM_ACTIONS.groupSelect, method: "post", fields: ["groupId"] },
      { action: FORM_ACTIONS.groupSelect, method: "post", fields: ["groupId"] },
    ])
    expect(html).toContain('name="groupId" value="g-2"')
    expect(html).toContain('aria-label="Open notes in Team"')
  })

  it("links each group to its own settings page, named after the group", () => {
    const screen = (
      <GroupsScreen
        {...groupsDefaults}
        groups={[
          { id: "g-1", name: "Home", kind: GroupKind.PERSONAL, role: GroupRole.OWNER },
          { id: "g-2", name: "Team", kind: GroupKind.SHARED, role: GroupRole.VIEWER },
        ]}
      />
    )

    expect(noScriptSurface(screen).links).toEqual([
      GROUP_PATHS.settings("g-1"),
      GROUP_PATHS.settings("g-2"),
    ])
    expect(renderToString(screen)).toContain('aria-label="Settings of Team"')
  })

  it("marks only the selected group", () => {
    const groups = [
      { id: "g-1", name: "Home", kind: GroupKind.PERSONAL, role: GroupRole.OWNER },
      { id: "g-2", name: "Team", kind: GroupKind.SHARED, role: GroupRole.VIEWER },
    ]
    const marked = (selectedId: string | null) =>
      renderToString(<GroupsScreen {...groupsDefaults} groups={groups} selectedId={selectedId} />)
        .match(/>Selected</g)?.length ?? 0

    expect(marked("g-2")).toBe(1)
    expect(marked(null)).toBe(0)
    expect(renderToString(
      <GroupsScreen {...groupsDefaults} groups={groups} selectedId="g-2" />,
    )).toMatch(/Team<\/span>\s*(<!--.*?-->)?\s*<span[^>]*>Selected/)
  })
})

const settingsDefaults: GroupSettingsScreenProps = {
  group: { id: "g-1", name: "Team", kind: GroupKind.SHARED, role: GroupRole.OWNER },
  selected: false,
  loading: false,
}

describe("GroupSettingsScreen", () => {
  for (const role of [GroupRole.VIEWER, GroupRole.EDITOR, GroupRole.ADMIN, GroupRole.OWNER]) {
    it(`shows the General section read-only to a person whose role is ${GroupRole[role]}`, () => {
      const screen = (
        <GroupSettingsScreen
          {...settingsDefaults}
          group={{ ...settingsDefaults.group!, role }}
        />
      )
      const html = renderToString(screen)
      const surface = noScriptSurface(screen)

      expect(html).toContain("General")
      expect(html).toContain("Team")
      expect(html).toContain(`data-e2e="group-general-role">${ROLE_TEXT[role]}<`)
      // The only form is "Open notes"; there is nothing to edit, and no button that does nothing.
      expect(surface.forms).toEqual([
        { action: FORM_ACTIONS.groupSelect, method: "post", fields: ["groupId"] },
      ])
      expect(surface.scriptOnlyButtons).toEqual([])
      expect(html).not.toContain('<input type="text"')
      expect(html).not.toContain("<textarea")
    })
  }

  it("marks the group as selected only when it is the selected one", () => {
    expect(renderToString(<GroupSettingsScreen {...settingsDefaults} />)).not.toContain(
      ">Selected<",
    )
    expect(renderToString(<GroupSettingsScreen {...settingsDefaults} selected />)).toContain(
      ">Selected<",
    )
  })

  it("links back to the groups page", () => {
    expect(noScriptSurface(<GroupSettingsScreen {...settingsDefaults} />).links)
      .toEqual(["/groups"])
  })

  it("says the group does not exist once it has been read, and loading before", () => {
    const missing = <GroupSettingsScreen {...settingsDefaults} group={null} />

    expect(renderToString(missing)).toContain("This group does not exist.")
    expect(renderToString(<GroupSettingsScreen {...settingsDefaults} group={null} loading />))
      .toContain("Loading the group...")
    expect(noScriptSurface(missing).links).toEqual(["/groups"])
  })
})

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
const noteRow = {
  id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001",
  title: "Groceries",
  body: "milk",
  version: 3,
}
const noError = { title: null, form: null }
const notesDefaults: NotesScreenProps = {
  group: { id: groupId, name: "Team", canWrite: true },
  notes: [noteRow],
  loading: false,
  listError: null,
  nextPageHref: null,
}

describe("NotesScreen without JavaScript", () => {
  it("has no form: a link opens the create page and each note's own page", () => {
    const surface = noScriptSurface(<NotesScreen {...notesDefaults} />)

    expect(surface.forms).toEqual([])
    expect(surface.links).toContain(NOTE_PATHS.new)
    expect(surface.links).toContain(NOTE_PATHS.note(noteRow.id))
    expect(surface.scriptOnlyButtons).toEqual([])
  })

  it("shows a viewer the notes and no way to add one", () => {
    const screen = (
      <NotesScreen {...notesDefaults} group={{ id: groupId, name: "Team", canWrite: false }} />
    )
    const surface = noScriptSurface(screen)
    const html = renderToString(screen)

    expect(surface.links).not.toContain(NOTE_PATHS.new)
    expect(surface.links).toContain(NOTE_PATHS.note(noteRow.id))
    expect(html).toContain("Groceries")
    expect(html).toContain("Only an editor can change them.")
  })

  it("links a page without JavaScript to the older notes", () => {
    const surface = noScriptSurface(
      <NotesScreen {...notesDefaults} nextPageHref={`${NOTE_PATHS.list}?cursor=abc`} />,
    )

    expect(surface.links).toContain(`${NOTE_PATHS.list}?cursor=abc`)
  })

  it("says the group was not found once loading is over", () => {
    expect(renderToString(<NotesScreen {...notesDefaults} group={null} loading />)).toContain(
      "Loading the group...",
    )
    expect(renderToString(<NotesScreen {...notesDefaults} group={null} />)).toContain(
      "This group was not found.",
    )
  })
})

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
const existing = { id: noteRow.id, version: 2, conflict: false }

describe("NoteEditorScreen without JavaScript", () => {
  it("posts a new note to the selected group's create route with the API's field names", () => {
    const surface = noScriptSurface(<NoteEditorScreen {...editorDefaults} />)

    expect(surface.forms).toEqual([
      {
        action: NOTE_PATHS.create(groupId),
        method: "post",
        fields: schemaKeys(noteCreateRequestSchema),
      },
    ])
    expect(surface.links).toContain(NOTE_PATHS.list)
    expect(surface.scriptOnlyButtons).toEqual([])
  })

  it("posts the edit with the API's field names and the version it started from", () => {
    const screen = <NoteEditorScreen {...editorDefaults} note={existing} value={noteRow} />
    const html = renderToString(screen)
    const surface = noScriptSurface(screen)

    expect(formAt(surface, NOTE_PATHS.note(noteRow.id)).fields).toEqual(
      schemaKeys(noteUpdateRequestSchema),
    )
    expect(html).toContain('name="version" value="2"')
    expect(html).toContain('value="Groceries"')
  })

  it("links Delete to a page that asks first, instead of deleting on one click", () => {
    const surface = noScriptSurface(
      <NoteEditorScreen {...editorDefaults} note={existing} value={noteRow} />,
    )

    expect(surface.links).toContain(NOTE_PATHS.delete(noteRow.id))
    expect(surface.forms).toHaveLength(1)
    expect(surface.scriptOnlyButtons).toEqual([])
  })

  it('asks "delete this note?" in a form that posts the version the person saw', () => {
    const screen = (
      <NoteEditorScreen {...editorDefaults} note={existing} value={noteRow} confirmingDelete />
    )
    const html = renderToString(screen)
    const surface = noScriptSurface(screen)

    expect(surface.forms).toEqual([
      {
        action: NOTE_PATHS.delete(noteRow.id),
        method: "post",
        fields: schemaKeys(noteDeleteRequestSchema),
      },
    ])
    expect(html).toContain('name="version" value="2"')
    expect(html).toContain("Delete this note?")
    expect(surface.links).toContain(NOTE_PATHS.note(noteRow.id))
  })

  it("shows a viewer the note as text, with no form and no way to change it", () => {
    const screen = (
      <NoteEditorScreen
        {...editorDefaults}
        group={{ id: groupId, name: "Team", canWrite: false }}
        note={existing}
        value={noteRow}
      />
    )
    const surface = noScriptSurface(screen)
    const html = renderToString(screen)

    expect(surface.forms).toEqual([])
    expect(surface.links).toEqual([NOTE_PATHS.list])
    expect(html).toContain("Groceries")
    expect(html).toContain("milk")
    expect(html).toContain("Only an editor can change it.")
    expect(html).not.toContain("Delete")
  })

  it("tells a viewer on the create page that only an editor can add notes", () => {
    const screen = (
      <NoteEditorScreen
        {...editorDefaults}
        group={{ id: groupId, name: "Team", canWrite: false }}
      />
    )

    expect(noScriptSurface(screen).forms).toEqual([])
    expect(renderToString(screen)).toContain("Only an editor can add notes")
  })

  it("says the note was not found, with a way back to the list and no form", () => {
    const screen = <NoteEditorScreen {...editorDefaults} notFound />
    const surface = noScriptSurface(screen)

    expect(renderToString(screen)).toContain("Note not found")
    expect(renderToString(screen)).toContain("There is no such note in Team")
    expect(surface.forms).toEqual([])
    expect(surface.links).toEqual([NOTE_PATHS.list])
  })
})

describe("NoteEditorScreen", () => {
  it("ties the title error to its field and tells a stale edit where the latest version is", () => {
    const html = renderToString(
      <NoteEditorScreen
        {...editorDefaults}
        note={{ ...existing, conflict: true }}
        value={{ title: "Mine", body: "" }}
        errors={{ title: "Enter a title", form: "The note was changed by someone else" }}
      />,
    )

    expect(html).toMatch(/aria-describedby="note-title-error"/)
    expect(html).toContain("Enter a title")
    expect(html).toContain("The note was changed by someone else")
    expect(html).toContain("Load the latest version")
  })

  it("shows the error of a refused read instead of claiming the note does not exist", () => {
    const html = renderToString(
      <NoteEditorScreen {...editorDefaults} notFound errors={{ title: null, form: "Offline" }} />,
    )

    expect(html).toContain("Offline")
    expect(html).not.toContain("There is no such note")
  })

  it("says the group was not found once loading is over", () => {
    expect(renderToString(<NoteEditorScreen {...editorDefaults} group={null} loading />))
      .toContain("Loading the group...")
    expect(renderToString(<NoteEditorScreen {...editorDefaults} group={null} />)).toContain(
      "This group was not found.",
    )
  })

  it("says the note is loading while it is read", () => {
    const html = renderToString(<NoteEditorScreen {...editorDefaults} loading />)

    expect(html).toContain("Loading the note...")
    expect(html).not.toContain("<form")
  })
})
