// Commandes manuelles — gâteaux et bûches de Noël (21.11.2026) : catalogue,
// prix (mêmes que la page Noël), limite du 24.12, lignes enregistrées comme le
// site, relecture des goûts, articles de Noël modifiables (F47).
//   node test_manual_christmas.mjs   (esbuild installé, voir README)
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FN = path.join(HERE, "../../functions");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "noel-"));
const entry = path.join(tmp, "entry.ts");
fs.writeFileSync(entry, [
  `export { quoteManualOrder } from ${JSON.stringify(path.join(FN, "_shared/manual-order-quote.ts"))};`,
  `export { buildManualOrderCatalog } from ${JSON.stringify(path.join(FN, "_shared/manual-order-catalog.ts"))};`,
  `export { flavourIdsOf, lockReasonOf, priceSignature, itemLabel } from ${JSON.stringify(path.join(FN, "_shared/order-edit.ts"))};`,
  `export { buildItemRow } from ${JSON.stringify(path.join(FN, "manage-manual-order/rows.ts"))};`,
].join("\n"));
const out = path.join(tmp, "bundle.mjs");
await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error" });
const m = await import(out);
const sb = { rpc: async () => ({ data: [], error: null }) };
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) { pass++; } else { fail++; console.log("FAIL", msg, extra ?? ""); } };
const q = (items, date = "2026-12-22", historical = false) => m.quoteManualOrder(sb, { items, fulfillments: [{ date, deliveryMethod: "pickup", slot: "14:00 – 15:00", itemIndexes: items.map((_, i) => i) }], historical });

// Catalogue
const cat = await m.buildManualOrderCatalog(sb);
ok(cat.christmas.cakes.length === 8 && cat.christmas.logs.length === 4, "catalogue 8 cakes 4 logs");
ok(cat.christmas.editionFlavours.length === 10 && cat.christmas.classicFlavours.length === 15, "catalogue flavours");
ok(cat.christmas.lastDate === "2026-12-24", "last date");

// Sapin medium Marron = 140 + 4 = 144 (as site test)
let r = await q([{ product: "bento_cake", size: "medium", shape: "round", design: "noel-sapin", flavors: ["noel-marron"], extras: [], candles: [] }]);
ok(r.items[0].total === 144, "sapin medium marron 144", r.items[0]);
ok(r.items[0].breakdown && r.items[0].breakdown.length === 2, "breakdown 2 lines", r.items[0].breakdown);
// Grinch log Marron = 69
r = await q([{ product: "christmas_log", size: "buche", design: "buche-grinch", flavors: ["noel-marron"], extras: [], candles: [] }]);
ok(r.items[0].total === 69, "grinch marron 69", r.items[0]);
// classic flavour on Christmas cake: Rodolphe bento tiramisu
r = await q([{ product: "bento_cake", size: "bento", shape: "round", design: "noel-rodolphe", flavors: ["tiramisu"], extras: [], candles: [] }]);
ok(r.items[0].total > 45 && r.items[0].error === null, "rodolphe bento tiramisu", r.items[0]);
// free all
r = await q([{ product: "christmas_log", size: "buche", design: "buche-grinch", flavors: ["noel-mangue-passion"], extras: [], candles: [], free_options: ["flavour:noel-mangue-passion"] }]);
ok(r.items[0].total === 65 && r.items[0].freeAmount === 6, "free flavour supplement", r.items[0]);
// invalid size
r = await q([{ product: "bento_cake", size: "bento", shape: "round", design: "noel-sapin", flavors: ["noel-marron"], extras: [], candles: [] }]);
ok(r.items[0].error && /christmas design/.test(r.items[0].error), "sapin bento refused", r.items[0]);
// fruit refused
r = await q([{ product: "bento_cake", size: "medium", shape: "round", design: "noel-sapin", flavors: ["noel-marron"], extras: [], candles: [], fruit_supplement: 10 }]);
ok(r.items[0].error && /fruit/.test(r.items[0].error), "fruit refused", r.items[0]);
// date limit
r = await q([{ product: "christmas_log", size: "buche", design: "buche-grinch", flavors: ["noel-marron"], extras: [], candles: [] }], "2027-01-12");
ok(r.errors.some((e) => /last pickup or delivery date is 2026-12-24/.test(e)), "date after 24.12 refused", r.errors);
r = await q([{ product: "christmas_log", size: "buche", design: "buche-grinch", flavors: ["noel-marron"], extras: [], candles: [] }], "2026-12-25");
ok(r.errors.some((e) => /2026-12-24/.test(e)), "Christmas log on 25.12 refused (closure from 25.12)", r.errors);
r = await q([{ product: "christmas_log", size: "buche", design: "buche-grinch", flavors: ["noel-marron"], extras: [], candles: [] }], "2026-12-24");
ok(!r.errors.some((e) => /Christmas/.test(e)), "Christmas log on 24.12 accepted", r.errors);
r = await q([{ product: "bento_cake", size: "bento", shape: "round", design: "normal-without-border", flavors: ["vanilla"], extras: [], candles: [] }], "2027-01-12");
ok(!r.errors.some((e) => /Christmas/.test(e)), "normal cake not limited", r.errors);

// Rows like the site
const it = { product: "bento_cake", size: "medium", shape: null, design: "noel-sapin", flavors: ["noel-chocolat"], extras: [], candles: [] };
let row = m.buildItemRow(it, { total: 144 }, "o", "f");
ok(row.flavors[0] === "Chocolate Lovers" && row.shape === "round", "row cake", row.flavors);
row = m.buildItemRow({ product: "christmas_log", size: "buche", design: "buche-grinch", flavors: ["noel-lemon-curd"], extras: [], candles: [] }, { total: 69 }, "o", "f");
ok(row.flavors[0] === "Lemon curd" && row.shape === null, "row log", row);
row = m.buildItemRow({ product: "bento_cake", size: "bento", design: "noel-rodolphe", flavors: ["salted-caramel"], extras: [], candles: [] }, { total: 50 }, "o", "f");
ok(row.flavors[0] === "Salted Butter Caramel", "row classic", row.flavors);

// Read back
ok(m.flavourIdsOf(["Lemon curd"], { product: "christmas_log", design: "buche-grinch", size: "buche", total: 69 })[0] === "noel-lemon-curd", "log lemon curd back");
ok(m.flavourIdsOf(["Lemon Curd"], { product: "bento_cake", design: "noel-rodolphe", size: "bento", shape: "round", total: 50 })[0] === "lemon-curd", "cake classic lemon back");
ok(m.flavourIdsOf(["Lemon curd"], { product: "bento_cake", design: "noel-rodolphe", size: "bento", shape: "round", total: 47 })[0] === "noel-lemon-curd", "cake edition lemon back");
// Chocolate Lovers ambiguity: Sapin medium: edition 140+4=144 ; classic special at medium?
const cl = await q([{ product: "bento_cake", size: "medium", shape: "round", design: "noel-sapin", flavors: ["chocolate-lovers"], extras: [], candles: [] }]);
const clTotal = cl.items[0].total;
ok(m.flavourIdsOf(["Chocolate Lovers"], { product: "bento_cake", design: "noel-sapin", size: "medium", shape: "round", total: clTotal })[0] === (clTotal === 144 ? "noel-chocolat" : "chocolate-lovers"), "choc lovers classic by price", clTotal);
ok(m.flavourIdsOf(["Chocolate Lovers"], { product: "bento_cake", design: "noel-sapin", size: "medium", shape: "round", total: 144 })[0] === "noel-chocolat", "choc lovers edition by price");
ok(m.flavourIdsOf(["Vanilla"], { product: "bento_cake", design: "normal-without-border", size: "bento" })[0] === "vanilla", "normal unchanged");
ok(m.lockReasonOf({ product: "christmas_log" }) === null && m.lockReasonOf({ product: "bento_cake", design: "noel-sapin" }) === null, "unlocked");
ok(m.lockReasonOf({ product: "workshop" }) === "workshop", "workshop still locked");
// signature: row vs editor same
const rowS = { product: "christmas_log", size: "buche", shape: null, design: "buche-grinch", flavors: ["Lemon curd"], extras: [], candles: [], total: 69 };
ok(m.priceSignature(rowS, true) === m.priceSignature({ ...rowS, flavors: ["noel-lemon-curd"] }, false), "signature stable");
ok(m.itemLabel({ product: "bento_cake", design: "noel-sapin", size: "medium" }) === "Le Sapin de Noël medium", "label");
console.log(`${pass} PASS, ${fail} FAIL`);
if (fail) process.exit(1);
