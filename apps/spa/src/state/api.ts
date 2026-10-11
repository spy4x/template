import { apiFetch as send } from "@spy4x/platform/api"
import { apiRead, apiWrite } from "./realtime-call.ts"

/**
 * Every REST request of the SPA goes through here, and nothing else in the SPA imports the
 * library's `apiFetch` (`tests/spa-reads.test.ts`). Every request of a signed-in page names the
 * user the page was started for (ADR 003): a read (`GET`) is sent by {@link apiRead} and any other
 * method by {@link apiWrite}. The server refuses a request whose cookie is now another user's, and
 * that answer signs the page out.
 */
export function apiFetch<T>(path: string, init?: RequestInit): ReturnType<typeof send<T>> {
  const method = init?.method?.toUpperCase() ?? "GET"
  return method === "GET" ? apiRead<T>(path, init) : apiWrite<T>(path, init)
}
