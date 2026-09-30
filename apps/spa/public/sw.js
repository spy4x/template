// Offline shell cache; remove this line and `offline-shell.js` to build without it.
importScripts("/offline-shell.js")

// `SWUpdater` posts this when a visitor accepts the "New version available" prompt; without it
// the new worker would wait behind the open tabs and the prompt would do nothing.
self.addEventListener("message", (event) => {
  if (event.data?.action === "skipWaiting") self.skipWaiting()
})

self.addEventListener("push", (event) => {
  const data = event.data.json()
  event.waitUntil(
    // TODO: add "icon": path_to_static_icon to second parameter in showNotification
    self.registration.showNotification(data.title, {
      body: data.body,
      data: {
        url: data.url,
      },
    }),
  )
})

self.addEventListener("notificationclick", function (event) {
  event.notification.close()
  event.waitUntil(
    clients.openWindow(self.location.origin + event.notification.data.url),
  )
})
