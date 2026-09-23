// Moved to @spy4x/platform/api (extracted from this file, two bugs fixed there: a header-merge
// bug that dropped `content-type` when a caller passed its own headers, and a `content-type:
// application/json` default applied even to a FormData body). Neither bug is reachable from any
// call site in this app today — none passes `headers` or a non-string body — so re-exporting the
// package's version keeps behaviour identical here while picking up the fix for future callers.
export { apiFetch } from "@spy4x/platform/api"
