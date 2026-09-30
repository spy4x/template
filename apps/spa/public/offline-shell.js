// Keeps the app shell (the page and its scripts, styles and images) in the browser's cache, so the
// SPA opens with no network. `sw.js` loads this file with `importScripts`; deleting the file and
// that one line leaves the push handlers and nothing else. Never touches `/api`: the data comes
// from the offline layer's IndexedDB store, not from this cache.
const SHELL_CACHE = "shell-v1"

/** Whether the worker may answer this request from the cache. */
function isShellRequest(request) {
  const url = new URL(request.url)
  return request.method === "GET" && url.origin === self.location.origin &&
    !url.pathname.startsWith("/api/")
}

/** Stores the page and every script, style and image it names, for the first offline start. */
async function precache() {
  const cache = await caches.open(SHELL_CACHE)
  const page = await fetch("/", { cache: "reload" })
  if (!page.ok) return
  await cache.put("/", page.clone())
  const html = await page.text()
  const urls = [...html.matchAll(/(?:src|href)="(\/[^"#]+)"/g)].map((match) => match[1])
  // One asset that fails to load must not stop the worker from installing.
  await Promise.allSettled(urls.map((url) => cache.add(url)))
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache())
})

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("shell-") && name !== SHELL_CACHE) await caches.delete(name)
    }
    // Take over the page that registered this worker, so its next requests are cached too.
    await self.clients.claim()
  })())
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (!isShellRequest(request)) return
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE)
    if (request.mode === "navigate") {
      // Every route is the same page: network first so a deploy shows at once, cache when offline.
      try {
        const response = await fetch(request)
        if (response.ok) await cache.put("/", response.clone())
        return response
      } catch (error) {
        const page = await cache.match("/")
        if (page) return page
        throw error
      }
    }
    // Scripts and styles carry a hash in their name, so a cached copy is never stale: answer from
    // the cache and refresh it behind the answer.
    const cached = await cache.match(request)
    const refresh = fetch(request).then(async (response) => {
      if (response.ok) await cache.put(request, response.clone())
      return response
    })
    if (cached) {
      refresh.catch(() => {})
      return cached
    }
    return await refresh
  })())
})
