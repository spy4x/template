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
import { ProfileScreen, type ProfileScreenProps } from "./profile-screen.tsx"
import { FORM_ACTIONS } from "./progressive.tsx"

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
    // The navigation's "Profile" is drawn twice (sidebar and drawer), the brand once.
    expect(pages).toEqual(["/", "/", "/"])
    expect(surface.forms).toEqual([])
    // Shell's user menu takes a link or a click handler, not a form, so "Sign out" is a button.
    expect(surface.scriptOnlyButtons).toEqual(["shell-user-menu-button", "(unnamed)"])
  })
})
