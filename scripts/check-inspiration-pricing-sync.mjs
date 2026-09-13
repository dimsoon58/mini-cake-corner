#!/usr/bin/env node
// Consistency check: src/data/inspirations.ts's INSPIRATIONS array and
// supabase/functions/_shared/pricing.ts's INSPIRATION_DESIGNS table are two
// hand-maintained copies of the exact same data (Deno Edge Functions can't
// import from src/, so the server keeps its own copy — same convention as
// every other frontend/server-shared table in this repo). They MUST stay
// byte-identical on ids and per-size prices, or the checkout will either
// reject Inspiration orders (id missing server-side) or charge the wrong
// amount for one (price mismatch).
//
// This script fails (non-zero exit) if the two ever diverge. Run it:
//   node scripts/check-inspiration-pricing-sync.mjs
// or:
//   npm run check:inspiration-pricing
//
// It should be run in CI / before any deploy that touches either file.
//
// Deliberately dependency-free (no TS build step, no esbuild): both files
// are parsed as plain text with a regex over their literal object syntax,
// so this stays runnable with nothing but plain Node.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const inspirationsPath = path.join(repoRoot, "src/data/inspirations.ts");
const pricingPath = path.join(repoRoot, "supabase/functions/_shared/pricing.ts");

function parseIdPriceMap(source, entryRegex) {
  const map = new Map();
  for (const m of source.matchAll(entryRegex)) {
    const id = m[1];
    const priceLiteral = m[2];
    if (map.has(id)) {
      throw new Error(`duplicate id "${id}" found while parsing`);
    }
    // Object literal of plain numbers, e.g. "{ bento: 3, retro: 4 }" — safe
    // to evaluate directly, this is our own reviewed source, not user input.
    const price = new Function(`return (${priceLiteral})`)();
    map.set(id, price);
  }
  return map;
}

function priceMapsEqual(a, b) {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length || aKeys.some((k, i) => k !== bKeys[i])) return false;
  return aKeys.every((k) => a[k] === b[k]);
}

const inspirationsSrc = readFileSync(inspirationsPath, "utf8");
const pricingSrc = readFileSync(pricingPath, "utf8");

const frontend = parseIdPriceMap(
  inspirationsSrc,
  /\{ id: "(inspiration-\d+)", src: img\d+, price: (\{[^}]*\}) \}/g
);

// Restrict the pricing.ts parse to the INSPIRATION_DESIGNS block only, so a
// coincidental match elsewhere in the file can never leak in.
const blockMatch = pricingSrc.match(
  /export const INSPIRATION_DESIGNS: Record<string, SizePriceMap> = \{([\s\S]*?)\n\};/
);
if (!blockMatch) {
  console.error("FAIL: could not find INSPIRATION_DESIGNS block in pricing.ts");
  process.exit(1);
}
const server = parseIdPriceMap(
  blockMatch[1],
  /"(inspiration-\d+)": (\{[^}]*\}),/g
);

let failed = false;

if (frontend.size === 0) {
  console.error("FAIL: parsed zero entries from src/data/inspirations.ts — regex likely out of sync with that file's format.");
  failed = true;
}
if (server.size === 0) {
  console.error("FAIL: parsed zero entries from INSPIRATION_DESIGNS — regex likely out of sync with that table's format.");
  failed = true;
}

const onlyInFrontend = [...frontend.keys()].filter((id) => !server.has(id));
const onlyInServer = [...server.keys()].filter((id) => !frontend.has(id));

if (onlyInFrontend.length) {
  failed = true;
  console.error(`FAIL: ${onlyInFrontend.length} id(s) present in inspirations.ts but MISSING from INSPIRATION_DESIGNS (server would reject these orders): ${onlyInFrontend.join(", ")}`);
}
if (onlyInServer.length) {
  failed = true;
  console.error(`FAIL: ${onlyInServer.length} id(s) present in INSPIRATION_DESIGNS but missing from inspirations.ts (dead/orphaned server entries — harmless but should be cleaned up): ${onlyInServer.join(", ")}`);
}

const mismatches = [];
for (const [id, frontendPrice] of frontend) {
  const serverPrice = server.get(id);
  if (serverPrice && !priceMapsEqual(frontendPrice, serverPrice)) {
    mismatches.push({ id, frontendPrice, serverPrice });
  }
}
if (mismatches.length) {
  failed = true;
  console.error(`FAIL: ${mismatches.length} id(s) have different prices on the frontend vs the server:`);
  for (const m of mismatches) {
    console.error(`  ${m.id}: inspirations.ts=${JSON.stringify(m.frontendPrice)}  INSPIRATION_DESIGNS=${JSON.stringify(m.serverPrice)}`);
  }
}

if (failed) {
  process.exit(1);
}

console.log(`OK: ${frontend.size} inspiration ids match exactly between inspirations.ts and INSPIRATION_DESIGNS (same ids, same per-size prices).`);
