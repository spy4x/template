import { defineConfig, devices } from "@playwright/test"

/**
 * Playwright configuration for the MPA (`apps/mpa`), apart from the SPA's: the root configuration
 * runs `*.e2e.ts` against a stack that serves the SPA, and these specs need one that serves the
 * MPA at the same origin, with `/api` going to the API. `MPA_BASE_URL` names that origin.
 *
 * Run from `apps/mpa`: `deno task e2e`.
 */
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.mpa\.ts/,
  outputDir: "../results/mpa",
  forbidOnly: !!Deno.env.get("CI"),
  retries: Deno.env.get("CI") ? 2 : 0,
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    baseURL: Deno.env.get("MPA_BASE_URL") ?? "http://app.localhost",
    actionTimeout: 10_000,
    navigationTimeout: 10_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
