import type {
  ApiSuccessResponse,
  ProfileResponse,
  TotpConnectStartResponse,
  User,
} from "@shared/types"
import { apiFetch } from "./api.ts"
import { sessionState, SessionUser } from "./session.ts"

export async function bootstrapSession(): Promise<void> {
  const me = await apiFetch<User>("/api/auth/me")
  if (!me.ok) {
    sessionState.value = {
      ...sessionState.value,
      isReady: true,
      user: null,
      profile: null,
      isMfaRequired: false,
    }
    return
  }
  sessionState.value = {
    ...sessionState.value,
    user: me.data,
    isReady: true,
  }
  const profile = await apiFetch<ProfileResponse>("/api/profile")
  if (profile.ok) {
    sessionState.value = {
      ...sessionState.value,
      user: profile.data.user,
      profile: profile.data.profile,
    }
  }
}

export async function signIn(username: string, password: string): Promise<{
  ok: boolean
  mfaRequired: boolean
  error?: string
}> {
  const result = await apiFetch<SessionUser>("/api/auth/password/check", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  })
  if (!result.ok) {
    return { ok: false, mfaRequired: false, error: result.error.message }
  }
  const mfaRequired = result.status === 202
  sessionState.value = {
    ...sessionState.value,
    user: result.data,
    isMfaRequired: mfaRequired,
    isReady: true,
  }
  if (!mfaRequired) {
    const profile = await apiFetch<ProfileResponse>("/api/profile")
    if (profile.ok) {
      sessionState.value = {
        ...sessionState.value,
        user: profile.data.user,
        profile: profile.data.profile,
      }
    }
  }
  return { ok: true, mfaRequired }
}

export async function signUp(username: string, password: string): Promise<{
  ok: boolean
  mfaRequired: boolean
  error?: string
}> {
  const result = await apiFetch<SessionUser>("/api/auth/password/sign-up", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  })
  if (!result.ok) {
    return { ok: false, mfaRequired: false, error: result.error.message }
  }
  const mfaRequired = result.status === 202
  sessionState.value = {
    ...sessionState.value,
    user: result.data,
    isMfaRequired: mfaRequired,
    isReady: true,
  }
  if (!mfaRequired) {
    const profile = await apiFetch<ProfileResponse>("/api/profile")
    if (profile.ok) {
      sessionState.value = {
        ...sessionState.value,
        user: profile.data.user,
        profile: profile.data.profile,
      }
    }
  }
  return { ok: true, mfaRequired }
}

export async function signOut(): Promise<void> {
  await apiFetch<ApiSuccessResponse>("/api/auth/sign-out", { method: "POST" })
  sessionState.value = {
    ...sessionState.value,
    user: null,
    profile: null,
    isMfaRequired: false,
  }
}

export async function checkTotp(otp: string): Promise<{ ok: boolean; error?: string }> {
  const result = await apiFetch<SessionUser>("/api/auth/totp/check", {
    method: "POST",
    body: JSON.stringify({ otp }),
  })
  if (!result.ok) {
    return { ok: false, error: result.error.message }
  }
  sessionState.value = {
    ...sessionState.value,
    user: result.data,
    isMfaRequired: false,
  }
  const profile = await apiFetch<ProfileResponse>("/api/profile")
  if (profile.ok) {
    sessionState.value = {
      ...sessionState.value,
      user: profile.data.user,
      profile: profile.data.profile,
    }
  }
  return { ok: true }
}

export async function changePassword(
  password: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  const result = await apiFetch<ApiSuccessResponse>("/api/auth/password/change", {
    method: "POST",
    body: JSON.stringify({ password, newPassword }),
  })
  if (!result.ok) {
    return { ok: false, error: result.error.message }
  }
  return { ok: true }
}

export async function profileUpdate(displayName: string): Promise<{ ok: boolean; error?: string }> {
  const result = await apiFetch<ProfileResponse>("/api/profile", {
    method: "PATCH",
    body: JSON.stringify({ displayName }),
  })
  if (!result.ok) {
    return { ok: false, error: result.error.message }
  }
  sessionState.value = {
    ...sessionState.value,
    user: result.data.user,
    profile: result.data.profile,
  }
  return { ok: true }
}

export async function totpConnectStart(): Promise<
  | { ok: true; qrcode: string; secret: string }
  | { ok: false; error: string }
> {
  const result = await apiFetch<TotpConnectStartResponse>(
    "/api/auth/totp/connect/start",
    { method: "POST" },
  )
  if (!result.ok) {
    return { ok: false, error: result.error.message }
  }
  return { ok: true, qrcode: result.data.qrcode, secret: result.data.secret }
}

export async function totpConnectFinish(otp: string): Promise<{ ok: boolean; error?: string }> {
  const result = await apiFetch<ApiSuccessResponse>("/api/auth/totp/connect/finish", {
    method: "POST",
    body: JSON.stringify({ otp }),
  })
  if (!result.ok) {
    return { ok: false, error: result.error.message }
  }
  return { ok: true }
}

export async function totpDisconnect(): Promise<{ ok: boolean; error?: string }> {
  const result = await apiFetch<ApiSuccessResponse>("/api/auth/totp/disconnect", {
    method: "POST",
  })
  if (!result.ok) {
    return { ok: false, error: result.error.message }
  }
  return { ok: true }
}
