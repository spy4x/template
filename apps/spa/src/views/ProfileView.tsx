import { useEffect, useMemo, useState } from "preact/hooks"
import { Link } from "wouter-preact"
import { decodeBase64Url, encodeBase64 } from "@std/encoding"
import { Button, buttonClasses } from "@spy4x/preact-ui/button"
import { Card, CardBody, CardHeader } from "@spy4x/preact-ui/card"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Grid, Stack } from "@spy4x/preact-ui/layout"
import {
  changePassword,
  profileUpdate,
  totpConnectFinish,
  totpConnectStart,
  totpDisconnect,
} from "../state/auth.ts"
import { sessionState } from "../state/session.ts"
import { apiFetch } from "../state/api.ts"
import { toasts } from "../state/toasts.ts"
import type { PushSubscribeRequest, PushUnsubscribeRequest } from "@spy4x/platform/model"
import type {
  ApiIsSuccessResponse,
  PushDevicesResponse,
  PushPublicKeyResponse,
  PushSubscribeResponse,
  UserPushTokenPublic,
} from "@domain/identity"
export function ProfileView() {
  const session = sessionState.value
  const [firstName, setFirstName] = useState(session.user?.firstName || "")
  const [lastName, setLastName] = useState(session.user?.lastName || "")
  const [profileError, setProfileError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [busyProfile, setBusyProfile] = useState(false)
  const [busyPassword, setBusyPassword] = useState(false)
  const [totpBusy, setTotpBusy] = useState(false)
  const [totpQr, setTotpQr] = useState<string | null>(null)
  const [totpSecret, setTotpSecret] = useState<string | null>(null)
  const [totpOtp, setTotpOtp] = useState("")
  const totpQrSrc = useMemo(() => (totpQr ? svgToDataUrl(totpQr) : null), [totpQr])
  const [pushDevices, setPushDevices] = useState<UserPushTokenPublic[]>([])
  const [pushPublicKey, setPushPublicKey] = useState<string | null>(null)
  const [pushError, setPushError] = useState<string | null>(null)
  const [pushBusy, setPushBusy] = useState(false)
  useEffect(() => {
    setFirstName(session.user?.firstName || "")
    setLastName(session.user?.lastName || "")
  }, [session.user?.firstName, session.user?.lastName])

  useEffect(() => {
    if (!session.user || session.isMfaRequired) return
    apiFetch<PushDevicesResponse>("/api/push/devices").then((res) => {
      if (res.ok) setPushDevices(res.data.data)
    })
    apiFetch<PushPublicKeyResponse>("/api/push/public-key").then((res) => {
      if (res.ok) setPushPublicKey(res.data.publicKey)
    })
  }, [session.user?.id, session.isMfaRequired])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as UserPushTokenPublic[]
      if (Array.isArray(detail)) {
        setPushDevices(detail)
      }
    }
    globalThis.addEventListener("push.devices.updated", handler)
    return () => globalThis.removeEventListener("push.devices.updated", handler)
  }, [])

  if (!session.user) {
    return (
      <Card data-e2e="signin-required" class="mx-auto max-w-xl">
        <CardHeader>
          <h1 class="text-lg font-semibold">Sign in required</h1>
        </CardHeader>
        <CardBody>
          <Stack>
            <p>Access your profile after sign in.</p>
            <div class="flex flex-col gap-3 sm:flex-row">
              <Link href="/sign-in" class={buttonClasses("primary", "md", "text-center")}>
                Sign in
              </Link>
              <Link href="/sign-up" class={buttonClasses("outline", "md", "text-center")}>
                Sign up
              </Link>
            </div>
          </Stack>
        </CardBody>
      </Card>
    )
  }

  if (session.isMfaRequired) {
    return (
      <Card class="mx-auto max-w-xl">
        <CardHeader>
          <h1 class="text-lg font-semibold">Finish MFA</h1>
        </CardHeader>
        <CardBody>
          <Stack>
            <p>Verify OTP to access profile.</p>
            <Link href="/totp" class="link">Go to OTP</Link>
          </Stack>
        </CardBody>
      </Card>
    )
  }

  const submitProfile = async (event: Event) => {
    event.preventDefault()
    setProfileError(null)
    setBusyProfile(true)
    const result = await profileUpdate(firstName, lastName)
    setBusyProfile(false)
    if (!result.ok) {
      setProfileError(result.error || "Update failed")
      return
    }
    toasts.success({ title: "Saved", body: "Your profile was updated.", dataE2E: "profile-saved" })
  }

  const submitPassword = async (event: Event) => {
    event.preventDefault()
    setPasswordError(null)
    setBusyPassword(true)
    const result = await changePassword(currentPassword, newPassword)
    setBusyPassword(false)
    if (!result.ok) {
      setPasswordError(result.error || "Password change failed")
      return
    }
    setCurrentPassword("")
    setNewPassword("")
  }

  const startTotp = async () => {
    setTotpBusy(true)
    const result = await totpConnectStart()
    setTotpBusy(false)
    if (!result.ok) {
      setProfileError(result.error)
      return
    }
    setTotpQr(result.qrcode)
    setTotpSecret(result.secret)
  }

  const finishTotp = async () => {
    setTotpBusy(true)
    const result = await totpConnectFinish(totpOtp)
    setTotpBusy(false)
    if (!result.ok) {
      setProfileError(result.error || "Failed to enable 2FA")
      return
    }
    setTotpQr(null)
    setTotpSecret(null)
    setTotpOtp("")
  }

  const disableTotp = async () => {
    setTotpBusy(true)
    const result = await totpDisconnect()
    setTotpBusy(false)
    if (!result.ok) {
      setProfileError(result.error || "Failed to disable 2FA")
    }
  }

  const registerPush = async () => {
    if (!pushPublicKey) return
    setPushError(null)
    setPushBusy(true)
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeBase64Url(pushPublicKey),
      })
      const deviceId = crypto.randomUUID()
      const result = await apiFetch<PushSubscribeResponse>("/api/push", {
        method: "POST",
        body: JSON.stringify(
          {
            subscription: subscriptionToPayload(subscription),
            deviceId,
          } satisfies PushSubscribeRequest,
        ),
      })
      if (!result.ok) {
        setPushError(result.error.message)
      }
    } catch (_error) {
      setPushError("Push registration failed")
    } finally {
      setPushBusy(false)
    }
  }

  const removePush = async (deviceId: string) => {
    setPushBusy(true)
    await apiFetch<ApiIsSuccessResponse>("/api/push", {
      method: "DELETE",
      body: JSON.stringify({ deviceId } satisfies PushUnsubscribeRequest),
    })
    setPushBusy(false)
  }

  return (
    <Stack gap="lg">
      <Card>
        <CardHeader>
          <h1 class="text-lg font-semibold">Profile</h1>
          <span data-e2e="ws-status" class="text-xs text-muted">WS: {session.wsStatus}</span>
        </CardHeader>
        <CardBody>
          <form onSubmit={submitProfile}>
            <Stack>
              <Field id="profile-first-name" label="First name" required>
                <Input
                  data-e2e="profile-first-name"
                  autocomplete="given-name"
                  value={firstName}
                  onInput={(e) => setFirstName(e.currentTarget.value)}
                  required
                />
              </Field>
              <Field id="profile-last-name" label="Last name" required>
                <Input
                  data-e2e="profile-last-name"
                  autocomplete="family-name"
                  value={lastName}
                  onInput={(e) => setLastName(e.currentTarget.value)}
                  required
                />
              </Field>
              <ErrorState message={profileError} />
              <div>
                <Button
                  type="submit"
                  data-e2e="profile-save"
                  busy={busyProfile}
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
            <form onSubmit={submitPassword}>
              <Stack>
                <Field id="password-current" label="Current password" required>
                  <Input
                    data-e2e="password-current"
                    type="password"
                    autocomplete="current-password"
                    value={currentPassword}
                    onInput={(e) => setCurrentPassword(e.currentTarget.value)}
                    required
                  />
                </Field>
                <Field id="password-new" label="New password" required>
                  <Input
                    data-e2e="password-new"
                    type="password"
                    autocomplete="new-password"
                    value={newPassword}
                    onInput={(e) => setNewPassword(e.currentTarget.value)}
                    required
                  />
                </Field>
                <ErrorState message={passwordError} />
                <div>
                  <Button
                    type="submit"
                    variant="secondary"
                    data-e2e="password-save"
                    busy={busyPassword}
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
              {!totpQr
                ? (
                  <div>
                    <Button
                      variant="outline"
                      data-e2e="totp-start"
                      onClick={startTotp}
                      busy={totpBusy}
                      busyLabel="Preparing..."
                    >
                      Enable 2FA
                    </Button>
                  </div>
                )
                : (
                  <Stack>
                    {totpQrSrc
                      ? (
                        <div class="max-w-full overflow-auto rounded-primary border border-control bg-white p-4">
                          <img src={totpQrSrc} alt="TOTP QR code" class="mx-auto" />
                        </div>
                      )
                      : null}
                    <div class="text-xs text-muted">Secret: {totpSecret}</div>
                    <Field id="totp-connect-otp" label="Code from your app" required>
                      <Input
                        data-e2e="totp-connect-otp"
                        inputMode="numeric"
                        autocomplete="one-time-code"
                        placeholder="Enter 6-digit code"
                        value={totpOtp}
                        onInput={(e) => setTotpOtp(e.currentTarget.value)}
                      />
                    </Field>
                    <div>
                      <Button
                        data-e2e="totp-connect-finish"
                        onClick={finishTotp}
                        busy={totpBusy}
                        busyLabel="Enabling..."
                      >
                        Finish enable
                      </Button>
                    </div>
                  </Stack>
                )}
              <div>
                <Button
                  variant="danger"
                  data-e2e="totp-disable"
                  onClick={disableTotp}
                  disabled={totpBusy}
                >
                  Disable 2FA
                </Button>
              </div>
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
              onClick={registerPush}
              busy={pushBusy}
              busyLabel="Working..."
            >
              Add device
            </Button>
          }
        />
        <CardBody>
          <Stack>
            <ErrorState message={pushError} />
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
                  <Button
                    variant="outline"
                    size="sm"
                    data-e2e={`push-remove-${device.deviceId}`}
                    onClick={() => removePush(device.deviceId)}
                    disabled={pushBusy}
                  >
                    Remove
                  </Button>
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

function subscriptionToPayload(
  subscription: PushSubscription,
): PushSubscribeRequest["subscription"] {
  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.auth || !json.keys?.p256dh) {
    throw new Error("Invalid push subscription")
  }
  return {
    endpoint: json.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: {
      auth: json.keys.auth,
      p256dh: json.keys.p256dh,
    },
  }
}
