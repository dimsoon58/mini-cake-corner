import { defineConfig, devices } from "@playwright/test";

// Minimal smoke-test config (2026-09-14, CI rollout). Runs against a real
// production build (`vite preview`, serving `dist/`), the exact combination
// that exposed the Catalog/Candles blank-page bug — a dev-server run
// wouldn't have caught it as reliably (different module transform/ordering).
//
// SMOKE_BASE_PATH (optional, e.g. "/mini-cake-corner"): must match whatever
// `--base` the dist/ being tested was built with (App.tsx's BrowserRouter
// uses `basename={import.meta.env.BASE_URL}`, so routes genuinely live under
// that prefix in a base-path build, not at root). Locally, with no env var
// and a plain `npm run build` (root base, matching this repo's default),
// everything is served/tested at root exactly as before. In CI this is set
// to GitHub Pages' own base path so the SAME dist/ already built for
// deployment is what gets smoke-tested and then published — never a second,
// separately-built artifact.
const basePath = process.env.SMOKE_BASE_PATH ?? "";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  // Smoke tests only ever assert "did it crash / render nothing" — a flaky
  // retry masking a real intermittent crash would defeat the point, so no
  // retries even in CI.
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:4173${basePath}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `npm run preview -- --port 4173 --base=${basePath || "/"}`,
    url: `http://localhost:4173${basePath}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
