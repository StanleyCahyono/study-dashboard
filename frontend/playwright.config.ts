import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// End-to-end checks against the DEMO profile in a throwaway data directory.
// Synthetic data only; never point this at the real profile.
const dataRoot = process.env.STUDYDASH_E2E_ROOT ?? mkdtempSync(join(tmpdir(), "studydash-e2e-"));
process.env.STUDYDASH_E2E_ROOT = dataRoot;
const PORT = 8799;

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 30_000,
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "off" },
  webServer: {
    command: `uv run studyctl serve --demo --port ${PORT}`,
    cwd: "..",
    url: `http://127.0.0.1:${PORT}/api/public/status`,
    env: { STUDYDASH_DATA_ROOT: dataRoot },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
