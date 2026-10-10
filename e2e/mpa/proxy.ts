/**
 * Puts the API and a site behind one origin for a browser test, as Traefik does in production:
 * `/api` goes to the API, everything else to the site, which is the MPA (`e2e/mpa/run.sh`) or the
 * SPA's nginx container (`e2e/spa/run.sh`). Reads `FRONT_PORT`, `API_PORT` and `SITE_PORT` and
 * listens on 127.0.0.1. A WebSocket under `/api` (the SPA's `/api/ws`) is passed on as well.
 */
const port = (name: string): number => {
  const value = Number(Deno.env.get(name))
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a port number`)
  return value
}

const frontPort = port("FRONT_PORT")
const apiPort = port("API_PORT")
const sitePort = port("SITE_PORT")

Deno.serve({ hostname: "127.0.0.1", port: frontPort }, async (request) => {
  const url = new URL(request.url)
  const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/")
  const upstream = new URL(
    url.pathname + url.search,
    `http://127.0.0.1:${isApi ? apiPort : sitePort}`,
  )
  if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
    return bridgeWebSocket(request, upstream)
  }
  const headers = new Headers(request.headers)
  // `fetch` decodes a compressed body but keeps the header that says it is compressed.
  headers.set("accept-encoding", "identity")
  const response = await fetch(upstream, {
    method: request.method,
    headers,
    body: request.body,
    // The browser follows redirects, with its own cookies.
    redirect: "manual",
  })
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
})

/** Opens the same socket on the upstream, with the browser's cookie and origin, and joins the two. */
function bridgeWebSocket(request: Request, upstream: URL): Response {
  // Read first: the upgrade closes the request.
  const headers: Record<string, string> = {}
  for (const name of ["cookie", "origin"]) {
    const value = request.headers.get(name)
    if (value) headers[name] = value
  }
  const { socket: browser, response } = Deno.upgradeWebSocket(request)
  upstream.protocol = "ws:"
  // Deno's WebSocket takes request headers; the browser type this file is checked against does not.
  const options = { headers } as unknown as string[]
  const server = new WebSocket(upstream, options)
  // What the browser sends before the upstream socket is open.
  const early: Parameters<WebSocket["send"]>[0][] = []
  browser.onmessage = (event) => {
    if (server.readyState === WebSocket.OPEN) server.send(event.data)
    else early.push(event.data)
  }
  server.onopen = () => {
    for (const data of early.splice(0)) server.send(data)
  }
  server.onmessage = (event) => {
    if (browser.readyState === WebSocket.OPEN) browser.send(event.data)
  }
  const closeWith = (other: WebSocket) => () => {
    if (other.readyState <= WebSocket.OPEN) other.close()
  }
  browser.onclose = browser.onerror = closeWith(server)
  server.onclose = server.onerror = closeWith(browser)
  return response
}
