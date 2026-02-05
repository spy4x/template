// Simple mock GitHub App server for OAuth and installation APIs
// Run: deno run --allow-net --allow-env test/deno/mock_github_server.ts
import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

const HOST = Deno.env.get("MOCK_GITHUB_HOST") ?? "127.0.0.1";
const PORT = Number(Deno.env.get("MOCK_GITHUB_PORT") ?? 8999);

let installations = new Map();
let nextInstallationId = 1000;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

console.log(`Mock GitHub server listening http://${HOST}:${PORT}`);

serve(async (req: Request) => {
  const url = new URL(req.url);
  // Authorization redirect (simulate user approval)
  if (url.pathname === "/login/oauth/authorize") {
    // Params: client_id, redirect_uri, state
    const redirect = url.searchParams.get("redirect_uri") || "http://localhost/cb";
    const state = url.searchParams.get("state");
    // Create installation to simulate post-approval
    const installation_id = ++nextInstallationId;
    installations.set(String(installation_id), { id: installation_id, account: { login: "mock-user" }, repos: [{ id: 1, name: "repo-a" }] });
    const callback = new URL(redirect);
    callback.searchParams.set("installation_id", String(installation_id));
    if (state) callback.searchParams.set("state", state);
    return Response.redirect(callback.toString(), 302);
  }

  if (url.pathname === "/login/oauth/access_token") {
    // return fake token
    return json(200, { access_token: "mock_app_token", token_type: "bearer" });
  }

  // App installation retrieval
  if (url.pathname.startsWith("/app/installations")) {
    const parts = url.pathname.split("/").filter(Boolean);
    // /app/installations or /app/installations/:id
    if (parts.length === 2) {
      const list = Array.from(installations.values()).map((it) => ({ id: it.id, account: it.account }));
      return json(200, list);
    }
    if (parts.length === 3) {
      const id = parts[2];
      const inst = installations.get(id);
      if (!inst) return json(404, { message: "Not Found" });
      return json(200, inst);
    }
  }

  // Installation repositories endpoints
  if (url.pathname.startsWith("/user/installations")) {
    // return installations for a user
    const list = Array.from(installations.values()).map((it) => ({ id: it.id, account: it.account }));
    return json(200, { installations: list });
  }

  // Repos listing: /installation/:id/repositories
  if (url.pathname.startsWith("/installation/")) {
    const m = url.pathname.match(/^\/installation\/(\d+)\/repositories$/);
    if (m) {
      const id = m[1];
      const inst = installations.get(id);
      if (!inst) return json(404, { message: "Not Found" });
      return json(200, { repositories: inst.repos });
    }
  }

  // Simulate 404 for unknown endpoints
  return json(404, { message: "mock server: not found" });
}, { hostname: HOST, port: PORT });
