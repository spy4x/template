import { useEffect, useMemo, useState } from "preact/hooks"
import { Link } from "wouter-preact"
import {
  changePassword,
  profileUpdate,
  totpConnectFinish,
  totpConnectStart,
  totpDisconnect,
} from "../state/auth.ts"
import { sessionState } from "../state/session.ts"
import { apiFetch } from "../state/api.ts"
import type {
  ApiIsSuccessResponse,
  PushDevicesResponse,
  PushPublicKeyResponse,
  PushSubscribeRequest,
  PushSubscribeResponse,
  PushUnsubscribeRequest,
  UserPushTokenPublic,
} from "@shared/types"

export function ProfileView() {
  const session = sessionState.value
  const [displayName, setDisplayName] = useState(session.profile?.displayName || "")
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileSaved, setProfileSaved] = useState(false)
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
    setDisplayName(session.profile?.displayName || "")
  }, [session.profile?.displayName])

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
    window.addEventListener("push.devices.updated", handler)
    return () => window.removeEventListener("push.devices.updated", handler)
  }, [])

  if (!session.user) {
    return (
      <div
        data-e2e="signin-required"
        class="mx-auto max-w-xl rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:p-8"
      >
        <h2 class="text-xl font-semibold">Sign in required</h2>
        <p class="mt-2 text-slate-300">Access your profile after sign in.</p>
        <div class="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link href="/sign-in" class="w-full rounded-lg bg-indigo-500 px-4 py-3 text-center text-sm text-white sm:w-auto">
            Sign in
          </Link>
          <Link
            href="/sign-up"
            class="w-full rounded-lg border border-slate-700 px-4 py-3 text-center text-sm text-slate-200 sm:w-auto"
          >
            Sign up
          </Link>
        </div>
      </div>
    )
  }

  if (session.isMfaRequired) {
    return (
      <div class="mx-auto max-w-xl rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:p-8">
        <h2 class="text-xl font-semibold">Finish MFA</h2>
        <p class="mt-2 text-slate-300">Verify OTP to access profile.</p>
        <div class="mt-6">
          <Link href="/totp" class="text-indigo-400 hover:text-indigo-300">Go to OTP</Link>
        </div>
      </div>
    )
  }

  const submitProfile = async (event: Event) => {
    event.preventDefault()
    setProfileError(null)
    setProfileSaved(false)
    setBusyProfile(true)
    const result = await profileUpdate(displayName)
    setBusyProfile(false)
    if (!result.ok) {
      setProfileError(result.error || "Update failed")
      return
    }
    setProfileSaved(true)
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
        applicationServerKey: urlBase64ToUint8Array(pushPublicKey) as unknown as BufferSource,
      })
      const deviceId = crypto.randomUUID()
      const result = await apiFetch<PushSubscribeResponse>("/api/push", {
        method: "POST",
        body: JSON.stringify({
          subscription: subscriptionToPayload(subscription),
          deviceId,
        } satisfies PushSubscribeRequest),
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
    <div class="space-y-6">
      <section class="rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:p-8">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 class="text-xl font-semibold">Profile</h2>
          <span data-e2e="ws-status" class="text-xs text-slate-400">WS: {session.wsStatus}</span>
        </div>
        <form class="mt-6 space-y-4" onSubmit={submitProfile}>
          <label class="block text-sm">
            <span class="text-slate-300">Display name</span>
            <input
              data-e2e="profile-display-name"
              class="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-base text-slate-100"
              value={displayName}
              onInput={(e) => setDisplayName((e.target as HTMLInputElement).value)}
              required
            />
          </label>
          {profileError
            ? (
              <div class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {profileError}
              </div>
            )
            : null}
          {profileSaved
            ? (
              <div
                data-e2e="profile-saved"
                class="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200"
              >
                Saved
              </div>
            )
            : null}
          <button
            data-e2e="profile-save"
            class="w-full rounded-lg bg-indigo-500 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-60 sm:w-auto"
            disabled={busyProfile}
          >
            {busyProfile ? "Saving..." : "Save"}
          </button>
        </form>
      </section>

      <section class="grid gap-6 lg:grid-cols-2">
        <div class="rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:p-8">
          <h3 class="text-lg font-semibold">Change password</h3>
          <form class="mt-6 space-y-4" onSubmit={submitPassword}>
            <label class="block text-sm">
              <span class="text-slate-300">Current password</span>
              <input
                data-e2e="password-current"
                type="password"
                class="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-base text-slate-100"
                value={currentPassword}
                onInput={(e) => setCurrentPassword((e.target as HTMLInputElement).value)}
                required
              />
            </label>
            <label class="block text-sm">
              <span class="text-slate-300">New password</span>
              <input
                data-e2e="password-new"
                type="password"
                class="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-base text-slate-100"
                value={newPassword}
                onInput={(e) => setNewPassword((e.target as HTMLInputElement).value)}
                required
              />
            </label>
            {passwordError
              ? (
                <div class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                  {passwordError}
                </div>
              )
              : null}
            <button
              data-e2e="password-save"
              class="w-full rounded-lg bg-slate-200 px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-white disabled:opacity-60 sm:w-auto"
              disabled={busyPassword}
            >
              {busyPassword ? "Updating..." : "Update password"}
            </button>
          </form>
        </div>
        <div class="rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:p-8">
          <h3 class="text-lg font-semibold">Two-factor auth</h3>
          <p class="mt-2 text-sm text-slate-300">
            Use an authenticator app.
          </p>
          <div class="mt-4 space-y-4">
            {!totpQr
              ? (
                <button
                  data-e2e="totp-start"
                  class="w-full rounded-lg border border-slate-700 px-4 py-3 text-sm text-slate-100 hover:border-slate-500 disabled:opacity-60 sm:w-auto"
                  onClick={startTotp}
                  disabled={totpBusy}
                >
                  {totpBusy ? "Preparing..." : "Enable 2FA"}
                </button>
              )
              : (
                <div class="space-y-4">
                  {totpQrSrc
                    ? (
                      <div class="max-w-full overflow-auto rounded-lg border border-slate-700 bg-white p-4">
                        <img src={totpQrSrc} alt="TOTP QR code" class="mx-auto" />
                      </div>
                    )
                    : null}
                  <div class="text-xs text-slate-400">Secret: {totpSecret}</div>
                  <input
                    data-e2e="totp-connect-otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-base text-slate-100"
                    placeholder="Enter 6-digit code"
                    value={totpOtp}
                    onInput={(e) => setTotpOtp((e.target as HTMLInputElement).value)}
                  />
                  <button
                    data-e2e="totp-connect-finish"
                    class="w-full rounded-lg bg-indigo-500 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-60 sm:w-auto"
                    onClick={finishTotp}
                    disabled={totpBusy}
                  >
                    {totpBusy ? "Enabling..." : "Finish enable"}
                  </button>
                </div>
              )}
            <button
              data-e2e="totp-disable"
              class="w-full rounded-lg border border-rose-500/50 px-4 py-3 text-sm text-rose-200 hover:border-rose-400 disabled:opacity-60 sm:w-auto"
              onClick={disableTotp}
              disabled={totpBusy}
            >
              Disable 2FA
            </button>
          </div>
        </div>
      </section>

      <section class="rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:p-8">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 class="text-lg font-semibold">Push devices</h3>
          <button
            data-e2e="push-register"
            class="w-full rounded-lg bg-indigo-500 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-60 sm:w-auto"
            onClick={registerPush}
            disabled={pushBusy}
          >
            {pushBusy ? "Working..." : "Add device"}
          </button>
        </div>
        {pushError
          ? (
            <div class="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {pushError}
            </div>
          )
          : null}
        <div class="mt-4 space-y-3">
          {pushDevices.length === 0
            ? (
              <div class="text-sm text-slate-400">No devices registered.</div>
            )
            : (
              pushDevices.map((device) => (
                <div
                  key={device.id}
                  class="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                  data-e2e={`push-device-${device.deviceId}`}
                >
                  <div class="text-slate-300">
                    <div class="font-medium">Device {device.deviceId.slice(0, 8)}</div>
                    <div class="text-xs text-slate-500">{new Date(device.createdAt).toLocaleString()}</div>
                  </div>
                  <button
                    data-e2e={`push-remove-${device.deviceId}`}
                    class="text-xs text-rose-300 hover:text-rose-200"
                    onClick={() => removePush(device.deviceId)}
                    disabled={pushBusy}
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
        </div>
      </section>
    </div>
  )
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = window.atob(base64)
  const output = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i += 1) {
    output[i] = rawData.charCodeAt(i)
  }
  return output
}

function svgToDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg)
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`
}

function subscriptionToPayload(subscription: PushSubscription): PushSubscribeRequest["subscription"] {
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
