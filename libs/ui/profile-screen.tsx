import type { JSX } from "preact"
import { encodeBase64 } from "@std/encoding"
import { Button, buttonClasses } from "@spy4x/preact-ui/button"
import { Card, CardBody, CardHeader } from "@spy4x/preact-ui/card"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Grid, Stack } from "@spy4x/preact-ui/layout"
import type { UserMFAStatus, UserPushTokenPublic } from "@domain/identity"
import type { ConnectionStatus } from "./frame.tsx"
import { FORM_ACTIONS, type Navigate, SCREEN_PATHS, ScreenLink, takeOver } from "./progressive.tsx"
import { TwoFactorStep, twoFactorStep } from "./two-factor.ts"

/** The messages shown when an action failed without a message of its own. */
export const PROFILE_FAILURES = {
  profile: "Update failed",
  password: "Password change failed",
  totpFinish: "Failed to enable 2FA",
  totpDisable: "Failed to disable 2FA",
  push: "Push registration failed",
} as const

/** What the user has typed into the profile forms. */
export interface ProfileValues {
  firstName: string
  lastName: string
  currentPassword: string
  newPassword: string
  otp: string
}

/** The error under each form, or `null`. */
export interface ProfileErrors {
  profile: string | null
  password: string | null
  push: string | null
}

/** Which actions are in flight. */
export interface ProfilePending {
  profile: boolean
  password: boolean
  totp: boolean
  push: boolean
}

/** An authenticator-app enrolment under way: the QR code (an SVG document) and its secret. */
export interface TotpEnrolment {
  qrcode: string
  secret: string
}

export interface ProfileScreenProps {
  /** The signed-in user, or `null` when nobody is signed in. */
  user: { mfa: UserMFAStatus } | null
  /** The session owes its one-time code: the screen points to it instead. */
  isMfaRequired: boolean
  /** The live connection, for an app that has one. */
  connection?: ConnectionStatus
  values: ProfileValues
  onValueChange: (field: keyof ProfileValues, value: string) => void
  errors: ProfileErrors
  pending: ProfilePending
  enrolment: TotpEnrolment | null
  pushDevices: readonly UserPushTokenPublic[]
  onSaveProfile?: () => void
  onChangePassword?: () => void
  onStartTotp?: () => void
  onFinishTotp?: () => void
  onDisableTotp?: () => void
  /** Registering a push device needs the browser's push manager, so it has no native form. */
  onRegisterPush?: () => void
  onRemovePush?: (deviceId: string) => void
  navigate?: Navigate
}

/**
 * The profile page: name, password, two-factor auth and push devices. Every action but "Add
 * device" is a real form that posts to its route; with its callback the app takes the submit over.
 */
export function ProfileScreen(
  {
    user,
    isMfaRequired,
    connection,
    values,
    onValueChange,
    errors,
    pending,
    enrolment,
    pushDevices,
    onSaveProfile,
    onChangePassword,
    onStartTotp,
    onFinishTotp,
    onDisableTotp,
    onRegisterPush,
    onRemovePush,
    navigate,
  }: ProfileScreenProps,
): JSX.Element {
  if (isMfaRequired) {
    return (
      <Card class="mx-auto max-w-xl">
        <CardHeader>
          <h1 class="text-lg font-semibold">Finish MFA</h1>
        </CardHeader>
        <CardBody>
          <Stack>
            <p>Verify OTP to access profile.</p>
            <ScreenLink href={SCREEN_PATHS.oneTimeCode} navigate={navigate} class="link">
              Go to OTP
            </ScreenLink>
          </Stack>
        </CardBody>
      </Card>
    )
  }

  if (!user) {
    return (
      <Card data-e2e="signin-required" class="mx-auto max-w-xl">
        <CardHeader>
          <h1 class="text-lg font-semibold">Sign in required</h1>
        </CardHeader>
        <CardBody>
          <Stack>
            <p>Access your profile after sign in.</p>
            <div class="flex flex-col gap-3 sm:flex-row">
              <ScreenLink
                href={SCREEN_PATHS.signIn}
                navigate={navigate}
                class={buttonClasses("primary", "md", "text-center")}
              >
                Sign in
              </ScreenLink>
              <ScreenLink
                href={SCREEN_PATHS.signUp}
                navigate={navigate}
                class={buttonClasses("outline", "md", "text-center")}
              >
                Sign up
              </ScreenLink>
            </div>
          </Stack>
        </CardBody>
      </Card>
    )
  }

  const step = twoFactorStep(user.mfa, enrolment !== null)
  const qrSrc = enrolment?.qrcode ? svgToDataUrl(enrolment.qrcode) : null

  return (
    <Stack gap="lg">
      <Card>
        <CardHeader>
          <h1 class="text-lg font-semibold">Profile</h1>
          {connection && (
            <span data-e2e="ws-status" class="text-xs text-muted">WS: {connection}</span>
          )}
        </CardHeader>
        <CardBody>
          <form method="post" action={FORM_ACTIONS.profile} onSubmit={takeOver(onSaveProfile)}>
            <Stack>
              <Field id="profile-first-name" label="First name" required>
                <Input
                  data-e2e="profile-first-name"
                  name="firstName"
                  autocomplete="given-name"
                  value={values.firstName}
                  onInput={(e) => onValueChange("firstName", e.currentTarget.value)}
                  required
                />
              </Field>
              <Field id="profile-last-name" label="Last name" required>
                <Input
                  data-e2e="profile-last-name"
                  name="lastName"
                  autocomplete="family-name"
                  value={values.lastName}
                  onInput={(e) => onValueChange("lastName", e.currentTarget.value)}
                  required
                />
              </Field>
              <ErrorState message={errors.profile} />
              <div>
                <Button
                  type="submit"
                  data-e2e="profile-save"
                  busy={pending.profile}
                  busyLabel="Saving..."
                >
                  Save
                </Button>
              </div>
            </Stack>
          </form>
        </CardBody>
      </Card>

      <Grid gap="lg" minColumnWidth="lg">
        <Card>
          <CardHeader title="Change password" headingLevel={2} />
          <CardBody>
            <form
              method="post"
              action={FORM_ACTIONS.password}
              onSubmit={takeOver(onChangePassword)}
            >
              <Stack>
                <Field id="password-current" label="Current password" required>
                  <Input
                    data-e2e="password-current"
                    name="password"
                    type="password"
                    autocomplete="current-password"
                    value={values.currentPassword}
                    onInput={(e) => onValueChange("currentPassword", e.currentTarget.value)}
                    required
                  />
                </Field>
                <Field id="password-new" label="New password" required>
                  <Input
                    data-e2e="password-new"
                    name="newPassword"
                    type="password"
                    autocomplete="new-password"
                    value={values.newPassword}
                    onInput={(e) => onValueChange("newPassword", e.currentTarget.value)}
                    required
                  />
                </Field>
                <ErrorState message={errors.password} />
                <div>
                  <Button
                    type="submit"
                    variant="secondary"
                    data-e2e="password-save"
                    busy={pending.password}
                    busyLabel="Updating..."
                  >
                    Update password
                  </Button>
                </div>
              </Stack>
            </form>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Two-factor auth" headingLevel={2} />
          <CardBody>
            <Stack>
              <p class="text-sm">Use an authenticator app.</p>
              {step === TwoFactorStep.Enable
                ? (
                  <form
                    method="post"
                    action={FORM_ACTIONS.totpStart}
                    onSubmit={takeOver(onStartTotp)}
                  >
                    <Button
                      type="submit"
                      variant="outline"
                      data-e2e="totp-start"
                      busy={pending.totp}
                      busyLabel="Preparing..."
                    >
                      Enable 2FA
                    </Button>
                  </form>
                )
                : null}
              {step === TwoFactorStep.Confirm
                ? (
                  <form
                    method="post"
                    action={FORM_ACTIONS.totpFinish}
                    onSubmit={takeOver(onFinishTotp)}
                  >
                    <Stack>
                      {qrSrc
                        ? (
                          <div class="max-w-full overflow-auto rounded-primary border border-control bg-white p-4">
                            <img src={qrSrc} alt="TOTP QR code" class="mx-auto" />
                          </div>
                        )
                        : null}
                      <div class="text-xs text-muted">Secret: {enrolment?.secret}</div>
                      <Field id="totp-connect-otp" label="Code from your app" required>
                        <Input
                          data-e2e="totp-connect-otp"
                          name="otp"
                          inputMode="numeric"
                          autocomplete="one-time-code"
                          placeholder="Enter 6-digit code"
                          value={values.otp}
                          onInput={(e) => onValueChange("otp", e.currentTarget.value)}
                        />
                      </Field>
                      <div>
                        <Button
                          type="submit"
                          data-e2e="totp-connect-finish"
                          busy={pending.totp}
                          busyLabel="Enabling..."
                        >
                          Finish enable
                        </Button>
                      </div>
                    </Stack>
                  </form>
                )
                : null}
              {step === TwoFactorStep.Disable
                ? (
                  <form
                    method="post"
                    action={FORM_ACTIONS.totpDisable}
                    onSubmit={takeOver(onDisableTotp)}
                  >
                    <Button
                      type="submit"
                      variant="danger"
                      data-e2e="totp-disable"
                      disabled={pending.totp}
                    >
                      Disable 2FA
                    </Button>
                  </form>
                )
                : null}
            </Stack>
          </CardBody>
        </Card>
      </Grid>

      <Card>
        <CardHeader
          title="Push devices"
          headingLevel={2}
          action={
            <Button
              data-e2e="push-register"
              onClick={onRegisterPush}
              busy={pending.push}
              busyLabel="Working..."
            >
              Add device
            </Button>
          }
        />
        <CardBody>
          <Stack>
            <ErrorState message={errors.push} />
            {pushDevices.length === 0 ? <EmptyState title="No devices registered." /> : (
              pushDevices.map((device) => (
                <div
                  key={device.id}
                  class="flex flex-col gap-2 rounded-primary border border-subtle px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                  data-e2e={`push-device-${device.deviceId}`}
                >
                  <div>
                    <div class="font-medium">Device {device.deviceId.slice(0, 8)}</div>
                    <div class="text-xs text-muted">
                      {new Date(device.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <form
                    class="flex flex-col sm:block"
                    method="post"
                    action={FORM_ACTIONS.pushRemove}
                    onSubmit={takeOver(onRemovePush && (() => onRemovePush(device.deviceId)))}
                  >
                    <input type="hidden" name="deviceId" value={device.deviceId} />
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      data-e2e={`push-remove-${device.deviceId}`}
                      disabled={pending.push}
                    >
                      Remove
                    </Button>
                  </form>
                </div>
              ))
            )}
          </Stack>
        </CardBody>
      </Card>
    </Stack>
  )
}

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${encodeBase64(new TextEncoder().encode(svg))}`
}
