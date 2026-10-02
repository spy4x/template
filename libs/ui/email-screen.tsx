import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { Card, CardBody, CardHeader } from "@spy4x/preact-ui/card"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { type EmailStatus, emailToVerify } from "@domain/identity"
import { FORM_ACTIONS, type Navigate, SCREEN_PATHS, ScreenForm } from "./progressive.tsx"

/** The messages shown when an action failed without a message of its own. */
export const EMAIL_FAILURES = {
  verify: "Could not check the code",
  send: "Could not send a new code",
  change: "Could not change the address",
  load: "Your e-mail address could not be read.",
} as const

/**
 * The banner a signed-in page shows while an address waits for its code. Nothing when there is
 * none. The link opens the page where the code goes.
 */
export function EmailBanner(
  { status, navigate }: { status: EmailStatus | null; navigate?: Navigate },
): JSX.Element | null {
  const email = status && emailToVerify(status)
  if (!email) return null
  return (
    <section
      aria-label="Verify your e-mail address"
      class="mb-6 rounded-lg border border-subtle bg-primary-muted px-4 py-3 text-sm"
      data-e2e="email-banner"
    >
      <p>
        Verify your e-mail address <strong>{email}</strong> with the code we mail there.{" "}
        <Link href={SCREEN_PATHS.email} navigate={navigate} class="pc-link">
          Enter the code
        </Link>
      </p>
    </section>
  )
}

/**
 * Stands in for the e-mail page when its state could not be read: the message, and a way to try
 * again. With `onRetry` the app reads the state again; without it, the button is a link that loads
 * the page again.
 */
export function EmailUnavailable(
  { onRetry, navigate }: { onRetry?: () => void; navigate?: Navigate },
): JSX.Element {
  return (
    <Stack data-e2e="email-unavailable">
      <ErrorState message={EMAIL_FAILURES.load} />
      <div class="text-center">
        {onRetry
          ? (
            <Button type="button" data-e2e="email-retry" onClick={onRetry}>
              Try again
            </Button>
          )
          : (
            <Button href={SCREEN_PATHS.email} navigate={navigate} data-e2e="email-retry">
              Try again
            </Button>
          )}
      </div>
    </Stack>
  )
}

/** What the person typed into the screen's forms. */
export interface EmailValues {
  /** The code from the mail. */
  code: string
  /** The new address. */
  email: string
  /** The current password, which an address change asks for. */
  password: string
}

/** One message per form: an error, or what the API said when it accepted the request. */
export interface EmailMessages {
  verify: string | null
  send: string | null
  change: string | null
}

export interface EmailScreenProps {
  status: EmailStatus
  values: EmailValues
  onValueChange: (field: keyof EmailValues, value: string) => void
  errors: EmailMessages
  /** What the API said when it accepted a request: a code is on its way, say. */
  notices: Pick<EmailMessages, "send" | "change">
  pending: Record<keyof EmailMessages, boolean>
  onVerify?: () => void
  onSend?: () => void
  onChange?: () => void
  navigate?: Navigate
}

/** Moves focus to `field` each time a new `error` arrives, so a failed submit lands on it. */
function useFocusOnError(error: string | null) {
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (error) field.current?.focus()
  }, [error])
  return field
}

/**
 * The person's e-mail address: the code that proves it, a new code, and a change of address that
 * waits for the new one's code. Every form posts to its route without JavaScript (`{ code }`, no
 * fields, `{ email, password }`); with its callback the app takes the submit over.
 */
export function EmailScreen(
  {
    status,
    values,
    onValueChange,
    errors,
    notices,
    pending,
    onVerify,
    onSend,
    onChange,
    navigate,
  }: EmailScreenProps,
): JSX.Element {
  const target = emailToVerify(status)
  const codeField = useFocusOnError(errors.verify)
  const emailField = useFocusOnError(errors.change)

  // A change just asked for, or a code just used: focus moves on to the step that follows.
  const shown = useRef(target)
  useEffect(() => {
    if (shown.current === target) return
    shown.current = target
    if (target) codeField.current?.focus()
  }, [target])

  return (
    <Stack gap="lg">
      <Card>
        <CardHeader>
          <h1 class="text-lg font-semibold">E-mail address</h1>
        </CardHeader>
        <CardBody>
          <p class="text-sm" data-e2e="email-current">
            {status.email === null
              ? "Your account signs in with a username and has no e-mail address yet."
              : (
                <>
                  You sign in with <strong>{status.email}</strong>
                  {status.proven ? ", which is verified." : ", which is not verified yet."}
                </>
              )}
          </p>
        </CardBody>
      </Card>

      {target && (
        <Card data-e2e="email-verify-card">
          <CardHeader title="Enter the code" headingLevel={2} />
          <CardBody>
            <p class="mb-4 text-sm">
              Enter the code from the mail to{" "}
              <strong>{target}</strong>. A code works once, for 10 minutes; if none arrived, ask for
              a new one.
              {status.pending && " Your address changes once you enter it."}
            </p>
            <ScreenForm
              action={FORM_ACTIONS.emailVerify}
              pending={pending.verify}
              onSubmit={onVerify}
            >
              <Stack>
                <Field id="email-code" label="Code" error={errors.verify} required>
                  <Input
                    ref={codeField}
                    data-e2e="email-code"
                    name="code"
                    autocomplete="one-time-code"
                    autocapitalize="off"
                    spellcheck={false}
                    value={values.code}
                    onInput={(e) => onValueChange("code", e.currentTarget.value)}
                    required
                  />
                </Field>
                <div>
                  <Button
                    type="submit"
                    data-e2e="email-verify"
                    busy={pending.verify}
                    busyLabel="Checking..."
                  >
                    Verify
                  </Button>
                </div>
              </Stack>
            </ScreenForm>
            <ScreenForm
              action={FORM_ACTIONS.emailSend}
              pending={pending.send}
              onSubmit={onSend}
              class="mt-4"
            >
              <Stack>
                <ErrorState message={errors.send} />
                {notices.send && (
                  <p class="text-sm" role="status" data-e2e="email-send-notice">{notices.send}</p>
                )}
                <div>
                  <Button
                    type="submit"
                    variant="outline"
                    data-e2e="email-send"
                    busy={pending.send}
                    busyLabel="Sending..."
                  >
                    Send a new code
                  </Button>
                </div>
              </Stack>
            </ScreenForm>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title={status.email === null ? "Add an address" : "Change your address"}
          headingLevel={2}
        />
        <CardBody>
          <p class="mb-4 text-sm">
            We send a code to the new address. {status.email === null
              ? "Once you enter it, you sign in with that address instead of your username."
              : `You keep signing in with ${status.email} until you enter it.`}
          </p>
          <ScreenForm
            action={FORM_ACTIONS.emailChange}
            pending={pending.change}
            onSubmit={onChange}
          >
            <Stack>
              <Field id="email-new" label="New e-mail address" required>
                <Input
                  ref={emailField}
                  data-e2e="email-new"
                  name="email"
                  type="email"
                  autocomplete="email"
                  value={values.email}
                  onInput={(e) => onValueChange("email", e.currentTarget.value)}
                  required
                />
              </Field>
              <Field id="email-password" label="Current password" required>
                <Input
                  data-e2e="email-password"
                  name="password"
                  type="password"
                  autocomplete="current-password"
                  value={values.password}
                  onInput={(e) => onValueChange("password", e.currentTarget.value)}
                  required
                />
              </Field>
              {/* The API's refusal names no field: the password, the address or the limit. */}
              <ErrorState message={errors.change} />
              {notices.change && (
                <p class="text-sm" role="status" data-e2e="email-change-notice">
                  {notices.change}
                </p>
              )}
              <div>
                <Button
                  type="submit"
                  variant="secondary"
                  data-e2e="email-change"
                  busy={pending.change}
                  busyLabel="Sending..."
                >
                  Send a code to the new address
                </Button>
              </div>
            </Stack>
          </ScreenForm>
          <p class="mt-4 text-sm">
            <Link href={SCREEN_PATHS.profile} navigate={navigate} class="pc-link">
              Back to the profile
            </Link>
          </p>
        </CardBody>
      </Card>
    </Stack>
  )
}
