import { useEffect, useState } from "preact/hooks"
import { useLocation } from "wouter-preact"
import { decodeBase64Url } from "@std/encoding"
import {
  PROFILE_FAILURES,
  type ProfileFieldErrors,
  ProfileScreen,
  type ProfileValues,
  type TotpEnrolment,
} from "@ui/profile-screen.tsx"
import {
  changePassword,
  totpConnectFinish,
  totpConnectStart,
  totpDisconnect,
} from "../state/auth.ts"
import { sessionState } from "../state/session.ts"
import { emailStore } from "../state/email.ts"
import { apiFetch } from "../state/api.ts"
import { profileStore } from "../state/profile.ts"
import { toasts } from "../state/toasts.ts"
import type { PushSubscribeRequest } from "@spy4x/platform/model"
import { validate } from "@spy4x/validation"
import { authOTPSchema, authPasswordChangeSchema, userProfileBaseSchema } from "@domain/identity"
import type { PushPublicKeyResponse } from "@domain/identity"

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
  const [fieldErrors, setFieldErrors] = useState<ProfileFieldErrors>({})
  const [profileError, setProfileError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [totpError, setTotpError] = useState<string | null>(null)
  const [busyProfile, setBusyProfile] = useState(false)
  const [busyPassword, setBusyPassword] = useState(false)
  const [totpBusy, setTotpBusy] = useState(false)
  const [enrolment, setEnrolment] = useState<TotpEnrolment | null>(null)
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

  useEffect(() => {
    if (!session.user || session.isMfaRequired) return
    // A change made in another tab reaches this page as a hint that runs the same read.
    void profileStore.refresh().catch(() => {})
    apiFetch<PushPublicKeyResponse>("/api/push/public-key").then((res) => {
      if (res.ok) setPushPublicKey(res.data.publicKey)
    })
  }, [session.user?.id, session.isMfaRequired])

  /**
   * Checks the values with the schema the API checks them with. Each refused field gets its message
   * under it, and the call is not made; `false` means the form has something to fix.
   */
  const fieldsPass = (problems: ProfileFieldErrors | null): boolean => {
    setFieldErrors(problems ?? {})
    return problems === null
  }

  const submitProfile = async () => {
    setProfileError(null)
    const { firstName, lastName } = values
    if (!fieldsPass(refusedFields(userProfileBaseSchema, { firstName, lastName }))) return
    setBusyProfile(true)
    const result = await profileStore.saveProfile(values.firstName, values.lastName)
    setBusyProfile(false)
    if (!result.ok) {
      setProfileError(result.error || PROFILE_FAILURES.profile)
      return
    }
    toasts.success({ title: "Saved", body: "Your profile was updated.", dataE2E: "profile-saved" })
  }

  const submitPassword = async () => {
    setPasswordError(null)
    const problems = refusedFields(authPasswordChangeSchema, {
      password: values.currentPassword,
      newPassword: values.newPassword,
    })
    // The API calls the current password `password`; the form's field is `currentPassword`.
    const { password: currentPassword, ...rest } = problems ?? {}
    if (!fieldsPass(problems && { currentPassword, ...rest })) return
    setBusyPassword(true)
    const result = await changePassword(values.currentPassword, values.newPassword)
    setBusyPassword(false)
    if (!result.ok) {
      setPasswordError(result.error || PROFILE_FAILURES.password)
      return
    }
    setValues((current) => ({ ...current, currentPassword: "", newPassword: "" }))
    toasts.success({
      title: "Password changed",
      body: "Use the new password next time you sign in.",
      dataE2E: "password-saved",
    })
  }

  const startTotp = async () => {
    setTotpError(null)
    setTotpBusy(true)
    const result = await totpConnectStart()
    setTotpBusy(false)
    if (!result.ok) {
      setTotpError(result.error)
      return
    }
    setEnrolment({ qrcode: result.qrcode, secret: result.secret })
  }

  const finishTotp = async () => {
    setTotpError(null)
    if (!fieldsPass(refusedFields(authOTPSchema, { otp: values.otp }))) return
    setTotpBusy(true)
    const result = await totpConnectFinish(values.otp)
    setTotpBusy(false)
    if (!result.ok) {
      setTotpError(result.error || PROFILE_FAILURES.totpFinish)
      return
    }
    setEnrolment(null)
    setValue("otp", "")
  }

  const disableTotp = async () => {
    setTotpError(null)
    setTotpBusy(true)
    const result = await totpDisconnect()
    setTotpBusy(false)
    if (!result.ok) {
      setTotpError(result.error || PROFILE_FAILURES.totpDisable)
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
      const result = await profileStore.registerPush(
        crypto.randomUUID(),
        subscriptionToPayload(subscription),
      )
      if (!result.ok) setPushError(result.error || PROFILE_FAILURES.push)
    } catch (_error) {
      setPushError(PROFILE_FAILURES.push)
    } finally {
      setPushBusy(false)
    }
  }

  const removePush = async (deviceId: string) => {
    setPushError(null)
    setPushBusy(true)
    const result = await profileStore.removePush(deviceId)
    setPushBusy(false)
    if (!result.ok) setPushError(result.error || PROFILE_FAILURES.push)
  }

  return (
    <ProfileScreen
      user={session.user}
      isMfaRequired={session.isMfaRequired}
      email={emailStore.status.value}
      values={values}
      onValueChange={setValue}
      errors={{
        fields: fieldErrors,
        profile: profileError,
        password: passwordError,
        totp: totpError,
        push: pushError,
      }}
      pending={{ profile: busyProfile, password: busyPassword, totp: totpBusy, push: pushBusy }}
      enrolment={enrolment}
      pushDevices={profileStore.pushDevices.value}
      onSaveProfile={submitProfile}
      onCancelProfile={() => {
        setProfileError(null)
        setFieldErrors(({ firstName: _first, lastName: _last, ...rest }) => rest)
        setValues((current) => ({
          ...current,
          firstName: session.user?.firstName || "",
          lastName: session.user?.lastName || "",
        }))
      }}
      onChangePassword={submitPassword}
      onCancelPassword={() => {
        setPasswordError(null)
        setFieldErrors(({ currentPassword: _current, newPassword: _new, ...rest }) => rest)
        setValues((current) => ({ ...current, currentPassword: "", newPassword: "" }))
      }}
      onStartTotp={startTotp}
      onFinishTotp={finishTotp}
      onCancelTotp={() => {
        setEnrolment(null)
        setTotpError(null)
        setValue("otp", "")
      }}
      onDisableTotp={disableTotp}
      onRegisterPush={registerPush}
      onRemovePush={removePush}
      navigate={navigate}
    />
  )
}

/**
 * The first message of each field `schema` refuses in `value`, keyed by the field's name, or `null`
 * when the value passes.
 */
function refusedFields(
  schema: Parameters<typeof validate>[0],
  value: unknown,
): Record<string, string> | null {
  const { error } = validate(schema, value)
  if (!error) return null
  const fields: Record<string, string> = {}
  for (const [field, issues] of Object.entries(error.errors)) {
    if (issues?.[0]) fields[field] = issues[0].message
  }
  return fields
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
