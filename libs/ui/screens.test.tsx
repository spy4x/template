import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { VNode } from "preact"
import { renderToString } from "preact-render-to-string"
import {
  authEmailChangeSchema,
  authEmailCodeSchema,
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
import { GroupRole, parseGroupIdRequest } from "@domain/groups"
import { ProfileScreen, type ProfileScreenProps } from "./profile-screen.tsx"
import { FORM_ACTIONS, NEXT_PARAM, SCREEN_PATHS } from "./progressive.tsx"
import { ForgotPasswordScreen, ResetPasswordScreen } from "./password-reset-screen.tsx"
import { EmailBanner, EmailScreen, type EmailScreenProps } from "./email-screen.tsx"
import { subscribeSchema, subscriptionConfirmSchema, unsubscribeSchema } from "@domain/subscribers"
import { SubscribeForm, SubscriptionConfirmScreen, UnsubscribeScreen } from "./subscribe-screen.tsx"

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
  // A disabled button is not an action: it does nothing with or without JavaScript.
  const scriptOnlyButtons = [...outside.matchAll(/<button\b[^>]*>/g)]
    .filter(([tag]) => !/\sdisabled(\s|=|>)/.test(tag))
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

  it("posts next as a hidden field of every auth form and keeps it on every link between them", () => {
    const next = "/notes/abc"
    const withNextQuery = (path: string) => `${path}?next=%2Fnotes%2Fabc`
    const signIn = noScriptSurface(<AuthScreen {...authDefaults} next={next} />)
    const signUp = noScriptSurface(<AuthScreen {...authDefaults} screen="sign-up" next={next} />)
    const code = noScriptSurface(
      <AuthScreen {...authDefaults} screen="one-time-code" isMfaRequired next={next} />,
    )
    expect(formAt(signIn, FORM_ACTIONS.signIn).fields)
      .toEqual([...schemaKeys(authSignInSchema), NEXT_PARAM].sort())
    expect(formAt(signUp, FORM_ACTIONS.signUp).fields)
      .toEqual([...schemaKeys(authSignUpSchema), NEXT_PARAM].sort())
    expect(formAt(code, FORM_ACTIONS.oneTimeCode).fields)
      .toEqual([...schemaKeys(authOTPSchema), NEXT_PARAM].sort())
    expect(signIn.links).toEqual([withNextQuery(SCREEN_PATHS.signUp), SCREEN_PATHS.forgotPassword])
    expect(signUp.links).toEqual([withNextQuery(SCREEN_PATHS.signIn)])
    expect(code.links).toEqual([withNextQuery(SCREEN_PATHS.signIn)])
    expect(renderToString(<AuthScreen {...authDefaults} next={next} />))
      .toContain(`<input type="hidden" name="next" value="/notes/abc"`)
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
    const frame = (
      <AppFrame user={{ firstName: "Ada", lastName: "" }} connection="open" onSignOut={() => {}}>
        page
      </AppFrame>
    )
    const html = renderToString(frame)
    const surface = noScriptSurface(frame)
    const [skipLink, ...pages] = surface.links
    expect(skipLink).toMatch(/^#./)
    // The navigation is drawn twice (sidebar and drawer), the brand once.
    expect(pages.filter((href) => href === "/")).toHaveLength(3)
    expect(pages.filter((href) => href === "/notes")).toHaveLength(2)
    expect(pages.filter((href) => href === "/groups")).toHaveLength(2)
    expect(pages).toHaveLength(7)
    // "Sign out" is a form in the user menu. The menu is a `<details>` until the page hydrates, so
    // the browser opens it from its `<summary>` and no button needs a script.
    expect(surface.forms).toEqual([{ action: FORM_ACTIONS.signOut, method: "post", fields: [] }])
    expect(surface.scriptOnlyButtons).toEqual([])
    const menu = html.match(
      /<details\b[^>]*>(?:(?!<\/details>)[\s\S])*?data-e2e="shell-user-menu-button"[\s\S]*?<\/details>/,
    )
    expect(menu?.[0]).toMatch(/<summary\b[^>]*data-e2e="shell-user-menu-button"/)
    expect(menu?.[0]).toContain(`<form method="post" action="${FORM_ACTIONS.signOut}"`)
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
    expect(parseGroupIdRequest(body)).toEqual(body)
  })

  it("draws the form through ScreenForm, so it has EnhancedForm's status line and not a plain form's", () => {
    const html = renderToString(frame())
    const forms = [...html.matchAll(/<form\b[^>]*action="\/groups\/select"[^>]*>[\s\S]*?<\/form>/g)]

    expect(forms).toHaveLength(2)
    for (const [form] of forms) {
      expect(form).toContain(" space-y-0! ")
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

const emailDefaults: EmailScreenProps = {
  status: { email: "ann@example.com", proven: false, pending: null },
  values: { code: "", email: "", password: "" },
  onValueChange: () => {},
  errors: { verify: null, send: null, change: null },
  notices: { send: null, change: null },
  pending: { verify: false, send: false, change: false },
}

describe("EmailScreen without JavaScript", () => {
  it("posts the code, a new-code request and an address change with the API's field names", () => {
    const surface = noScriptSurface(<EmailScreen {...emailDefaults} />)
    expect(surface.forms).toEqual([
      { action: FORM_ACTIONS.emailVerify, method: "post", fields: schemaKeys(authEmailCodeSchema) },
      { action: FORM_ACTIONS.emailSend, method: "post", fields: [] },
      {
        action: FORM_ACTIONS.emailChange,
        method: "post",
        fields: schemaKeys(authEmailChangeSchema),
      },
    ])
    expect(surface.links).toEqual([SCREEN_PATHS.profile])
    expect(surface.scriptOnlyButtons).toEqual([])
  })

  it("asks for no code once the address is proven and no change waits", () => {
    const status = { email: "ann@example.com", proven: true, pending: null }
    const surface = noScriptSurface(<EmailScreen {...emailDefaults} status={status} />)
    expect(surface.forms.map((form) => form.action)).toEqual([FORM_ACTIONS.emailChange])
  })

  it("asks for the code of the waiting new address, and keeps the old one shown", () => {
    const status = { email: "ann@example.com", proven: true, pending: "new@example.com" }
    const html = renderToString(<EmailScreen {...emailDefaults} status={status} />)
    expect(html).toContain("Enter the code from the mail to <strong>new@example.com</strong>")
    expect(html).toContain("You sign in with <strong>ann@example.com</strong>")
  })
})

describe("EmailScreen wording", () => {
  it("tells a username account that the address replaces the username for sign-in", () => {
    const status = { email: null, proven: false, pending: null }
    const html = renderToString(<EmailScreen {...emailDefaults} status={status} />)
    expect(html).toContain("you sign in with that address instead of your username")
  })

  it("claims no mail was sent, since mail may be off", () => {
    const status = { email: "ann@example.com", proven: false, pending: null }
    const page = renderToString(<EmailScreen {...emailDefaults} status={status} />)
    const banner = renderToString(<EmailBanner status={status} />)
    for (const html of [page, banner]) expect(html.toLowerCase()).not.toMatch(/\bsent\b/)
  })
})

describe("EmailBanner without JavaScript", () => {
  it("links to the e-mail page while an address waits for its code", () => {
    const status = { email: "ann@example.com", proven: false, pending: null }
    expect(noScriptSurface(<EmailBanner status={status} />).links).toEqual([SCREEN_PATHS.email])
  })

  it("draws nothing once the address is proven, or before its state is known", () => {
    const proven = { email: "ann@example.com", proven: true, pending: null }
    expect(renderToString(<EmailBanner status={proven} />)).toBe("")
    expect(renderToString(<EmailBanner status={null} />)).toBe("")
  })
})

describe("SubscribeForm without JavaScript", () => {
  const props = { email: "", onEmailChange: () => {}, list: "news", error: null, pending: false }

  it("posts the address and the list to the subscribe route", () => {
    const node = <SubscribeForm {...props} sent={false} />
    const surface = noScriptSurface(node)
    expect(surface.forms).toEqual([
      { action: FORM_ACTIONS.subscribe, method: "post", fields: schemaKeys(subscribeSchema) },
    ])
    expect(surface.scriptOnlyButtons).toEqual([])
    expect(renderToString(node)).toContain(`name="list" value="news"`)
  })

  it("says the link is on its way and asks nothing more once it is sent", () => {
    const surface = noScriptSurface(<SubscribeForm {...props} sent />)
    expect(surface.forms).toEqual([])
  })
})

describe("SubscriptionConfirmScreen without JavaScript", () => {
  const props = {
    state: "confirm" as const,
    list: "news",
    token: "token-from-the-link",
    error: null,
    pending: false,
  }

  it("posts the link's list and token to the confirm route", () => {
    const node = <SubscriptionConfirmScreen {...props} />
    const surface = noScriptSurface(node)
    expect(surface.forms).toEqual([
      {
        action: FORM_ACTIONS.subscribeConfirm,
        method: "post",
        fields: schemaKeys(subscriptionConfirmSchema),
      },
    ])
    expect(surface.scriptOnlyButtons).toEqual([])
    const html = renderToString(node)
    expect(html).toContain(`name="list" value="news"`)
    expect(html).toContain(`name="token" value="token-from-the-link"`)
  })

  it("keeps the form after a failed confirm, so the click can be tried again", () => {
    const surface = noScriptSurface(<SubscriptionConfirmScreen {...props} state="error" />)
    expect(formAt(surface, FORM_ACTIONS.subscribeConfirm).fields)
      .toEqual(schemaKeys(subscriptionConfirmSchema))
  })

  it("offers a new link instead of a form when the link expired, broke or lacks its token", () => {
    for (
      const broken of [{ state: "expired" as const }, { state: "invalid" as const }, { token: "" }]
    ) {
      const surface = noScriptSurface(<SubscriptionConfirmScreen {...props} {...broken} />)
      expect(surface.forms).toEqual([])
      expect(surface.links).toEqual([SCREEN_PATHS.subscribe])
    }
  })

  it("asks nothing more once the subscription is confirmed", () => {
    const surface = noScriptSurface(<SubscriptionConfirmScreen {...props} state="done" />)
    expect(surface.forms).toEqual([])
    expect(surface.links).toEqual([])
  })
})

describe("UnsubscribeScreen without JavaScript", () => {
  const props = {
    state: "confirm" as const,
    list: "news",
    token: "token-from-the-link",
    error: null,
    pending: false,
  }

  it("posts the link's list and token to the unsubscribe route", () => {
    const node = <UnsubscribeScreen {...props} />
    const surface = noScriptSurface(node)
    expect(surface.forms).toEqual([
      { action: FORM_ACTIONS.unsubscribe, method: "post", fields: schemaKeys(unsubscribeSchema) },
    ])
    expect(surface.scriptOnlyButtons).toEqual([])
    expect(renderToString(node)).toContain(`name="token" value="token-from-the-link"`)
  })

  it("links to subscribing again once the address is removed", () => {
    const surface = noScriptSurface(<UnsubscribeScreen {...props} state="done" />)
    expect(surface.forms).toEqual([])
    expect(surface.links).toEqual([SCREEN_PATHS.subscribe])
  })

  it("shows no form for a link it does not recognise", () => {
    for (const broken of [{ state: "not-recognised" as const }, { token: "" }]) {
      expect(noScriptSurface(<UnsubscribeScreen {...props} {...broken} />).forms).toEqual([])
    }
  })
})
