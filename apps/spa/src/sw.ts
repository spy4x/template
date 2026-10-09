import { installOfflineShell, type ShellScope } from "@spy4x/platform/browser/offline-shell"
import { shellOptions } from "./sw-options.ts"

/** Set by the build (`serviceWorker()` in `vite.config.ts`) to a hash of the built files. */
declare const __BUILD_ID__: string

/** The parts of the worker scope the handlers in this file use. */
interface PushScope {
  location: { origin: string }
  registration: {
    showNotification: (
      title: string,
      options: { body: string; data: { url: string } },
    ) => Promise<void>
  }
  clients: { openWindow: (url: string) => Promise<unknown> }
  skipWaiting: () => Promise<void> | void
  // deno-lint-ignore no-explicit-any
  addEventListener(type: string, listener: (event: any) => void): void
}

const scope = self as unknown as PushScope

// Offline shell cache; the app opens with no network. Also answers `SWUpdater`'s `skipWaiting`
// message, which a visitor sends by accepting the "New version available" prompt.
installOfflineShell(self as unknown as ShellScope, shellOptions(__BUILD_ID__))

scope.addEventListener(`push`, (event) => {
  const data = event.data.json()
  event.waitUntil(
    // TODO: add "icon": path_to_static_icon to second parameter in showNotification
    scope.registration.showNotification(data.title, {
      body: data.body,
      data: { url: data.url },
    }),
  )
})

scope.addEventListener(`notificationclick`, (event) => {
  event.notification.close()
  event.waitUntil(scope.clients.openWindow(scope.location.origin + event.notification.data.url))
})
