import type { JSX } from "preact"
import { type AuthCredentials, AuthForm, type AuthMode } from "@spy4x/preact-system/auth-form"
import { Card, CardBody, CardHeader } from "@spy4x/preact-ui/card"
import { FORM_ACTIONS, type Navigate, SCREEN_PATHS, ScreenLink } from "./progressive.tsx"

/** The three screens `AuthScreen` draws: the two credential modes, and the second factor. */
export type AuthScreenKind = AuthMode | "one-time-code"

/** The page of each auth screen. */
export const AUTH_PATHS: Record<AuthScreenKind, string> = {
  "sign-in": SCREEN_PATHS.signIn,
  "sign-up": SCREEN_PATHS.signUp,
  "one-time-code": SCREEN_PATHS.oneTimeCode,
}

const ACTIONS: Record<AuthScreenKind, string> = {
  "sign-in": FORM_ACTIONS.signIn,
  "sign-up": FORM_ACTIONS.signUp,
  "one-time-code": FORM_ACTIONS.oneTimeCode,
}

const COPY: Record<AuthScreenKind, { title: string; description: string; failure: string }> = {
  "sign-in": {
    title: "Welcome back",
    description: "Sign in to manage your profile and push devices.",
    failure: "Sign in failed",
  },
  "sign-up": {
    title: "Create account",
    description: "Start with a username and password.",
    failure: "Sign up failed",
  },
  "one-time-code": {
    title: "2FA verification",
    description: "Enter the 6-digit code from your authenticator app.",
    failure: "Invalid token",
  },
}

/** The message to show when an attempt on `screen` failed without a message of its own. */
export function authFailureMessage(screen: AuthScreenKind): string {
  return COPY[screen].failure
}

export interface AuthScreenProps {
  screen: AuthScreenKind
  /** Signed in with every factor done: the credential screens say so instead of asking again. */
  isSignedIn: boolean
  /** The session owes its one-time code: the one-time-code screen asks for it. */
  isMfaRequired: boolean
  busy: boolean
  error: string | null
  onModeChange?: (mode: AuthMode) => void
  onSignIn?: (credentials: AuthCredentials) => void
  onSignUp?: (credentials: AuthCredentials) => void
  onOneTimeCode?: (code: string) => void
  navigate?: Navigate
}

/** A card with a heading, a sentence and one link onward. */
function Notice(
  { title, text, link, navigate }: {
    title: string
    text: string
    link: string
    navigate?: Navigate
  },
): JSX.Element {
  return (
    <Card class="mx-auto w-full max-w-md">
      <CardHeader>
        <h1 class="text-lg font-semibold">{title}</h1>
      </CardHeader>
      <CardBody>
        <p class="mb-4">{text}</p>
        <ScreenLink href={SCREEN_PATHS.profile} navigate={navigate} class="pc-link">
          {link}
        </ScreenLink>
      </CardBody>
    </Card>
  )
}

/**
 * Sign-in, sign-up and the second-factor step: one `AuthForm` from `@spy4x/preact-system`. Without
 * callbacks each form posts to its page's route; with them the app takes the submit over.
 */
export function AuthScreen(
  {
    screen,
    isSignedIn,
    isMfaRequired,
    busy,
    error,
    onModeChange,
    onSignIn,
    onSignUp,
    onOneTimeCode,
    navigate,
  }: AuthScreenProps,
): JSX.Element {
  const copy = COPY[screen]

  if (screen === "one-time-code" && !isMfaRequired) {
    return (
      <Notice
        title="MFA not required"
        text="Continue to profile."
        link="Open profile"
        navigate={navigate}
      />
    )
  }

  if (screen !== "one-time-code" && isSignedIn) {
    return (
      <Notice
        title="Already signed in"
        text="Go to your profile."
        link="Open profile"
        navigate={navigate}
      />
    )
  }

  return (
    <Card class="mx-auto w-full max-w-md">
      <CardHeader>
        <h1 class="text-lg font-semibold">{copy.title}</h1>
      </CardHeader>
      <CardBody>
        <p class="mb-4 text-sm">{copy.description}</p>
        <AuthForm
          mode={screen === "one-time-code" ? "sign-in" : screen}
          step={screen === "one-time-code" ? "one-time-code" : "credentials"}
          action={ACTIONS[screen]}
          busy={busy}
          error={error}
          labels={{ login: "Username", codeHint: "Six digits from your authenticator app." }}
          onModeChange={onModeChange}
          onSignIn={onSignIn}
          onSignUp={onSignUp}
          onOneTimeCode={onOneTimeCode}
          footer={screen === "one-time-code" && (
            <p class="text-sm">
              Need help?{" "}
              <ScreenLink href={SCREEN_PATHS.signIn} navigate={navigate} class="pc-link">
                Back to sign in
              </ScreenLink>
            </p>
          )}
        />
      </CardBody>
    </Card>
  )
}
