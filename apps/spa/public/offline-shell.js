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
  const url = new URL(request.url)
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE)
    // A build names its scripts and styles by content hash, so a cached copy is never stale.
    if (url.pathname.startsWith("/assets/")) {
      const cached = await cache.match(request)
      if (cached) return cached
    }
    // Everything else (the page, the manifest, and every file of a dev server) is asked of the
    // network first, so a deploy or an edit shows at once; the cache answers only when it fails.
    // Every route is the same page, so a page load is stored and served under `/`.
    const key = request.mode === "navigate" ? "/" : request
    try {
      const response = await fetch(request)
      if (response.ok) await cache.put(key, response.clone())
      return response
    } catch (error) {
      const cached = await cache.match(key)
      if (cached) return cached
      throw error
    }
  })())
})
