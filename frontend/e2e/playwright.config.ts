import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const port = Number(process.env.ORINONU_E2E_PORT ?? 19794);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 30000,
  expect: { timeout: 10000 },
  outputDir: "../test-results",
  reporter: "list",
  use: {
    baseURL,
    viewport: { width: 1366, height: 768 },
    reducedMotion: "reduce",
    serviceWorkers: "block",
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node ../scripts/serve-ui.mjs",
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    url: baseURL,
    reuseExistingServer: false,
    env: { NEXO_UI_PORT: String(port), NEXO_API_ORIGIN: "http://127.0.0.1:1", ORINONU_UPDATE_CHECK: "0" },
  },
});
