import { Component, type ComponentChildren } from "preact"
import { reportCaughtError } from "./error-reporting.ts"

/**
 * Catches an error thrown while a view renders, reports it and shows a message with a reload
 * button, so the person sees a page instead of a blank screen.
 */
export class ErrorBoundary extends Component<{ children: ComponentChildren }, { failed: boolean }> {
  override state = { failed: false }

  override componentDidCatch(error: unknown) {
    reportCaughtError(error)
    this.setState({ failed: true })
  }

  override render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" class="mx-auto max-w-md p-6 text-center">
        <p class="mb-4">Something went wrong. Reloading the page usually fixes it.</p>
        <button type="button" class="underline" onClick={() => location.reload()}>
          Reload the page
        </button>
      </div>
    )
  }
}
