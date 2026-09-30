import {
  type ApiSuccessResponse,
  type TotpConnectStartResponse,
  type User,
  UserMFAStatus,
} from "@domain/identity"
import { apiFetch } from "./api.ts"
import { PendingSecondFactor, sessionState, SessionUser } from "./session.ts"

/**
 * Asks the server who is signed in. When the server cannot be reached at all, `recall` may name
 * the user this browser last saw signed in, so the app opens offline; without it, or with none
 * remembered, the person is signed out.
 */
export async function bootstrapSession(
  recall?: () => SessionUser | null,
): Promise<void> {
  let me: Awaited<ReturnType<typeof apiFetch<User | PendingSecondFactor>>>
  try {
    me = await apiFetch<User | PendingSecondFactor>("/api/auth/me")
  } catch (_unreachable) {
    sessionState.value = {
      ...sessionState.value,
      isReady: true,
      user: recall?.() ?? null,
      isMfaRequired: false,
    }
    return
  }
  if (!me.ok) {
    sessionState.value = {
      ...sessionState.value,
      isReady: true,
      user: null,
      isMfaRequired: false,
    }
    return
  }
  // 202 carries no profile: the session owes its one-time code, so there is no user yet.
  const isMfaRequired = me.status === 202
  sessionState.value = {
    ...sessionState.value,
    user: isMfaRequired ? null : me.data as User,
    isMfaRequired,
    isReady: true,
  }
}

async function handleAuthResponse(
  result: Awaited<ReturnType<typeof apiFetch<SessionUser | PendingSecondFactor>>>,
): Promise<{ ok: boolean; mfaRequired: boolean; error?: string }> {
  if (!result.ok) {
    return { ok: false, mfaRequired: false, error: result.error.message }
  }
  const mfaRequired = result.status === 202
  sessionState.value = {
    ...sessionState.value,
    user: mfaRequired ? null : result.data as User,
    isMfaRequired: mfaRequired,
    isReady: true,
  }
  return { ok: true, mfaRequired }
}

export async function signIn(username: string, password: string): Promise<{
  ok: boolean
  mfaRequired: boolean
  error?: string
}> {
  const result = await apiFetch<SessionUser | PendingSecondFactor>("/api/auth/password/check", {
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
  const result = await apiFetch<SessionUser | PendingSecondFactor>("/api/auth/password/sign-up", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  })
  return handleAuthResponse(result)
}

export async function signOut(): Promise<void> {
  try {
    await apiFetch<ApiSuccessResponse>("/api/auth/sign-out", { method: "POST" })
  } catch (_unreachable) {
    // Offline: the page still signs out, so the person is not left signed in on a shared device.
    // The server's session ends on its own expiry.
  }
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
  const result = await apiFetch<{ user: User }>("/api/users/me", {
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
  setUserMfa(UserMFAStatus.CONFIGURED)
  return { ok: true }
}

export async function totpDisconnect(): Promise<{ ok: boolean; error?: string }> {
  const result = await apiFetch<ApiSuccessResponse>("/api/auth/totp/disconnect", {
    method: "POST",
  })
  if (!result.ok) {
    return { ok: false, error: result.error.message }
  }
  setUserMfa(UserMFAStatus.NOT_CONFIGURED)
  return { ok: true }
}

/** Records the signed-in user's new MFA status, so the profile page shows the right control. */
function setUserMfa(mfa: UserMFAStatus): void {
  const user = sessionState.value.user
  if (!user) return
  sessionState.value = { ...sessionState.value, user: { ...user, mfa } }
}
