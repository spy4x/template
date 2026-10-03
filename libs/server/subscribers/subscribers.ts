import { createSubscriptionCrypto, type SubscriptionCrypto } from "@spy4x/server/subscribers"
import { deriveSecret, MIN_SECRET_LENGTH } from "@spy4x/platform/tokens"
import type { SubscriberList } from "@domain/subscribers"

/**
 * Signs the subscriber links of a development stack that sets no `SUBSCRIBERS_SECRET`. Public on
 * purpose and accepted only with `ENV=dev`: a development stack also serves every mail it sends at
 * `/api/test/last-mail`, so nothing a token protects is secret there. Production without the
 * variable turns the feature off instead.
 */
export const DEV_SUBSCRIBERS_SECRET = `dev-only-subscribers-secret-never-used-in-production`

/** The secrets every subscriber token is signed and checked with. */
export interface SubscribersSetup {
  /** Signs every new token, at least {@link MIN_SECRET_LENGTH} printable characters. */
  secret: string
  /** Verify-only secrets from before a rotation, oldest last. */
  previousSecrets: string[]
}

/**
 * Reads `SUBSCRIBERS_SECRET` and the comma-separated `SUBSCRIBERS_PREVIOUS_SECRETS`. Unset in
 * development → {@link DEV_SUBSCRIBERS_SECRET}; unset in production → `null`, the feature is off.
 * A secret that is set but unusable (shorter than 32 characters, not printable ASCII, or equal to
 * the cookie secret) throws, so the process stops at start-up. No error names a value.
 */
export function readSubscribersSetup(
  env: { get(name: string): string | undefined },
  mode: `dev` | `prod`,
): SubscribersSetup | null {
  const secret = env.get(`SUBSCRIBERS_SECRET`)?.trim() ?? ``
  const previousSecrets = (env.get(`SUBSCRIBERS_PREVIOUS_SECRETS`) ?? ``)
    .split(`,`)
    .map((value) => value.trim())
    .filter((value) => value !== ``)
  if (secret === ``) {
    return mode === `dev` ? { secret: DEV_SUBSCRIBERS_SECRET, previousSecrets: [] } : null
  }
  if (secret === env.get(`AUTH_COOKIE_SECRET`)?.trim()) {
    throw new Error(`SUBSCRIBERS_SECRET must differ from AUTH_COOKIE_SECRET`)
  }
  for (
    const [name, value] of [
      [`SUBSCRIBERS_SECRET`, secret],
      ...previousSecrets.map((value) => [`SUBSCRIBERS_PREVIOUS_SECRETS`, value]),
    ]
  ) {
    try {
      createSubscriptionCrypto({ secret: value })
    } catch {
      throw new Error(
        `${name} must be at least ${MIN_SECRET_LENGTH} printable characters (openssl rand -base64 48)`,
      )
    }
  }
  return { secret, previousSecrets }
}

/** Says what a process without subscriber secrets does, or `null` when it has them. */
export function subscribersOffWarning(setup: SubscribersSetup | null): string | null {
  return setup ? null : `⚠️ SUBSCRIBERS_SECRET is not set: mail subscriptions are off`
}

/**
 * The tokens and keyed hashes of one list. Each list signs with its own key, derived from the
 * configured secret with the list's name, because the library's tokens name no list: without it, a
 * confirm link for one list would also join another.
 */
export async function createListCrypto(
  setup: SubscribersSetup,
  list: SubscriberList,
): Promise<SubscriptionCrypto> {
  const label = `subscribers:list:${list}`
  return createSubscriptionCrypto({
    secret: await deriveSecret(setup.secret, label),
    previousSecrets: await Promise.all(
      setup.previousSecrets.map((previous) => deriveSecret(previous, label)),
    ),
  })
}

/** The page a confirm link opens. The token rides in the query; the page posts it back. */
export function subscriberConfirmLink(webAppUrl: string, list: string, token: string): string {
  return `${webAppUrl}/subscribe/confirm?${new URLSearchParams({ list, token })}`
}

/**
 * The unsubscribe link a mail carries, in its body and in `List-Unsubscribe`. It points at the
 * API: a mail client's one-click POST (RFC 8058) lands there directly, and a person's GET is
 * redirected to the unsubscribe page.
 */
export function subscriberUnsubscribeLink(webAppUrl: string, list: string, token: string): string {
  return `${webAppUrl}/api/subscribers/unsubscribe?${new URLSearchParams({ list, token })}`
}
