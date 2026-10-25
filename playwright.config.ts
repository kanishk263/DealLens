import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.local" });
const PORT = Number(process.env.E2E_PORT ?? 3200);

/**
 * End-to-end tests against a production build (`npm run build`) and the LOCAL Supabase stack + worker.
 * Google's consent screen is not automated: the test verifies the OAuth redirect request, then uses real
 * Supabase sessions for local test users (see tests/support/session-cookies.ts and docs/testing.md).
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure", ...devices["Desktop Chrome"] },
  webServer: { command: `npx next start -p ${PORT}`, url: `http://localhost:${PORT}`, reuseExistingServer: true, timeout: 120_000 },
});
