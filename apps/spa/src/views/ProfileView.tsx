import { useEffect, useState } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { decodeBase64Url } from "@std/encoding"
import {
  PROFILE_FAILURES,
  ProfileScreen,
  type ProfileValues,
  type TotpEnrolment,
} from "@ui/profile-screen.tsx"
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

/**
 * Wires `ProfileScreen` to this app's session store, the auth calls and the push endpoints. Holds
 * what the user types, what is in flight and what failed; the screen only draws it.
 */
export function ProfileView() {
  const [, navigate] = useLocation()
  const session = sessionState.value
  const [values, setValues] = useState<ProfileValues>({
    firstName: session.user?.firstName || "",
    lastName: session.user?.lastName || "",
    currentPassword: "",
    newPassword: "",
    otp: "",
  })
  const [profileError, setProfileError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [busyProfile, setBusyProfile] = useState(false)
  const [busyPassword, setBusyPassword] = useState(false)
  const [totpBusy, setTotpBusy] = useState(false)
  const [enrolment, setEnrolment] = useState<TotpEnrolment | null>(null)
  const [pushDevices, setPushDevices] = useState<UserPushTokenPublic[]>([])
  const [pushPublicKey, setPushPublicKey] = useState<string | null>(null)
  const [pushError, setPushError] = useState<string | null>(null)
  const [pushBusy, setPushBusy] = useState(false)

  const setValue = (field: keyof ProfileValues, value: string) =>
    setValues((current) => ({ ...current, [field]: value }))

  useEffect(() => {
    setValues((current) => ({
      ...current,
      firstName: session.user?.firstName || "",
      lastName: session.user?.lastName || "",
    }))
  }, [session.user?.firstName, session.user?.lastName])

  const loadPushDevices = async () => {
    const res = await apiFetch<PushDevicesResponse>("/api/push/devices")
    if (res.ok) setPushDevices(res.data.data)
  }

  useEffect(() => {
    if (!session.user || session.isMfaRequired) return
    void loadPushDevices()
    apiFetch<PushPublicKeyResponse>("/api/push/public-key").then((res) => {
      if (res.ok) setPushPublicKey(res.data.publicKey)
    })
  }, [session.user?.id, session.isMfaRequired])

  const submitProfile = async () => {
    setProfileError(null)
    setBusyProfile(true)
    const result = await profileUpdate(values.firstName, values.lastName)
    setBusyProfile(false)
    if (!result.ok) {
      setProfileError(result.error || PROFILE_FAILURES.profile)
      return
    }
    toasts.success({ title: "Saved", body: "Your profile was updated.", dataE2E: "profile-saved" })
  }

  const submitPassword = async () => {
    setPasswordError(null)
    setBusyPassword(true)
    const result = await changePassword(values.currentPassword, values.newPassword)
    setBusyPassword(false)
    if (!result.ok) {
      setPasswordError(result.error || PROFILE_FAILURES.password)
      return
    }
    setValues((current) => ({ ...current, currentPassword: "", newPassword: "" }))
  }

  const startTotp = async () => {
    setTotpBusy(true)
    const result = await totpConnectStart()
    setTotpBusy(false)
    if (!result.ok) {
      setProfileError(result.error)
      return
    }
    setEnrolment({ qrcode: result.qrcode, secret: result.secret })
  }

  const finishTotp = async () => {
    setTotpBusy(true)
    const result = await totpConnectFinish(values.otp)
    setTotpBusy(false)
    if (!result.ok) {
      setProfileError(result.error || PROFILE_FAILURES.totpFinish)
      return
    }
    setEnrolment(null)
    setValue("otp", "")
  }

  const disableTotp = async () => {
    setTotpBusy(true)
    const result = await totpDisconnect()
    setTotpBusy(false)
    if (!result.ok) {
      setProfileError(result.error || PROFILE_FAILURES.totpDisable)
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
      } else {
        await loadPushDevices()
      }
    } catch (_error) {
      setPushError(PROFILE_FAILURES.push)
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
    await loadPushDevices()
    setPushBusy(false)
  }

  return (
    <ProfileScreen
      user={session.user}
      isMfaRequired={session.isMfaRequired}
      connection={session.wsStatus}
      values={values}
      onValueChange={setValue}
      errors={{ profile: profileError, password: passwordError, push: pushError }}
      pending={{ profile: busyProfile, password: busyPassword, totp: totpBusy, push: pushBusy }}
      enrolment={enrolment}
      pushDevices={pushDevices}
      onSaveProfile={submitProfile}
      onChangePassword={submitPassword}
      onStartTotp={startTotp}
      onFinishTotp={finishTotp}
      onDisableTotp={disableTotp}
      onRegisterPush={registerPush}
      onRemovePush={removePush}
      navigate={navigate}
    />
  )
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
