import { type PlanRefusal, readPlanRefusal } from "@domain/billing"
/**
 * The browser's request headers the API needs: the session cookie, the two headers the API's
 * cross-site guard checks, and what its audit log and rate limits record. All pass on unchanged,
 * except an `Origin` equal to the MPA's own when the MPA has its own domain (see `createApi`). The
 * MPA never adds `Origin` or `Sec-Fetch-Site` itself, so it cannot vouch for a post the browser
 * did not make.
 */
const FORWARDED_HEADERS = [
  "cookie",
  "origin",
  "sec-fetch-site",
  "user-agent",
  "x-forwarded-for",
  "x-real-ip",
] as const

/** An API answer: its status and its parsed JSON body (`null` when it has none). */
export interface ApiAnswer {
  status: number
  body: unknown
  /** The API's `Retry-After`, sent with a 429, for the page to pass on. */
  retryAfter?: string
}

/** Calls the API on behalf of one browser request. */
export interface Api {
  call(method: string, path: `/api/${string}`, json?: unknown): Promise<ApiAnswer>
}

/**
 * An API client bound to one browser request. Each call carries the request's
 * {@link FORWARDED_HEADERS}, and every `Set-Cookie` the API answers with lands in `setCookies`, for
 * the page's response to hand to the browser as the API wrote it.
 *
 * `remoteAddress` fills `X-Real-IP` when no proxy in front of the MPA set it, so the API's rate
 * limits count the browser, not the MPA.
 *
 * `origins` is set when the MPA has its own domain (`MPA_DOMAIN`). The API accepts posts only from
 * its own origin, so a browser `Origin` equal to `origins.page` reaches the API as `origins.api`.
 * That is safe because `pageMiddleware` has already refused every post whose `Origin` is not the
 * MPA's own; any other value, `null` included, passes on unchanged for the API to judge.
 */
export function createApi(
  { apiUrl, request, remoteAddress, setCookies, origins, fetch = globalThis.fetch }: {
    apiUrl: string
    request: Request
    origins?: { page: string; api: string }
    remoteAddress: string
    setCookies: string[]
    fetch?: typeof globalThis.fetch
  },
): Api {
  return {
    async call(method, path, json) {
      const headers = new Headers()
      for (const name of FORWARDED_HEADERS) {
        const value = request.headers.get(name)
        if (value !== null) headers.set(name, value)
      }
      if (origins && headers.get("origin") === origins.page) headers.set("origin", origins.api)
      if (!headers.has("x-real-ip") && remoteAddress) headers.set("x-real-ip", remoteAddress)
      if (json !== undefined) headers.set("content-type", "application/json")
      const response = await fetch(new URL(path, apiUrl), {
        method,
        headers,
        body: json === undefined ? undefined : JSON.stringify(json),
        redirect: "manual",
      })
      setCookies.push(...response.headers.getSetCookie())
      const text = await response.text()
      let body: unknown = null
      try {
        body = text ? JSON.parse(text) : null
      } catch {
        body = null
      }
      const retryAfter = response.headers.get("retry-after")
      return retryAfter === null
        ? { status: response.status, body }
        : { status: response.status, body, retryAfter }
    },
  }
}

/** Whether the answer is a success. */
export function isOk(answer: ApiAnswer): boolean {
  return answer.status >= 200 && answer.status < 300
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * The message of an API error, from either shape the API answers with: `{ error: "…" }` from the
 * auth routes, `{ error: { code, message } }` from the group and note routes.
 */
export function errorMessage(answer: ApiAnswer, fallback: string): string {
  if (!isRecord(answer.body)) return fallback
  const { error } = answer.body
  if (typeof error === "string") return error
  if (isRecord(error) && typeof error.message === "string") return error.message
  return fallback
}

/** What the group's plan refused, from the `error` of a 402 answer, or `null`. */
export function planRefusalOf(answer: ApiAnswer): PlanRefusal | null {
  return isRecord(answer.body) ? readPlanRefusal(answer.body.error) : null
}

/** The code of a group or note error, such as `VERSION_CONFLICT`. */
export function errorCode(answer: ApiAnswer): string | undefined {
  if (!isRecord(answer.body) || !isRecord(answer.body.error)) return undefined
  const { code } = answer.body.error
  return typeof code === "string" ? code : undefined
}
