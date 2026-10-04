import { signal } from "@preact/signals"
import {
  API_TOKEN_DEFAULT_EXPIRY_DAYS,
  type ApiToken,
  ApiTokenAccess,
  type ApiTokenCreateRequest,
  type ApiTokenCreateResponse,
  ApiTokenError,
  type ApiTokenListResponse,
  parseApiTokenCreateRequest,
} from "@domain/api-tokens"
import type { ApiTokenFormValues } from "@ui/api-tokens.tsx"
import { apiFetch } from "./api.ts"

/** The message shown when a token call failed without a message of its own. */
export const API_TOKENS_FAILURE = "Something went wrong with your API tokens"

/** One call's outcome: the data, or the message to show. */
export type ApiTokensResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** What the store calls. Injected so tests need no network. */
export interface ApiTokensDependencies {
  list(): Promise<ApiTokensResult<ApiTokenListResponse>>
  create(request: ApiTokenCreateRequest): Promise<ApiTokensResult<ApiTokenCreateResponse>>
  revoke(tokenId: string): Promise<ApiTokensResult<unknown>>
}

/** The calls to `/api/tokens`, the session's own routes. */
export const apiTokensHttp: ApiTokensDependencies = {
  list: () => call(apiFetch<ApiTokenListResponse>("/api/tokens", {})),
  create: (request) =>
    call(
      apiFetch<ApiTokenCreateResponse>("/api/tokens", {
        method: "POST",
        body: JSON.stringify(request),
      }),
    ),
  revoke: (tokenId) =>
    call(apiFetch(`/api/tokens/${encodeURIComponent(tokenId)}`, { method: "DELETE" })),
}

async function call<T>(
  request: ReturnType<typeof apiFetch<T>>,
): Promise<ApiTokensResult<T>> {
  const result = await request
  return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error.message }
}

/** The create form as it opens: the first group, read only, the default lifetime. */
export function emptyApiTokenForm(groupId: string): ApiTokenFormValues {
  return {
    name: "",
    groupId,
    access: ApiTokenAccess.READ,
    expiresInDays: API_TOKEN_DEFAULT_EXPIRY_DAYS,
  }
}

/**
 * The person's API tokens on the profile page: the list, the create form, what is in flight and
 * what failed. The secret of a new token lives in `created` until the person closes it, and
 * nowhere else.
 */
export function createApiTokensStore(dependencies: ApiTokensDependencies) {
  const tokens = signal<readonly ApiToken[] | null>(null)
  const values = signal<ApiTokenFormValues>(emptyApiTokenForm(""))
  const errors = signal<{ list: string | null; name: string | null; form: string | null }>({
    list: null,
    name: null,
    form: null,
  })
  const pending = signal({ create: false, revoke: false })
  const created = signal<ApiTokenCreateResponse | null>(null)

  /** Reads the list again; a failure shows above the list and keeps the old one. */
  async function load(): Promise<void> {
    const result = await dependencies.list()
    if (result.ok) {
      tokens.value = result.data.tokens
      errors.value = { ...errors.value, list: null }
    } else errors.value = { ...errors.value, list: result.error || API_TOKENS_FAILURE }
  }

  return {
    tokens,
    values,
    errors,
    pending,
    created,
    load,

    /** Opens the form empty, for `groupId` first. */
    startCreate(groupId: string): void {
      values.value = emptyApiTokenForm(groupId)
      errors.value = { ...errors.value, name: null, form: null }
    },

    setValue<K extends keyof ApiTokenFormValues>(field: K, value: ApiTokenFormValues[K]): void {
      values.value = { ...values.value, [field]: value }
    },

    /**
     * Checks the form, then creates the token. A bad name stays on the page with its message and
     * sends nothing; any refusal of the API shows under the form.
     */
    async create(): Promise<void> {
      if (pending.value.create) return
      let request: ApiTokenCreateRequest
      try {
        request = parseApiTokenCreateRequest(values.value)
      } catch (error) {
        if (!(error instanceof ApiTokenError)) throw error
        errors.value = { ...errors.value, name: error.message, form: null }
        return
      }
      errors.value = { ...errors.value, name: null, form: null }
      pending.value = { ...pending.value, create: true }
      const result = await dependencies.create(request)
      pending.value = { ...pending.value, create: false }
      if (!result.ok) {
        errors.value = { ...errors.value, form: result.error || API_TOKENS_FAILURE }
        return
      }
      created.value = result.data
      tokens.value = [result.data.token, ...(tokens.value ?? [])]
    },

    /** Forgets the secret of the token just created. */
    dismissSecret(): void {
      created.value = null
    },

    /** Revokes one token, then reads the list again. `true` when the token was revoked. */
    async revoke(tokenId: string): Promise<boolean> {
      errors.value = { ...errors.value, list: null }
      pending.value = { ...pending.value, revoke: true }
      const result = await dependencies.revoke(tokenId)
      await load()
      pending.value = { ...pending.value, revoke: false }
      if (!result.ok) {
        errors.value = { ...errors.value, list: result.error || API_TOKENS_FAILURE }
      }
      return result.ok
    },
  }
}

export type ApiTokensStore = ReturnType<typeof createApiTokensStore>
