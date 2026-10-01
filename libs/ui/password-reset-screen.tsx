import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { Card, CardBody, CardHeader } from "@spy4x/preact-ui/card"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { FORM_ACTIONS, type Navigate, SCREEN_PATHS, ScreenForm } from "./progressive.tsx"

/** The messages shown when a step failed without a message of its own. */
export const PASSWORD_RESET_FAILURES = {
  forgot: "Could not send the link",
  reset: "Could not change the password",
} as const

/** A card with a heading, a sentence and one link onward. */
function Message(
  { title, text, href, link, navigate, e2e }: {
    title: string
    text: string
    href: string
    link: string
    navigate?: Navigate
    e2e: string
  },
): JSX.Element {
  return (
    <Card class="mx-auto w-full max-w-md" data-e2e={e2e}>
      <CardHeader>
        <h1 class="text-lg font-semibold">{title}</h1>
      </CardHeader>
      <CardBody>
        <p class="mb-4" role="status">{text}</p>
        <Link href={href} navigate={navigate} class="pc-link">{link}</Link>
      </CardBody>
    </Card>
  )
}

/** Moves focus to `field` each time a new `error` arrives, so a failed submit lands on it. */
function useFocusOnError(error: string | null) {
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (error) field.current?.focus()
  }, [error])
  return field
}

export interface ForgotPasswordScreenProps {
  /** The address typed so far. */
  email: string
  onEmailChange: (email: string) => void
  /** The API's answer was accepted: the screen says to check the inbox instead of asking again. */
  sent: boolean
  /** What the API said, when it accepted the request. */
  sentMessage?: string
  error: string | null
  pending: boolean
  onSubmit?: () => void
  navigate?: Navigate
}

/**
 * Asks for the address a reset link goes to. Without `onSubmit` the form posts `{ email }` to its
 * route; with it the app takes the submit over. The answer is the same whether or not an account
 * uses the address, so the screen never says which.
 */
export function ForgotPasswordScreen(
  { email, onEmailChange, sent, sentMessage, error, pending, onSubmit, navigate }:
    ForgotPasswordScreenProps,
): JSX.Element {
  const field = useFocusOnError(error)
  if (sent) {
    return (
      <Message
        title="Check your inbox"
        text={sentMessage ??
          "If an account uses this address, a link to reset its password is on its way."}
        href={SCREEN_PATHS.signIn}
        link="Back to sign in"
        navigate={navigate}
        e2e="forgot-password-sent"
      />
    )
  }
  return (
    <Card class="mx-auto w-full max-w-md">
      <CardHeader>
        <h1 class="text-lg font-semibold">Forgot your password?</h1>
      </CardHeader>
      <CardBody>
        <p class="mb-4 text-sm">
          Enter the e-mail address you signed up with. We send a link that lets you choose a new
          password. It works once, for 30 minutes.
        </p>
        <ScreenForm action={FORM_ACTIONS.forgotPassword} pending={pending} onSubmit={onSubmit}>
          <Stack>
            <Field id="forgot-password-email" label="E-mail" error={error} required>
              <Input
                ref={field}
                data-e2e="forgot-password-email"
                name="email"
                type="email"
                autocomplete="email"
                value={email}
                onInput={(e) => onEmailChange(e.currentTarget.value)}
                required
              />
            </Field>
            <div>
              <Button
                type="submit"
                data-e2e="forgot-password-submit"
                busy={pending}
                busyLabel="Sending..."
              >
                Send the link
              </Button>
            </div>
            <p class="text-sm">
              <Link href={SCREEN_PATHS.signIn} navigate={navigate} class="pc-link">
                Back to sign in
              </Link>
            </p>
          </Stack>
        </ScreenForm>
      </CardBody>
    </Card>
  )
}

export interface ResetPasswordScreenProps {
  /** The address from the link. */
  email: string
  /** The code from the link. */
  code: string
  /** The new password typed so far. */
  newPassword: string
  onNewPasswordChange: (newPassword: string) => void
  /** The password was changed: the screen points to sign-in. */
  done: boolean
  error: string | null
  pending: boolean
  onSubmit?: () => void
  navigate?: Navigate
}

/**
 * Sets a new password with the address and code a reset link carries. The form posts
 * `{ email, code, newPassword }` to its route, the first two as hidden fields; with `onSubmit` the
 * app takes the submit over. A link without its address or code offers a new link instead.
 */
export function ResetPasswordScreen(
  { email, code, newPassword, onNewPasswordChange, done, error, pending, onSubmit, navigate }:
    ResetPasswordScreenProps,
): JSX.Element {
  const field = useFocusOnError(error)
  if (done) {
    return (
      <Message
        title="Password changed"
        text="Every session of your account is signed out. Sign in with your new password."
        href={SCREEN_PATHS.signIn}
        link="Sign in"
        navigate={navigate}
        e2e="reset-password-done"
      />
    )
  }
  if (!email || !code) {
    return (
      <Message
        title="This link is incomplete"
        text="Open the link from the mail again, or ask for a new one."
        href={SCREEN_PATHS.forgotPassword}
        link="Ask for a new link"
        navigate={navigate}
        e2e="reset-password-incomplete"
      />
    )
  }
  return (
    <Card class="mx-auto w-full max-w-md">
      <CardHeader>
        <h1 class="text-lg font-semibold">Choose a new password</h1>
      </CardHeader>
      <CardBody>
        <p class="mb-4 text-sm">
          For {email}. Saving it signs your account out everywhere.
        </p>
        <ScreenForm action={FORM_ACTIONS.resetPassword} pending={pending} onSubmit={onSubmit}>
          <Stack>
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="code" value={code} />
            <Field
              id="reset-password-new"
              label="New password"
              hint="8 to 50 characters."
              error={error}
              required
            >
              <Input
                ref={field}
                data-e2e="reset-password-new"
                name="newPassword"
                type="password"
                autocomplete="new-password"
                value={newPassword}
                onInput={(e) => onNewPasswordChange(e.currentTarget.value)}
                required
              />
            </Field>
            <div>
              <Button
                type="submit"
                data-e2e="reset-password-submit"
                busy={pending}
                busyLabel="Saving..."
              >
                Save the new password
              </Button>
            </div>
            <p class="text-sm">
              <Link href={SCREEN_PATHS.forgotPassword} navigate={navigate} class="pc-link">
                Ask for a new link
              </Link>
            </p>
          </Stack>
        </ScreenForm>
      </CardBody>
    </Card>
  )
}
