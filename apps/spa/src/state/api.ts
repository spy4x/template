import { apiFetch as send } from "@spy4x/platform/api"
import { apiRead } from "./realtime-call.ts"

/**
 * Every REST request of the SPA goes through here, and nothing else in the SPA imports the
 * library's `apiFetch` (`tests/spa-reads.test.ts`). A read (`GET`) is sent by {@link apiRead}, so
 * it names the user the page was started for and an `unauthorized` answer signs the page out. A
 * write is sent as it is: the call route binds the writes that matter, and the few REST writes
 * left change the session itself.
 */
export function apiFetch<T>(path: string, init?: RequestInit): ReturnType<typeof send<T>> {
  const method = init?.method?.toUpperCase() ?? "GET"
  return method === "GET" ? apiRead<T>(path, init) : send<T>(path, init)
}
