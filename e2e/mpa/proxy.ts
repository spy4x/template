/**
 * Puts the API and the MPA behind one origin for the MPA's browser test, as Traefik does in
 * production: `/api` goes to the API, everything else to the MPA. Reads `FRONT_PORT`, `API_PORT`
 * and `MPA_PORT`, listens on 127.0.0.1 and serves plain HTTP only (the MPA has no WebSocket).
 */
const port = (name: string): number => {
  const value = Number(Deno.env.get(name))
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a port number`)
  return value
}

const frontPort = port("FRONT_PORT")
const apiPort = port("API_PORT")
const mpaPort = port("MPA_PORT")

Deno.serve({ hostname: "127.0.0.1", port: frontPort }, async (request) => {
  const url = new URL(request.url)
  const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/")
  const upstream = new URL(
    url.pathname + url.search,
    `http://127.0.0.1:${isApi ? apiPort : mpaPort}`,
  )
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
