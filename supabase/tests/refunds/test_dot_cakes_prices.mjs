// Prix des Dot Cakes (06.10.2026) : pack 4 = 28, 6 = 40, 9 = 58, 12 = 75,
// 20 = 120. Vérifie que les 5 tables donnent les mêmes prix, que le moteur
// du serveur (celui qui fixe le montant envoyé à PostFinance) les facture,
// et que la page affiche « À partir de » 28. Aucun réseau.
//
//   cd supabase/tests/refunds
//   npm install --no-save esbuild
//   node test_dot_cakes_prices.mjs
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

const REPO = path.resolve(import.meta.dirname, "../../..");
let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra) : ""); } };
const EXPECTED = { "dot-cakes-4": 28, "dot-cakes-6": 40, "dot-cakes-9": 58, "dot-cakes-12": 75, "dot-cakes-20": 120 };
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
const table = (src) => Object.fromEntries([...src.matchAll(/"(dot-cakes-\d+)": (?:\{[^}]*price: )?(\d+(?:\.\d+)?)/g)].map((m) => [m[1], Number(m[2])]));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 1. Les 5 tables ─────────────────────────────────────────────────────
for (const [name, file, slice] of [
  ["Serveur (prix facturé, _shared/pricing.ts)", "supabase/functions/_shared/pricing.ts", (s) => s.slice(s.indexOf("DOT_CAKES_PACKS"), s.indexOf("DOT_CAKES_FLAVOR_TIER"))],
  ["Remise de bienvenue (serveur)", "supabase/functions/create-postfinance-payment/index.ts", (s) => s.slice(s.indexOf("const WELCOME_VOUCHER_BASE"), s.indexOf("interface OrderRow"))],
  ["Remise de bienvenue (site)", "src/lib/welcomeDiscount.ts", (s) => s],
  ["Base partenaires (site)", "src/lib/partnerDiscount.ts", (s) => s],
]) {
  const tb = table(slice(read(file)));
  check(`${name} : 28 / 40 / 58 / 75 / 120`, eq(tb, EXPECTED), tb);
}
const page = read("src/pages/DotCakes.tsx");
const packs = [...page.matchAll(/\{ size: (\d+), flavours: \d+, price: (\d+) \}/g)].map((m) => [`dot-cakes-${m[1]}`, Number(m[2])]);
check("Page Dot Cakes : 28 / 40 / 58 / 75 / 120", eq(Object.fromEntries(packs), EXPECTED), packs);
check("Page Dot Cakes : « À partir de » = premier pack = 28 (le moins cher)", packs[0]?.[1] === 28 && Math.min(...packs.map((p) => p[1])) === 28 && page.includes("CHF {packs[0].price}"));
check("Plus aucun ancien prix (35 / 51 / 99 / 160) pour les Dot Cakes", ["pricing.ts", "welcome", "partner", "create", "page"].every(() => true)
  && !/"dot-cakes-4": (\{[^}]*price: )?35\b|"dot-cakes-20": (\{[^}]*price: )?160\b/.test(read("supabase/functions/_shared/pricing.ts") + read("src/lib/welcomeDiscount.ts") + read("src/lib/partnerDiscount.ts") + read("supabase/functions/create-postfinance-payment/index.ts"))
  && !/price: (35|51|99|160) \}/.test(page));

// ── 2. Le moteur du serveur facture ces prix ────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dot-"));
await build({ entryPoints: [path.join(REPO, "supabase/functions/_shared/pricing.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "p.mjs"), logLevel: "error" });
const P = await import(path.join(tmp, "p.mjs"));
const price = (size, flavors) => P.priceOrderItem({ product: "dot_cakes", size, flavors, design: null, extras: [], candles: [] });
for (const [size, p] of Object.entries(EXPECTED)) {
  const r = price(size, ["vanilla"]);
  check(`Serveur : ${size} en vanille = CHF ${p} (montant envoyé à PostFinance)`, r.ok && r.total === p, r);
}
let r = price("dot-cakes-4", ["vanilla", "salted-caramel"]);
check("Supplément de parfum inchangé : pack 4, vanille + caramel (2 dots × 1.50) = 28 + 3 = 31", r.ok && r.total === 31, r);
r = price("dot-cakes-20", ["vanilla", "chocolate", "red-velvet", "tiramisu", "praline"]);
check("Pack 20, 5 parfums dont 2 à 2.50 (4 dots chacun) = 120 + 20 = 140", r.ok && r.total === 140, r);
check("Base de commission partenaire du serveur = prix du pack (28)", r.ok && price("dot-cakes-4", ["vanilla"]).baseCakePrice === 28);

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
