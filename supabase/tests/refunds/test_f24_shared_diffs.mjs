// F24 phase 0 — écarts des fichiers partagés entre le ZIP et la production,
// pour les 3 fonctions où ChatGPT les a relevés (postfinance-webhook,
// retry-order-side-effects, confirm-workshop-refund) :
//   • invoice-pdf.ts : ligne « Remise / Supplément » (price_adjustment_amount, d0d6b83) ;
//   • email-darkmode.ts : styles des e-mails clients (versions du 16 au 18.09).
// On vérifie ce que ces fonctions EMBARQUENT réellement (esbuild, tree-shaking)
// et que leur résultat est identique à toutes les versions antérieures.
// Aucun réseau, aucun e-mail, aucune base.
//
//   cd supabase/tests/refunds
//   npm install --no-save esbuild
//   node test_f24_shared_diffs.mjs
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SHARED = path.join(ROOT, "functions/_shared");
const FIX = path.join(import.meta.dirname, "fixtures");
let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 700) : ""); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "f24d-"));

// ═══ 1. Ce que les 3 fonctions embarquent ═══════════════════════════════
const external = { name: "ext", setup(b) { b.onResolve({ filter: /^(https?:|npm:|jsr:)/ }, (a) => ({ path: a.path, external: true })); } };
const bundles = {};
const kept = {};
for (const fn of ["postfinance-webhook", "retry-order-side-effects", "confirm-workshop-refund"]) {
  const r = await build({ entryPoints: [path.join(ROOT, `functions/${fn}/index.ts`)], bundle: true, write: false, metafile: true, format: "esm", platform: "neutral", logLevel: "silent", plugins: [external] });
  bundles[fn] = r.outputFiles[0].text;
  const inputs = Object.values(r.metafile.outputs)[0].inputs;
  kept[fn] = Object.fromEntries(Object.entries(inputs).map(([f, v]) => [path.basename(f), v.bytesInOutput]));
  const shared = Object.keys(r.metafile.inputs).filter((f) => f.includes("_shared/")).map((f) => path.basename(f));
  // e-mails clients : envoyés par d'autres fonctions (notify-order, send-order-received-email…), pas embarqués ici.
  check(`${fn} : aucun gabarit d'e-mail client embarqué`, !shared.some((f) => /confirmation-email|cancellation-email/.test(f)), shared);
  check(`${fn} : aucun style client / mobile d'email-darkmode dans le code exécuté`, !/bcs-row-price|bcs-mobile-br|bcs-logo|bcs-card/.test(bundles[fn]));
}
check("postfinance-webhook / retry : email-darkmode sert seulement aux alertes techniques admin (adminDarkModeStyle)",
  ["postfinance-webhook", "retry-order-side-effects"].every((fn) => kept[fn]["email-darkmode.ts"] > 0 && /function adminDarkModeStyle/.test(bundles[fn]) && !/function brandDarkModeStyle/.test(bundles[fn])));
check("confirm-workshop-refund : aucun code d'email-darkmode exécuté", !kept["confirm-workshop-refund"]["email-darkmode.ts"], kept["confirm-workshop-refund"]);
check("postfinance-webhook : ne génère aucune facture (seul areSideEffectsComplete est utilisé)", !/generateInvoicePdf/.test(bundles["postfinance-webhook"]) && !/function runSideEffects/.test(bundles["postfinance-webhook"]));
check("confirm-workshop-refund : ne génère aucune facture", !/generateInvoicePdf/.test(bundles["confirm-workshop-refund"]));
check("retry-order-side-effects : facture seulement via les workshops du site (factures gâteau coupées en phase 0)", /generateInvoicePdf/.test(bundles["retry-order-side-effects"]));

// ═══ 2. email-darkmode : exports utilisés identiques dans toutes les versions ═
const loadTs = async (file, name) => {
  const out = path.join(tmp, `${name}.mjs`);
  await build({ entryPoints: [file], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "error", plugins: [external] });
  return import(out);
};
const cur = await loadTs(path.join(SHARED, "email-darkmode.ts"), "ed-current");
const hist = fs.readdirSync(path.join(FIX, "email-darkmode-history")).filter((f) => f.endsWith(".ts"));
for (const f of hist) {
  const old = await loadTs(path.join(FIX, "email-darkmode-history", f), `ed-${f}`);
  check(`email-darkmode ${f.replace(".ts", "")} : adminDarkModeStyle() identique`, old.adminDarkModeStyle() === cur.adminDarkModeStyle());
  // 622fca4 (16.09, 08:08) était la toute première version, remplacée 50 min plus tard (df753df).
  if (f !== "622fca4.ts") check(`email-darkmode ${f.replace(".ts", "")} : DARKMODE_META_TAGS identique`, old.DARKMODE_META_TAGS === cur.DARKMODE_META_TAGS);
}

// ═══ 3. invoice-pdf : avant / après d0d6b83 ═════════════════════════════
// pdf-lib remplacé par un enregistreur : on compare tout ce qui serait dessiné.
let drawn = [];
fs.writeFileSync(path.join(tmp, "pdf.mjs"), `
const rec = (k) => (...a) => globalThis.__drawn.push([k, JSON.stringify(a)]);
const page = { drawRectangle: rec("rect"), drawText: rec("text"), drawLine: rec("line"), drawImage: rec("img"), getSize: () => ({ width: 595, height: 842 }) };
const font = { widthOfTextAtSize: (t, s) => String(t).length * s * 0.5, heightAtSize: (s) => s };
export const PDFDocument = { create: async () => ({ embedFont: async () => font, embedPng: async () => ({ scale: () => ({ width: 1, height: 1 }), width: 1, height: 1 }), addPage: () => page, save: async () => new Uint8Array([1]) }) };
export const StandardFonts = { Helvetica: "h", HelveticaBold: "hb", HelveticaOblique: "hi" };
export const rgb = (...c) => c;`);
const pdfPlugin = { name: "pdf", setup(b) {
  b.onResolve({ filter: /^npm:pdf-lib/ }, () => ({ path: path.join(tmp, "pdf.mjs") }));
  // l'ancienne version (fixture) importe ses voisins partagés : même dossier que la production
  b.onResolve({ filter: /^\.\// }, (a) => (a.importer.startsWith(FIX) ? { path: path.join(SHARED, a.path) } : undefined));
  b.onResolve({ filter: /^(https?:|npm:|jsr:)/ }, (a) => ({ path: a.path, external: true }));
} };
const loadInvoice = async (file, name) => {
  const out = path.join(tmp, `${name}.mjs`);
  await build({ entryPoints: [file], bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "error", plugins: [pdfPlugin] });
  return import(out);
};
globalThis.Deno = { env: { get: () => undefined } };
globalThis.fetch = async () => new Response("", { status: 404 }); // logo : ignoré
globalThis.__drawn = drawn;
console.error = () => {}; // « logo could not be embedded » attendu (pas de réseau)
const OLD = await loadInvoice(path.join(FIX, "invoice-pdf-before-d0d6b83.ts"), "inv-old");
const NEW = await loadInvoice(path.join(SHARED, "invoice-pdf.ts"), "inv-new");
// Adresse de la société changée le 05.10.2026 (Rue Prévost-Martin 8, 1205 Genève) : l'ancienne copie
// porte encore l'ancienne adresse ; on la remplace dans son rendu pour ne comparer que le reste.
const ADDR_OLD = /58 Chemin de la Gradelle, 1224 (Genève|Geneva)/g;
const render = async (mod, order, items, opts) => { drawn.length = 0; await mod.generateInvoicePdf(order, items, opts); return drawn.map((d) => d.join(" ").replace(ADDR_OLD, (_m, c) => `Rue Prévost-Martin 8, 1205 ${c}`)); };
const base = { lang: "fr", first_name: "Test", last_name: "Client", email: "t@example.com", invoice_number: "INV-2026-0001", created_at: "2026-10-01T10:00:00Z",
  total_amount: 90, delivery_fee: 0, express_surcharge_amount: 0, reward_amount_used: 0, welcome_discount_amount: 0, partner_discount_amount: 0 };
const cake = [{ product: "bento_cake", total: 90, quantity: 1, size: "10cm", flavors: ["vanilla"] }];
const workshop = [{ product: "workshop", total: 65, workshop_type: "paint", workshop_participants: 1, workshop_date: "2026-10-14", workshop_time: "14:00" }];
const cases = [
  ["commande gâteau du site (price_adjustment_amount = 0, valeur par défaut)", { ...base, price_adjustment_amount: 0 }, cake],
  ["commande gâteau, colonne absente de la lecture", { ...base }, cake],
  ["commande workshop du site", { ...base, total_amount: 65, price_adjustment_amount: 0 }, workshop],
  ["commande workshop gardée après refus du gâteau", { ...base, total_amount: 65, price_adjustment_amount: 0 }, [...cake, ...workshop], { mode: "workshop_only_kept", refundedAmount: 90 }],
  ["commande avec livraison et remise cagnotte", { ...base, total_amount: 95, delivery_fee: 15, reward_amount_used: 10, price_adjustment_amount: 0 }, cake],
];
for (const [name, order, items, opts] of cases) {
  const a = await render(OLD, order, items, opts), b = await render(NEW, order, items, opts);
  check(`Facture identique avant / après d0d6b83 : ${name}`, a.length > 10 && JSON.stringify(a) === JSON.stringify(b), { a: a.length, b: b.length });
}
check("Nouvelle adresse sur la facture (FR et EN), plus aucune trace de l'ancienne",
  fs.readFileSync(path.join(SHARED, "invoice-pdf.ts"), "utf8").includes('tr("Rue Prévost-Martin 8, 1205 Geneva", "Rue Prévost-Martin 8, 1205 Genève")')
  && fs.readFileSync(path.join(ROOT, "functions/manage-order/index.ts"), "utf8").includes('tr("Rue Prévost-Martin 8, 1205 Geneva", "Rue Prévost-Martin 8, 1205 Genève")')
  && !/Gradelle/.test(fs.readFileSync(path.join(SHARED, "invoice-pdf.ts"), "utf8") + fs.readFileSync(path.join(ROOT, "functions/manage-order/index.ts"), "utf8")));
// Seul cas différent : un ajustement de prix ≠ 0, posé uniquement par l'éditeur des commandes admin.
const adj = { ...base, total_amount: 80, price_adjustment_amount: -10 };
const a = await render(OLD, adj, cake), b = await render(NEW, adj, cake);
check("Ajustement ≠ 0 (commande admin uniquement) : seule différence = la ligne « Remise »", b.some((t) => t.includes("Remise")) && !a.some((t) => t.includes("Remise")) && b.length > a.length);
// Côté code : seul l'éditeur admin écrit price_adjustment_amount (défaut 0, NOT NULL).
const writers = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith(".ts") && /price_adjustment_amount\s*[:=]/.test(fs.readFileSync(p, "utf8"))) writers.push(path.relative(ROOT, p)); } };
walk(path.join(ROOT, "functions"));
check("price_adjustment_amount n'est écrit que par les fonctions des commandes admin", writers.length > 0 && writers.every((w) => /manual-order|invoice-pdf|cake-order-confirmation-email/.test(w)), writers);
const mig = fs.readFileSync(path.join(ROOT, "migrations/20260928074429_mo1_admin_manual_order_columns.sql"), "utf8");
check("Colonne price_adjustment_amount : NOT NULL DEFAULT 0", /price_adjustment_amount numeric\(10,2\) not null default 0/.test(mig));

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
