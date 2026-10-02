import { signal } from "@preact/signals"
import type { ApiResult } from "@spy4x/platform/api"
import { type GroupBilling, providerPageUrl } from "@domain/billing"
import { apiFetch } from "./api.ts"

/** `apiFetch`, or a test's stand-in for it. */
export type BillingFetch = <T>(url: string, init?: RequestInit) => Promise<ApiResult<T>>

/** `GroupBilling` as JSON carries it: the date is an ISO string. */
type GroupBillingJson = Omit<GroupBilling, "currentPeriodEnd"> & { currentPeriodEnd: string | null }

const OFFLINE = "The server is out of reach. Try again."
const UNSAFE_PAGE = "The payment provider answered with an address this app does not open."

function billingPath(groupId: string, action = ""): string {
  return `/api/groups/${encodeURIComponent(groupId)}/billing${action}`
}

/**
 * One group's plan, and the two ways its owner changes it: the provider's checkout and its portal.
 * Both leave the app for the provider's page; the plan itself changes when the provider's webhook
 * arrives, and the page reads it again when the group's change sequence moves.
 *
 * `leave` opens the provider's page; tests pass a stand-in for `location.assign`.
 */
export function createBillingStore(
  fetch: BillingFetch = apiFetch,
  leave: (url: string) => void = (url) => globalThis.location.assign(url),
) {
  /** The billing of the group last read, with its id, so another group's page shows none of it. */
  const current = signal<{ groupId: string; billing: GroupBilling } | null>(null)
  /**
   * Why the last read or the last checkout or portal failed, with the group it was for. `id` is new
   * on every failure, so a screen moves focus to the message even when the text repeats.
   */
  const error = signal<{ groupId: string; message: string; id: number } | null>(null)
  let refusals = 0
  /** A checkout or portal call is in flight. */
  const pending = signal(false)

  async function load(groupId: string): Promise<void> {
    try {
      const result = await fetch<{ billing: GroupBillingJson }>(billingPath(groupId))
      if (!result.ok) {
        error.value = { groupId, message: result.error.message, id: ++refusals }
        return
      }
      const { currentPeriodEnd, ...rest } = result.data.billing
      current.value = {
        groupId,
        billing: {
          ...rest,
          currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd) : null,
        },
      }
      if (error.value?.groupId === groupId) error.value = null
    } catch (_unreachable) {
      error.value = { groupId, message: OFFLINE, id: ++refusals }
    }
  }

  async function open(groupId: string, action: string, body?: unknown): Promise<void> {
    if (pending.value) return
    pending.value = true
    error.value = null
    // Once the provider's page is opening, the buttons stay disabled until the page is left.
    let leaving = false
    try {
      const result = await fetch<{ url: string }>(billingPath(groupId, action), {
        method: "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!result.ok) {
        error.value = { groupId, message: result.error.message, id: ++refusals }
        return
      }
      const url = providerPageUrl(result.data.url)
      if (!url) {
        error.value = { groupId, message: UNSAFE_PAGE, id: ++refusals }
        return
      }
      leaving = true
      leave(url)
    } catch (_unreachable) {
      error.value = { groupId, message: OFFLINE, id: ++refusals }
    } finally {
      if (!leaving) pending.value = false
    }
  }

  /** Opens the provider's checkout for `planId`. */
  function checkout(groupId: string, planId: string): Promise<void> {
    return open(groupId, "/checkout", { planId })
  }

  /** Opens the provider's portal, where the owner changes the card or plan, or cancels. */
  function portal(groupId: string): Promise<void> {
    return open(groupId, "/portal")
  }

  function reset(): void {
    current.value = null
    error.value = null
    pending.value = false
  }

  return { current, error, pending, load, checkout, portal, reset }
}

/** The app's billing store. */
export const billingStore = createBillingStore()
