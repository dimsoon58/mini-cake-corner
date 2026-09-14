import { test, expect, type Page } from "@playwright/test";

// Minimal smoke tests (2026-09-14, CI rollout). The one and only thing these
// check: does the page actually render, with no uncaught JavaScript error —
// exactly the failure mode that put a blank page in front of customers on
// /catalog and /candles (a TDZ ordering bug + a missing import, both of
// which threw synchronously on render). Deliberately NOT testing business
// logic, prices, copy, or specific UI content — that would need constant
// upkeep as the site evolves and isn't what this suite is for. A real
// regression in wording/pricing/flow should be caught by review, not by
// this file. Kept to exactly the 9 priority routes named for this rollout.
const ROUTES = [
  "/",
  "/catalog",
  "/candles",
  "/dot-cakes",
  "/kit-bento-cake",
  "/cart",
  "/checkout",
  "/printing",
  "/inspiration",
];

// index.html loads two third-party scripts directly (Cookiebot consent
// banner, Google Tag Manager) that this suite has no control over and that
// fail to load in any environment without real network access to those
// exact domains (this sandbox, and possibly some CI runners) — a plain
// "Failed to load resource" console entry, never a thrown JS error. Ignoring
// this ONE specific, well-understood browser message is safe: it can never
// mask the class of bug this suite exists to catch (a real ReferenceError/
// SyntaxError from broken app code always fires a `pageerror` event too,
// which is never filtered, below).
const IGNORED_CONSOLE_PATTERN = /Failed to load resource/i;

// Collects uncaught page errors (the ReferenceError/SyntaxError class of bug
// this suite exists to catch — always fatal) and any OTHER console.error
// output (fatal too, minus the one ignored pattern above). Attached BEFORE
// navigation so nothing from the initial load is missed.
function collectPageErrors(page: Page): { errors: string[] } {
  const state = { errors: [] as string[] };
  page.on("pageerror", (err) => {
    state.errors.push(`pageerror: ${err.message}`);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error" && !IGNORED_CONSOLE_PATTERN.test(msg.text())) {
      state.errors.push(`console.error: ${msg.text()}`);
    }
  });
  return state;
}

// SMOKE_BASE_PATH (see playwright.config.ts) must be concatenated onto each
// route EXPLICITLY, not left to Playwright's own baseURL + goto(url)
// resolution — a leading-slash route like "/catalog" resolved against a
// baseURL that itself has a path segment (e.g. ".../mini-cake-corner")
// silently DISCARDS that segment (standard URL-resolution behaviour for an
// absolute-path reference), landing on the wrong path entirely. Building
// the full path here sidesteps that gotcha completely.
const basePath = process.env.SMOKE_BASE_PATH ?? "";

for (const route of ROUTES) {
  test(`${route} loads without a JavaScript error`, async ({ page }) => {
    const collected = collectPageErrors(page);

    const response = await page.goto(`${basePath}${route}`, { waitUntil: "networkidle" });
    expect(response?.ok(), `HTTP response for ${route}`).toBeTruthy();

    // The React tree actually rendered something — not the literal blank
    // page this suite is guarding against. A generous, loose threshold on
    // purpose: this must never fail just because some copy got shorter.
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.trim().length, `${route} rendered visible content`).toBeGreaterThan(20);

    expect(collected.errors, `console/page errors on ${route}`).toEqual([]);
  });
}
