import { Component, type ComponentChildren } from "preact"
import { Button } from "@spy4x/preact-ui/button"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { reportCaughtError } from "./error-reporting.ts"

/**
 * Catches an error thrown while a view renders, reports it and shows a message with a reload
 * button, so the person sees a page instead of a blank screen.
 */
export class ErrorBoundary extends Component<{ children: ComponentChildren }, { failed: boolean }> {
  override state = { failed: false }

  static override getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch(error: unknown) {
    reportCaughtError(error)
  }

  override render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" data-e2e="render-error">
        <EmptyState
          title="Something went wrong."
          description="Reloading the page usually fixes it."
          action={
            <Button data-e2e="render-error-reload" onClick={() => location.reload()}>
              Reload the page
            </Button>
          }
        />
      </div>
    )
  }
}
