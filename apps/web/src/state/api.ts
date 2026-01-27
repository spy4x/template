import type { ApiError, ApiResult } from "@shared/types"

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
    ...init,
  })
  let data: unknown = null
  try {
    data = await response.json()
  } catch (_error) {
    data = null
  }
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : "Request failed"
    return { ok: false, status: response.status, error: { status: response.status, message } }
  }
  return { ok: true, status: response.status, data: data as T }
}
