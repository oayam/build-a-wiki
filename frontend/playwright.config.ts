import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 90000,
  expect: { timeout: 10000 },
  use: {
    baseURL: "http://127.0.0.1:15173",
    headless: true,
    actionTimeout: 10000,
    trace: "retain-on-failure",
  },
  reporter: "list",
});
