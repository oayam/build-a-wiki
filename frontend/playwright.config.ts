import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 90000,
  expect: { timeout: 10000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:15173",
    ignoreHTTPSErrors: process.env.E2E_TEST_TLS === "1",
    headless: true,
    actionTimeout: 10000,
    trace: "retain-on-failure",
  },
  reporter: "list",
});
