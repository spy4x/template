import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { VNode } from "preact"
import { renderToString } from "preact-render-to-string"
import {
  authOTPSchema,
  authPasswordChangeSchema,
  UserMFAStatus,
  userProfileBaseSchema,
  type UserPushTokenPublic,
} from "@domain/identity"
import { pushUnsubscribeRequestSchema } from "@spy4x/platform/model"
import { AuthScreen, type AuthScreenProps } from "./auth-screen.tsx"
import { AppFrame, PublicFrame } from "./frame.tsx"
import { GroupKind, GroupRole } from "@domain/groups"
import { GroupsScreen, type GroupsScreenProps } from "./groups-screen.tsx"
import { ProfileScreen, type ProfileScreenProps } from "./profile-screen.tsx"
import { FORM_ACTIONS, NOTE_PATHS } from "./progressive.tsx"
import {
  noteCreateRequestSchema,
  noteDeleteRequestSchema,
  noteUpdateRequestSchema,
} from "@domain/notes"
import { NotesScreen, type NotesScreenProps } from "./notes-screen.tsx"

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
  it("posts the sign-in credentials to the sign-in route", () => {
    const surface = noScriptSurface(<AuthScreen {...authDefaults} />)
    expect(surface.forms).toEqual([
      // AuthForm names the username field `login`; the API calls it `username`.
      { action: FORM_ACTIONS.signIn, method: "post", fields: ["login", "password"] },
    ])
    expect(surface.scriptOnlyButtons).toEqual(["auth-form-password-toggle"])
  })

  it("posts the sign-up credentials to the sign-up route", () => {
    const surface = noScriptSurface(<AuthScreen {...authDefaults} screen="sign-up" />)
    expect(surface.forms).toEqual([
      { action: FORM_ACTIONS.signUp, method: "post", fields: ["login", "password"] },
    ])
  })

  it("posts the one-time code to its route and links back to sign in", () => {
    const surface = noScriptSurface(
      <AuthScreen {...authDefaults} screen="one-time-code" isMfaRequired />,
    )
    expect(surface.forms).toEqual([
      // AuthForm names the code field `code`; the API calls it `otp`.
      { action: FORM_ACTIONS.oneTimeCode, method: "post", fields: ["code"] },
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
  errors: { profile: null, password: null, push: null },
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
    // Subscribing to push needs the browser's push manager: the one action with no native form.
    expect(surface.scriptOnlyButtons).toEqual(["push-register"])
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

  it("links the brand and the navigation of the signed-in frame, but signs out only with JavaScript", () => {
    const surface = noScriptSurface(
      <AppFrame user={{ firstName: "Ada", lastName: "" }} connection="open" onSignOut={() => {}}>
        page
      </AppFrame>,
    )
    const [skipLink, ...pages] = surface.links
    expect(skipLink).toMatch(/^#./)
    // The navigation is drawn twice (sidebar and drawer), the brand once.
    expect(pages.filter((href) => href === "/")).toHaveLength(3)
    expect(pages.filter((href) => href === "/groups")).toHaveLength(2)
    expect(pages).toHaveLength(5)
    expect(surface.forms).toEqual([])
    // Shell's user menu takes a link or a click handler, not a form, so "Sign out" is a button.
    expect(surface.scriptOnlyButtons).toEqual(["shell-user-menu-button", "(unnamed)"])
  })
})

const groupsDefaults: GroupsScreenProps = {
  groups: [],
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

  it("posts to no route of its own, because it works only with JavaScript", () => {
    const surface = noScriptSurface(<GroupsScreen {...groupsDefaults} />)

    expect(surface.forms.map((form) => form.action)).toEqual([undefined])
    expect(surface.scriptOnlyButtons).toEqual(["group-refresh"])
  })

  it("links each group to its notes", () => {
    const surface = noScriptSurface(
      <GroupsScreen
        {...groupsDefaults}
        groups={[{ id: "g-2", name: "Team", kind: GroupKind.SHARED, role: GroupRole.VIEWER }]}
      />,
    )

    expect(surface.links).toEqual([NOTE_PATHS.list("g-2")])
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

describe("NotesScreen without JavaScript", () => {
  it("posts a new note and each delete with the API's field names, and links each note to its edit page", () => {
    const surface = noScriptSurface(<NotesScreen {...notesDefaults} />)

    expect(surface.forms.every((form) => form.method === "post")).toBe(true)
    expect(formAt(surface, NOTE_PATHS.list(groupId)).fields).toEqual(
      schemaKeys(noteCreateRequestSchema),
    )
    expect(formAt(surface, NOTE_PATHS.delete(groupId, noteRow.id)).fields).toEqual(
      schemaKeys(noteDeleteRequestSchema),
    )
    expect(surface.forms).toHaveLength(2)
    expect(surface.links).toContain(NOTE_PATHS.note(groupId, noteRow.id))
    expect(surface.scriptOnlyButtons).toEqual([])
  })

  it("posts the edit with the API's field names and the version it started from", () => {
    // The edit started from version 2 while the list already shows 3: the form must post the
    // version the person edited, not the one the delete form next to it carries.
    const screen = (
      <NotesScreen
        {...notesDefaults}
        editing={{ id: noteRow.id, title: "Groceries", body: "", version: 2, conflict: false }}
      />
    )
    const html = renderToString(screen)
    const surface = noScriptSurface(screen)

    expect(formAt(surface, NOTE_PATHS.note(groupId, noteRow.id)).fields).toEqual(
      schemaKeys(noteUpdateRequestSchema),
    )
    expect(html).toContain('name="version" value="2"')
    expect(surface.links).toContain(NOTE_PATHS.list(groupId))
  })

  it("shows a viewer the notes without a single form", () => {
    const surface = noScriptSurface(
      <NotesScreen {...notesDefaults} group={{ id: groupId, name: "Team", canWrite: false }} />,
    )
    const html = renderToString(
      <NotesScreen {...notesDefaults} group={{ id: groupId, name: "Team", canWrite: false }} />,
    )

    expect(surface.forms).toEqual([])
    expect(html).toContain("Groceries")
    expect(html).toContain("Only an editor can change them.")
  })

  it("links a page without JavaScript to the older notes", () => {
    const surface = noScriptSurface(
      <NotesScreen {...notesDefaults} nextPageHref={`${NOTE_PATHS.list(groupId)}?cursor=abc`} />,
    )

    expect(surface.links).toContain(`${NOTE_PATHS.list(groupId)}?cursor=abc`)
  })
})

describe("NotesScreen", () => {
  it("ties the title error to its field and tells a stale edit where the latest version is", () => {
    const html = renderToString(
      <NotesScreen
        {...notesDefaults}
        editing={{ id: noteRow.id, title: "Mine", body: "", version: 3, conflict: true }}
        editErrors={{ title: "Enter a title", form: "The note was changed by someone else" }}
      />,
    )

    expect(html).toMatch(/aria-describedby="note-edit-title-error"/)
    expect(html).toContain("Enter a title")
    expect(html).toContain("The note was changed by someone else")
    expect(html).toContain("Load the latest version")
  })

  it("names each delete button after its note", () => {
    const html = renderToString(<NotesScreen {...notesDefaults} />)

    expect(html).toContain('aria-label="Delete Groceries"')
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
