#!/usr/bin/env bash
# Runs the browser tests of the SPA as production serves it (`e2e/spa`): builds the image of
# `apps/spa/dockerfile.prod`, starts its nginx container, migrates the database, starts the API and the worker,
# puts both behind one origin (`e2e/mpa/proxy.ts`) and runs Playwright. The specs check what nginx
# adds and the development stack never shows: the security headers, and that the app runs under
# its content security policy without a refusal.
#
# Needs from the environment: a Postgres and a Valkey that are already running, as `DB_HOST`,
# `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME`, `KV_HOSTNAME`, `KV_PORT` and `KV_PASSWORD`; a
# container tool (`CONTAINER_PROVIDER`, `podman` by default, as `deno task compose`); and a browser
# Playwright can start. Run it from the repository root.
# The tests do not run in `DB_NAME`: the script connects there, drops and creates its own database
# `template_e2e_spa` and runs the stack against that.
# `FRONT_PORT`, `API_PORT` and `SITE_PORT` default to 8080, 8000 and 8002.
set -euo pipefail

FRONT_PORT=${FRONT_PORT:-8080}
API_PORT=${API_PORT:-8000}
SITE_PORT=${SITE_PORT:-8002}
export FRONT_PORT API_PORT SITE_PORT

DENO_VERSION=${DENO_VERSION:-2.9.0}
CONTAINER=${CONTAINER_PROVIDER:-podman}
SPA_IMAGE=template-e2e-spa
SPA_CONTAINER="template-e2e-spa-$$"
# The tracker the container is told about, so the spec can find its origin in the policy. Nothing
# listens there and the app reports to it only when an error happens.
ERROR_TRACKER_ORIGIN=https://errors.example.com
export ERROR_TRACKER_ORIGIN

# The API reads vapid.json from its working directory. Reuse existing keys; never replace them, and
# never leave a file in infra/configs/ that was not there. Checked before the trap below, which
# deletes the root vapid.json: only one this script made.
if [ -e vapid.json ]; then
  echo "vapid.json exists in the repository root; move it away first"
  exit 1
fi

SCRATCH=$(mktemp -d)
PIDS=()
cleanup() {
  set +e
  "$CONTAINER" rm --force "$SPA_CONTAINER" >/dev/null 2>&1
  for pid in "${PIDS[@]}"; do
    # `deno serve` does not exit on SIGTERM when it has open connections: stop it for good.
    kill -TERM "$pid" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
    kill -KILL "$pid" 2>/dev/null
  done
  find "$SCRATCH" -delete
  find vapid.json -delete 2>/dev/null
}
trap cleanup EXIT INT TERM

wait_for() { # <name> <pid> <url>
  for _ in $(seq 1 120); do
    curl -fsS --max-time 2 -o /dev/null "$3" 2>/dev/null && return 0
    kill -0 "$2" 2>/dev/null || { echo "$1 stopped"; tail -n 40 "$SCRATCH/$1.log"; return 1; }
    sleep 0.5
  done
  echo "$1 did not answer at $3 within 60 s"
  tail -n 40 "$SCRATCH/$1.log"
  return 1
}

# Throw-away secrets, never printed. The origin check compares the browser's Origin with
# http://$DOMAIN, port included. The address is `127.0.0.1`, not `app.localhost`: Chromium resolves
# the latter itself, but the Node side of Playwright (its `request` fixture) asks the system
# resolver, which in the CI container does not know it.
AUTH_COOKIE_SECRET=$(openssl rand -hex 32)
AUTH_PEPPER=$(openssl rand -hex 32)
AUTH_TOTP=$(openssl rand -hex 20)
export AUTH_COOKIE_SECRET AUTH_PEPPER AUTH_TOTP
export ENV=dev
export DOMAIN="127.0.0.1:$FRONT_PORT"
export DEV_EMAIL=dev@example.com
export TIMEZONE=Etc/UTC
export RATE_LIMITER_WINDOW_MS=60000
export RATE_LIMITER_STRICT_LIMIT=1000
export RATE_LIMITER_LIMIT=5000
export RATE_LIMITER_OTP_WINDOW_MS=900000
export RATE_LIMITER_OTP_LIMIT=1000
export API_URL="http://127.0.0.1:$API_PORT"
export SPA_BASE_URL="http://$DOMAIN"

# A fresh database of its own. Dropped first, so a rerun starts empty instead of failing on
# "already exists" or inheriting rows from the last run. `DB_NAME` is only the database to connect
# to; it must exist.
E2E_DB_NAME=template_e2e_spa
deno eval '
import postgres from "postgres"
const name = Deno.args[0]
const sql = postgres({
  host: Deno.env.get("DB_HOST"),
  port: Number(Deno.env.get("DB_PORT")),
  user: Deno.env.get("DB_USER"),
  password: Deno.env.get("DB_PASS"),
  database: Deno.env.get("DB_NAME"),
  max: 1,
})
await sql.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
await sql.unsafe(`CREATE DATABASE ${name}`)
await sql.end()
' "$E2E_DB_NAME"
export DB_NAME=$E2E_DB_NAME

deno task db:migrate

if [ -f infra/configs/vapid.json ]; then
  cp infra/configs/vapid.json vapid.json
else
  deno task vapid-key:create >/dev/null && mv infra/configs/vapid.json vapid.json
fi

deno serve --allow-all --port "$API_PORT" --host 127.0.0.1 apps/api/index.ts \
  >"$SCRATCH/api.log" 2>&1 &
PIDS+=($!)
wait_for api "${PIDS[-1]}" "http://127.0.0.1:$API_PORT/api/health"

# The worker sends the mail with the code that proves an address; the spec reads it back through
# /api/test/last-mail.
deno run --allow-all apps/worker/+main.ts >"$SCRATCH/worker.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 120); do
  grep -q "Worker started" "$SCRATCH/worker.log" && break
  kill -0 "${PIDS[-1]}" 2>/dev/null || { echo "worker stopped"; tail -n 40 "$SCRATCH/worker.log"; exit 1; }
  sleep 0.5
done
grep -q "Worker started" "$SCRATCH/worker.log" || { echo "worker did not start within 60 s"; exit 1; }

# The image exactly as a deploy builds it: the base image first, then the SPA's own.
"$CONTAINER" build --quiet --build-arg "DENO_VERSION=$DENO_VERSION" \
  --tag "app/deno-base:$DENO_VERSION" --file Dockerfile.base . >"$SCRATCH/base-image.log" 2>&1 ||
  { echo "the base image did not build"; tail -n 40 "$SCRATCH/base-image.log"; exit 1; }
"$CONTAINER" build --quiet --build-arg "DENO_VERSION=$DENO_VERSION" \
  --tag "$SPA_IMAGE" --file apps/spa/dockerfile.prod . >"$SCRATCH/spa-image.log" 2>&1 ||
  { echo "the SPA image did not build"; tail -n 40 "$SCRATCH/spa-image.log"; exit 1; }
"$CONTAINER" run --detach --name "$SPA_CONTAINER" --publish "127.0.0.1:$SITE_PORT:8080" \
  --env SPA_ENV=dev --env "SPA_ERROR_REPORT_DSN=https://public-key@${ERROR_TRACKER_ORIGIN#https://}/1" \
  "$SPA_IMAGE" >/dev/null
for _ in $(seq 1 120); do
  curl -fsS --max-time 2 -o /dev/null "http://127.0.0.1:$SITE_PORT/" 2>/dev/null && break
  sleep 0.5
done
curl -fsS --max-time 2 -o /dev/null "http://127.0.0.1:$SITE_PORT/" ||
  { echo "the SPA container did not answer within 60 s"; "$CONTAINER" logs "$SPA_CONTAINER" 2>&1 | tail -n 40; exit 1; }

deno run --allow-net --allow-env e2e/mpa/proxy.ts >"$SCRATCH/proxy.log" 2>&1 &
PIDS+=($!)
wait_for proxy "${PIDS[-1]}" "$SPA_BASE_URL/config.json"

deno task e2e --config=e2e/spa/playwright.config.ts
