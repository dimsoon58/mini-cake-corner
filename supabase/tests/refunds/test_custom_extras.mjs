// F49 (26.11.2026) — Extras libres sur les commandes de l'admin : l'admin
// tape ce que c'est et le prix. Vérifie le devis serveur (prix, détail,
// erreurs, offert), l'enregistrement, la modification d'une commande payée
// (signature de prix, historique), le récapitulatif de paiement, le texte
// des extras du formulaire et l'étiquette. Aucun réseau.
//   node test_custom_extras.mjs   (esbuild installé, voir README)
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const FN = path.join(REPO, "supabase/functions");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "custom-extras-"));
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) { pass++; console.log("PASS", msg); } else { fail++; console.log("FAIL", msg, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ""); } };

// ── Serveur ─────────────────────────────────────────────────────────────
const sEntry = path.join(tmp, "server.ts");
fs.writeFileSync(sEntry, [
  `export { quoteManualOrder, customExtrasOf } from ${JSON.stringify(path.join(FN, "_shared/manual-order-quote.ts"))};`,
  `export { buildItemRow, editorItemOfRow } from ${JSON.stringify(path.join(FN, "manage-manual-order/rows.ts"))};`,
  `export { priceSignature, describeItemChanges, customExtrasTotal } from ${JSON.stringify(path.join(FN, "_shared/order-edit.ts"))};`,
  `export { buildPaymentRecap } from ${JSON.stringify(path.join(FN, "_shared/payment-recap.ts"))};`,
].join("\n"));
await build({ entryPoints: [sEntry], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "s.mjs"), logLevel: "error" });
const S = await import(path.join(tmp, "s.mjs"));
const sb = { rpc: async () => ({ data: [], error: null }) };

const cake = (extra = {}) => ({ product: "bento_cake", size: "medium", shape: "round", design: "normal-without-border", flavors: ["vanilla"], extras: [], candles: [], ...extra });
const quote = (items) => S.quoteManualOrder(sb, { items, fulfillments: [{ date: "2026-12-02", deliveryMethod: "pickup", slot: "14:00 – 15:00", itemIndexes: items.map((_, i) => i) }] });

const base = (await quote([cake()])).items[0];
const two = (await quote([cake({ custom_extras: [{ label: "  Topper   doré ", amount: 12 }, { label: "Paillettes argent", amount: 3.5 }] })])).items[0];
ok(!two.error && two.total === base.total + 15.5, "Devis : 2 extras libres = prix + 12 + 3.50", { base: base.total, two });
const customLines = (two.breakdown ?? []).filter((l) => l.kind === "custom");
ok(customLines.length === 2 && customLines[0].id === "0" && customLines[0].amount === 12 && customLines[1].amount === 3.5, "Devis : une ligne « custom » par extra dans le détail", two.breakdown);
ok(JSON.stringify(S.customExtrasOf(cake({ custom_extras: [{ label: "  Topper   doré ", amount: "12" }] })).extras) === JSON.stringify([{ label: "Topper doré", amount: 12 }]), "Nom nettoyé (espaces), prix en nombre");

for (const [ce, re, msg] of [
  [[{ label: "", amount: 5 }], /Type what the custom extra is/, "nom vide refusé"],
  [[{ label: "X", amount: 0 }], /Enter the price of « X »/, "prix 0 refusé"],
  [[{ label: "X", amount: "abc" }], /Enter the price/, "prix pas un nombre refusé"],
  [[{ label: "X", amount: 501 }], /can't exceed CHF 500/, "prix > 500 refusé"],
  [[{ label: "x".repeat(81), amount: 5 }], /can't exceed 80 characters/, "nom > 80 caractères refusé"],
  [Array.from({ length: 11 }, () => ({ label: "X", amount: 1 })), /At most 10 custom extras/, "plus de 10 extras refusé"],
]) {
  const r = (await quote([cake({ custom_extras: ce })])).items[0];
  ok(r.total === null && re.test(r.error ?? ""), `Devis : ${msg}`, r);
}
ok((await quote([cake({ custom_extras: [{ label: "X", amount: 500 }] })])).items[0].total === base.total + 500, "Devis : 500 accepté");

// Autres produits : aussi possible (bûche de Noël, Dot Cakes…), jamais un workshop.
const log = (await quote([{ product: "christmas_log", size: "buche", design: "buche-grinch", flavors: ["noel-mangue-passion"], extras: [], candles: [] }])).items[0];
const logX = (await quote([{ product: "christmas_log", size: "buche", design: "buche-grinch", flavors: ["noel-mangue-passion"], extras: [], candles: [], custom_extras: [{ label: "Carte", amount: 4 }] }])).items[0];
ok(!logX.error && logX.total === log.total + 4, "Devis : extra libre sur une bûche", { log, logX });
ok(S.customExtrasOf({ product: "workshop", custom_extras: [{ label: "X", amount: 5 }] }).amount === 0, "Workshop : extras libres ignorés");

// Fruits + extra libre + offert.
const fruitX = (await quote([cake({ fruit_supplement: 10, custom_extras: [{ label: "Topper", amount: 12 }] })])).items[0];
ok(fruitX.total === base.total + 22, "Devis : fruits 10 + extra 12 s'additionnent", fruitX);
const freeX = (await quote([cake({ custom_extras: [{ label: "Topper", amount: 12 }], free_options: ["custom:0"] })])).items[0];
ok(freeX.total === base.total && freeX.freeAmount === 12 && freeX.freeOptions?.[0] === "custom:0", "Offert : un extra libre peut être offert", freeX);

// ── Enregistrement ─────────────────────────────────────────────────────
const it = cake({ custom_extras: [{ label: " Topper doré ", amount: 12 }] });
const q = (await quote([it])).items[0];
const row = S.buildItemRow(it, q, "o1", "f1");
ok(row.total === base.total + 12, "Ligne enregistrée : total avec l'extra", row.total);
ok(JSON.stringify(row.custom_extras) === JSON.stringify([{ label: "Topper doré", amount: 12 }]), "Ligne enregistrée : custom_extras nettoyés", row.custom_extras);
ok(S.buildItemRow(cake(), base, "o1", "f1").custom_extras === null, "Ligne enregistrée : NULL sans extra libre");
const back = S.editorItemOfRow({ ...row, id: "r1" }, ["vanilla"]);
ok(back.custom_extras.length === 1 && back.custom_extras[0].label === "Topper doré", "Relecture dans l'éditeur", back.custom_extras);

// ── Modification d'une commande payée ──────────────────────────────────
const sigRow = S.priceSignature({ ...row, flavors: ["Vanilla"] }, true);
ok(sigRow === S.priceSignature({ ...it, custom_extras: [{ label: "Topper doré", amount: 12 }] }, false), "Même extra = même signature (prix gardé)");
ok(sigRow !== S.priceSignature({ ...it, custom_extras: [{ label: "Topper doré", amount: 15 }] }, false), "Prix changé = signature différente");
ok(sigRow !== S.priceSignature({ ...it, custom_extras: [] }, false), "Extra retiré = signature différente");
ok(S.customExtrasTotal([{ label: "a", amount: 12 }, { label: "b", amount: "3.5" }]) === 15.5, "Somme des extras enregistrés");
const hist = S.describeItemChanges(0, { ...row, flavors: ["Vanilla"] }, { ...it, custom_extras: [{ label: "Topper doré", amount: 15 }] });
ok(/extras libres Topper doré CHF 12\.00 → Topper doré CHF 15\.00/.test(hist ?? ""), "Historique : « extras libres A CHF 12.00 → A CHF 15.00 »", hist);
ok(S.describeItemChanges(0, { ...row, flavors: ["Vanilla"] }, { ...it, custom_extras: [{ label: "Topper doré", amount: 12 }] }) === null, "Historique : rien si inchangé");

// ── Récapitulatif de paiement ──────────────────────────────────────────
const recap = S.buildPaymentRecap({ lang: "fr", total_amount: row.total }, [{ ...row, id: "r1", production_status: "to_assign" }], []);
ok(JSON.stringify(recap).includes("Topper doré CHF 12.00 compris"), "Récap paiement : « Topper doré CHF 12.00 compris »", recap);

// ── Site (admin) ───────────────────────────────────────────────────────
const fEntry = path.join(tmp, "front.ts");
fs.writeFileSync(fEntry, `export * from "@/lib/manualOrders";\nexport { buildCakeLabels } from "@/lib/productionLabels";`);
const empty = Object.fromEntries([".jpg", ".jpeg", ".png", ".webp", ".svg", ".mp4", ".mov", ".gif"].map((e) => [e, "empty"]));
await build({ entryPoints: [fEntry], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "f.mjs"), logLevel: "error",
  alias: { "@": path.join(REPO, "src") }, loader: empty, define: { "import.meta.env": "{}" } });
const M = await import(path.join(tmp, "f.mjs"));
const ed = { ...M.emptyItem("bento_cake"), size: "medium", extras: ["gold-leaves"], custom_extras: [{ label: " Topper  doré ", amount: "12" }, { label: "", amount: "" }] };
const ef = M.extraFields(ed);
ok(ef.extra === "Gold Leaves, Topper doré", "Texte des extras : catalogue + extra libre (vides ignorés)", ef.extra);
const dot = M.extraFields({ ...M.emptyItem("dot_cakes"), custom_extras: [{ label: "Boîte cadeau", amount: "5" }] });
ok(dot.extra === "Boîte cadeau", "Texte des extras : aussi pour un produit sans extras du catalogue", dot.extra);
ok(M.labelBreakdownLine({ kind: "custom", id: "0", amount: 12 }, null, "fr", "medium", ed.custom_extras) === "Extra : Topper  doré", "Détail du prix : « Extra : <nom> »");
ok(M.friendlyMessage("Item 1: Enter the price of « Topper »", "fr").includes("Indiquez le prix de chaque extra libre"), "Message d'erreur traduit");

// Étiquette : le nom, jamais le prix.
if (typeof M.buildCakeLabels === "function") {
  const src = { id: "i1", order_id: "o1", product: "bento_cake", size: "medium", shape: "round", flavors: ["Vanilla"], design: "normal-without-border",
    base_color: null, decoration_color: null, inside_color: null, ribbon_color: null, butterfly_color: null, extra: "Gold Leaves, Topper doré",
    custom_extras: [{ label: "Topper doré" }], cake_text: null, text_color: null, text_style: null, item_comment: null, quantity: 1, created_at: null, date: "2026-12-02",
    order: { id: "o1", order_number: "ORD-1", first_name: "A", last_name: "B" } };
  let labels;
  try { labels = M.buildCakeLabels([src]); } catch (e) { labels = { error: String(e) }; }
  const deco = Array.isArray(labels) ? labels[0]?.decoType : null;
  ok(typeof deco === "string" && deco.includes("Topper doré") && !deco.includes("12"), "Étiquette : « Déco » contient le nom de l'extra libre, sans prix", labels);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
