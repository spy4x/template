import type {
  ApiSuccessResponse,
  ProfileResponse,
  TotpConnectStartResponse,
  User,
} from "@shared/types"
import { apiFetch } from "./api.ts"
import { sessionState, SessionUser } from "./session.ts"

async function fetchAndUpdateProfile(): Promise<void> {
  const profile = await apiFetch<ProfileResponse>("/api/users/me")
  if (profile.ok) {
    sessionState.value = {
      ...sessionState.value,
      user: profile.data.user,
    }
  }
}

export async function bootstrapSession(): Promise<void> {
  const me = await apiFetch<User>("/api/auth/me")
  if (!me.ok) {
    sessionState.value = {
      ...sessionState.value,
      isReady: true,
      user: null,
      isMfaRequired: false,
    }
    return
  }
  sessionState.value = {
    ...sessionState.value,
    user: me.data,
    isReady: true,
  }
  await fetchAndUpdateProfile()
}

async function handleAuthResponse(
  result: Awaited<ReturnType<typeof apiFetch<SessionUser>>>,
): Promise<{ ok: boolean; mfaRequired: boolean; error?: string }> {
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
    await fetchAndUpdateProfile()
  }
  return { ok: true, mfaRequired }
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
  return handleAuthResponse(result)
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
  return handleAuthResponse(result)
}

export async function signOut(): Promise<void> {
  await apiFetch<ApiSuccessResponse>("/api/auth/sign-out", { method: "POST" })
  sessionState.value = {
    ...sessionState.value,
    user: null,
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
  await fetchAndUpdateProfile()
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

export async function profileUpdate(
  firstName: string,
  lastName: string,
): Promise<{ ok: boolean; error?: string }> {
  const result = await apiFetch<ProfileResponse>("/api/users/me", {
    method: "PATCH",
    body: JSON.stringify({ firstName, lastName }),
  })
  if (!result.ok) {
    return { ok: false, error: result.error.message }
  }
  sessionState.value = {
    ...sessionState.value,
    user: result.data.user,
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
