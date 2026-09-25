/**
 * Browser entry for `e2e/url-filters.e2e.ts`: one list-like screen whose two filters live in the
 * query string through `useUrlFilters`.
 *
 * The import below is the only line that changes when the local hook is replaced by
 * `@preact-components/signals/use-url-filters` (https://github.com/spy4x/template/issues/41).
 */
import { useSignal } from "@preact/signals"
import { render } from "preact"
import { useUrlFilters } from "@client/preact/use-url-filters.ts"

function FilteredList() {
  const status = useSignal("")
  const page = useSignal(1)
  useUrlFilters({
    status: { signal: status, urlParam: "status", initialValue: "" },
    page: { signal: page, urlParam: "page", initialValue: 1 },
  })

  return (
    <main>
      <p>
        Status: <output data-e2e="filter-status">{status.value || "all"}</output>
      </p>
      <p>
        Page: <output data-e2e="filter-page">{page.value}</output>
      </p>
      <button type="button" data-e2e="status-open" onClick={() => (status.value = "open")}>
        Open only
      </button>
      <button type="button" data-e2e="page-next" onClick={() => page.value++}>
        Next page
      </button>
    </main>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("url-filters fixture: #root is missing")
render(<FilteredList />, root)
