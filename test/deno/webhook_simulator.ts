// Send webhook events to the application webhook endpoint
const WEBHOOK_ENDPOINT = Deno.args[0] || Deno.env.get("TEST_WEBHOOK_ENDPOINT") || "http://localhost:3000/api/webhooks/github";

async function send(event: string, body: unknown) {
  const res = await fetch(WEBHOOK_ENDPOINT, { method: "POST", headers: { "content-type": "application/json", "x-github-event": event }, body: JSON.stringify(body) });
  console.log(`sent ${event} -> ${WEBHOOK_ENDPOINT} status=${res.status}`);
  const text = await res.text();
  console.log(text.slice(0, 200));
}

if (import.meta.main) {
  await send('installation', { action: 'created', installation: { id: 5555, account: { login: 'webhook-user' } } });
  await send('installation', { action: 'deleted', installation: { id: 5555 } });
  await send('installation_repositories', { action: 'added', installation: { id: 5555 }, repositories_added: [{ id: 10, name: 'repo-x' }] });
  await send('installation_repositories', { action: 'removed', installation: { id: 5555 }, repositories_removed: [{ id: 10, name: 'repo-x' }] });
}
