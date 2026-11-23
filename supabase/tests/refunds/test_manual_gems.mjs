// Extra « Gems » (23.11.2026) — commandes manuelles de l'admin seulement :
// Retro 8, Medium 15, Large 25 ; ni Bento ni Rectangle ; une fois par gâteau ;
// pas proposé sur le site public. Vérifie le catalogue du formulaire, le devis
// serveur, l'enregistrement, le nom dans le détail et sur l'étiquette.
// Aucun réseau.
//   node test_manual_gems.mjs   (esbuild installé, voir README)
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const FN = path.join(REPO, "supabase/functions");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gems-"));
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) { pass++; console.log("PASS", msg); } else { fail++; console.log("FAIL", msg, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ""); } };

// ── Serveur ─────────────────────────────────────────────────────────────
const sEntry = path.join(tmp, "server.ts");
fs.writeFileSync(sEntry, [
  `export { quoteManualOrder } from ${JSON.stringify(path.join(FN, "_shared/manual-order-quote.ts"))};`,
  `export { buildManualOrderCatalog } from ${JSON.stringify(path.join(FN, "_shared/manual-order-catalog.ts"))};`,
  `export { priceOrderItem, CAKE_EXTRAS } from ${JSON.stringify(path.join(FN, "_shared/pricing.ts"))};`,
  `export { extrasPrice } from ${JSON.stringify(path.join(FN, "manage-manual-order/rows.ts"))};`,
].join("\n"));
await build({ entryPoints: [sEntry], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "s.mjs"), logLevel: "error" });
const S = await import(path.join(tmp, "s.mjs"));
const sb = { rpc: async () => ({ data: [], error: null }) };

const cat = await S.buildManualOrderCatalog(sb);
for (const size of ["retro", "medium", "large"]) ok(cat.cake.extras[size].includes("gems"), `Formulaire : Gems proposé en ${size}`);
for (const size of ["bento", "rectangle"]) ok(!cat.cake.extras[size].includes("gems"), `Formulaire : Gems PAS proposé en ${size}`);
ok(JSON.stringify(S.CAKE_EXTRAS.gems) === JSON.stringify({ retro: 8, medium: 15, large: 25 }), "Prix serveur : Retro 8 / Medium 15 / Large 25", S.CAKE_EXTRAS.gems);

const cake = (size, extras, product = "bento_cake") => ({ product, size, shape: "round", design: "normal-without-border", flavors: ["vanilla"], extras, candles: [] });
const quote = (items) => S.quoteManualOrder(sb, { items, fulfillments: [{ date: "2026-12-02", deliveryMethod: "pickup", slot: "14:00 – 15:00", itemIndexes: items.map((_, i) => i) }] });
for (const [size, p] of [["retro", 8], ["medium", 15], ["large", 25]]) {
  const without = (await quote([cake(size, [])])).items[0];
  const withGems = (await quote([cake(size, ["gems"])])).items[0];
  ok(!withGems.error && withGems.total === without.total + p, `Devis : ${size} avec Gems = sans Gems + ${p}`, { without: without.total, withGems });
  const line = (withGems.breakdown ?? []).find((l) => l.kind === "extra" && l.id === "gems");
  ok(line && line.amount === p, `Devis : ligne « Gems » de CHF ${p} dans le détail (${size})`, withGems.breakdown);
  ok(S.extrasPrice(cake(size, ["gems"])) === p, `Enregistrement : prix des extras ${size} = ${p}`);
}
const withOthers = (await quote([cake("medium", ["gems", "gold-leaves"])])).items[0];
const base = (await quote([cake("medium", [])])).items[0];
ok(withOthers.total === base.total + 15 + 5, "Devis : Gems + Feuilles d'or en Medium = +15 +5", withOthers);
const bento = (await quote([cake("bento", ["gems"])])).items[0];
ok(!!bento.error, "Devis : Gems en Bento refusé", bento);
ok(!S.priceOrderItem(cake("bento", ["gems"])).ok, "Moteur de prix : Gems en Bento refusé");

// ── Site (admin) ───────────────────────────────────────────────────────
const fEntry = path.join(tmp, "front.ts");
fs.writeFileSync(fEntry, `export * from "@/lib/manualOrders";\nexport { buildCakeLabels } from "@/lib/productionLabels";\nexport { extraNameFr } from "@/data/catalogLabelsFr";`);
const empty = Object.fromEntries([".jpg", ".jpeg", ".png", ".webp", ".svg", ".mp4", ".mov", ".gif"].map((e) => [e, "empty"]));
await build({ entryPoints: [fEntry], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "f.mjs"), logLevel: "error",
  alias: { "@": path.join(REPO, "src") }, loader: empty, define: { "import.meta.env": "{}" } });
const M = await import(path.join(tmp, "f.mjs"));
ok(M.labelExtra("gems") === "Gems", "Formulaire : nom « Gems »", M.labelExtra("gems"));
ok(M.extraNameFr.gems === "Gems", "Nom français « Gems »");
ok(!M.QUANTITY_EXTRAS.includes("gems"), "Une seule fois par gâteau (pas de quantité)");
const ef = M.extraFields({ ...cake("medium", ["gems", "gold-leaves"]), fruit_supplement: null, ribbon_color: "", butterfly_color: "", glitter_color: "", glitter_cherries_color: "", inside_color: "" });
ok(ef.extra === "Gems, Gold Leaves", "Détail de la commande : extra = « Gems, Gold Leaves »", ef);
ok(/Decorations/.test(ef.extra_type ?? ""), "Type d'extra : Decorations", ef);

// Étiquette Production : type de déco reconnu.
const labels = M.buildCakeLabels([{ id: "i1", order_id: "o1", product: "bento_cake", size: "medium", shape: "round", flavors: ["vanilla"], design: "normal-without-border", extra: "Gems, Gold Leaves", extras: ["gems", "gold-leaves"], quantity: 1, order: { first_name: "Test", last_name: "Gems", order_number: "ORDM-TEST" } }]);
const deco = labels[0]?.decoType ?? "";
ok(/Gems/.test(deco) && /Feuilles d'or/.test(deco), "Étiquette Production : « Gems, Feuilles d'or »", labels[0]);

// ── Site public : Gems n'est pas proposé ───────────────────────────────
const catalogPage = fs.readFileSync(path.join(REPO, "src/pages/Catalog.tsx"), "utf8");
const customizePage = fs.readFileSync(path.join(REPO, "src/pages/Customize.tsx"), "utf8");
ok(!/id: "gems"/.test(catalogPage) && !/id: "gems"/.test(customizePage), "Site public : Gems absent des pages Catalogue et Personnaliser");

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
