OAuth E2E test suite (GitHub App)

Overview
- Mocked GitHub server + webhook simulator
- Deno tests for auth, webhooks, token refresh
- Playwright UI tests for /profile connect/disconnect flows

Requirements
- Deno (v1.30+)
- Node + Playwright (for UI tests) or Playwright CLI
- Your app must be runnable locally and reachable at TEST_APP_URL

Environment
- Create a .env.test or export env vars before running:
  - TEST_APP_URL=http://localhost:3000  # app under test
  - MOCK_GITHUB_HOST=127.0.0.1
  - MOCK_GITHUB_PORT=8999
  - GITHUB_APP_CLIENT_ID=demo
  - GITHUB_APP_CLIENT_SECRET=demo
  - DB_RESET_CMD="npm run db:test:reset"  # optional command to reset DB

How it works
- Start mock GitHub server (Deno script) which implements:
  - /login/oauth/authorize -> simulated approval redirect
  - /login/oauth/access_token -> returns app access token
  - /app/installations endpoints -> installation creation/listing
  - repository list endpoints
- Tests run sequences against TEST_APP_URL but direct GitHub calls to the mock server using env config.

Run Deno integration tests
1. Reset DB: run $DB_RESET_CMD (if configured)
2. Start your app locally so TEST_APP_URL is reachable
3. Start the mock server (in separate shell):
   deno run --allow-net --allow-env test/deno/mock_github_server.ts
4. Run Deno tests:
   deno test --allow-net --allow-env --unstable deno/tests/github_oauth_integration_test.ts

Run Playwright UI tests
1. Install deps: npx playwright install
2. Set TEST_APP_URL pointing to your app and start it
3. Start mock server as above
4. Run Playwright: npx playwright test e2e/playwright/github_oauth.spec.ts

Notes
- Tests are templates. You may need to align endpoint paths with your app.
- The mock server and tests are deterministic; they do not call real GitHub.
