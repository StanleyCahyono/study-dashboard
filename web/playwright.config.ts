import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:4173/study-dashboard/", trace: "off" },
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://127.0.0.1:4173/study-dashboard/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
