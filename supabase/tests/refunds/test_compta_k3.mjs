// Compta, lot K3 — migration F12 (remboursement des avances personnelles)
// + vraie fonction manage-expenses + vrai export Excel du site. Base locale
// PGlite = schéma de production + F1–F12. Ne se connecte jamais à Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_compta_k3.mjs
import { freshDb, salesStub } from "./load.mjs";
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

process.on("unhandledRejection", (e) => { console.log("ERROR:", e?.message, e?.where ?? ""); process.exit(2); });

const ROOT = path.resolve(import.meta.dirname, "../..");
const REPO = path.resolve(ROOT, "..");
const MIG = path.join(ROOT, "migrations");
const migrations = fs.readdirSync(MIG).filter((f) => /^20261002(09|10|11|12|13|14|16|17)/.test(f)).sort().map((f) => path.join(MIG, f));
const F12 = migrations.find((f) => f.includes("_f12_"));

let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra) : ""); } };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

const db = await freshDb({ migrations });
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

// ── Vraies fonctions (esbuild) ───────────────────────────────────────────
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x", ADMIN_ORDER_PIN: "1234" })[k] } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "k3-"));
globalThis.__storage = [];
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), `export function createClient() { return {
  auth: { getUser: async (j) => ({ data: { user: j === "admin-jwt" ? { email: "naglemelodie@gmail.com" } : j === "client-jwt" ? { email: "x@y.ch" } : null }, error: null }) },
  rpc: (fn, args) => globalThis.__rpc(fn, args),
  storage: { from: (bucket) => ({
    createSignedUploadUrl: async (p) => { globalThis.__storage.push({ op: "upload", bucket, path: p }); return { data: { token: "tok", path: p }, error: null }; },
    createSignedUrl: async (p, s) => { globalThis.__storage.push({ op: "sign", bucket, path: p, seconds: s }); return { data: { signedUrl: "https://signed.test/" + bucket + "/" + p + "?exp=" + s }, error: null }; },
  }) } }; }`);
const plugins = [{ name: "m", setup(b) {
  b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
  b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
} }];
globalThis.__rpc = async (fn, args) => {
  const ks = Object.keys(args ?? {});
  try {
    const res = await db.query(`select * from public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(", ")})`, ks.map((k) => args[k]));
    const cols = res.fields.map((f) => f.name);
    return { data: cols.length === 1 && cols[0] === fn ? (res.rows[0]?.[fn] ?? null) : res.rows, error: null };
  } catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
};
const handlers = {};
for (const name of ["manage-expenses", "finance-month"]) {
  await build({ entryPoints: [path.join(ROOT, `functions/${name}/index.ts`)], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, `${name}.mjs`), logLevel: "warning", plugins });
  await import(path.join(tmp, `${name}.mjs`));
  handlers[name] = globalThis.__handler;
}
const invoke = async (name, body, jwt = "admin-jwt") => {
  const r = await handlers[name](new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
};
const call = (body, jwt) => invoke("manage-expenses", body, jwt);

// ── Export Excel / ZIP : vrai code du site, assemblé pour Node ───────────
fs.writeFileSync(path.join(tmp, "client.mjs"), "export const supabase = {};");
await build({
  entryPoints: [path.join(REPO, "src/lib/comptaExport.ts")], bundle: true, format: "esm", platform: "node",
  outfile: path.join(tmp, "cx.mjs"), logLevel: "warning", external: ["exceljs"],
  loader: { ".png": "empty", ".jpg": "empty", ".jpeg": "empty", ".webp": "empty", ".svg": "empty", ".gif": "empty" },
  nodePaths: [path.join(REPO, "node_modules")],
  plugins: [{ name: "alias", setup(b) {
    b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: path.join(tmp, "client.mjs") }));
    b.onResolve({ filter: /^@\// }, async (a) => {
      const base = path.join(REPO, "src", a.path.slice(2));
      for (const ext of ["", ".ts", ".tsx", "/index.ts"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return { path: base + ext };
      return { path: base };
    });
  } }],
});
const CX = await import(path.join(tmp, "cx.mjs"));
const ExcelJS = (await import(path.join(REPO, "node_modules/exceljs/excel.js"))).default;
const JSZip = (await import(path.join(REPO, "node_modules/jszip/lib/index.js"))).default;

// ── Données ─────────────────────────────────────────────────────────────
const settings = (await call({ action: "settings" })).body.data;
const cat = (name) => settings.categories.find((c) => c.name === name).id;
const payer = (slug) => settings.payers.find((p) => p.slug === slug).id;
const MEL = payer("mel"), ELI = payer("elie"), NAHYA = payer("nahya"), BENTO = payer("bento");
let keyN = 0;
const saveExpense = (fields) => call({ action: "save", idempotencyKey: `e-${++keyN}`, status: "paid", receiptMissingReason: "test", categoryId: cat("Emballages et décorations"), currency: "CHF", ...fields });
const period = async (from, to) => (await call({ action: "period", from, to })).body.data;
const ov = async (m) => (await call({ action: "advances_overview", month: m })).body.data;
const person = async (m, name) => (await ov(m)).people.find((p) => p.name === name);
const repay = (payerId, paidAt, allocations, extra = {}) => call({ action: "advance_repay", idempotencyKey: `r-${++keyN}`, payerId, paidAt, method: "transfer", allocations, ...extra });
const SEP = ["2026-09-01", "2026-09-30"], OCT = ["2026-10-01", "2026-10-31"], NOV = ["2026-11-01", "2026-11-30"];
let r;

// ═══ Accès ═══
check("Accès : sans connexion → 401", (await call({ action: "advances_overview", month: "2026-10" }, null)).status === 401);
check("Accès : non admin → 401", (await call({ action: "advance_repay", payerId: MEL }, "client-jwt")).status === 401);
check("Tables fermées à anon / authenticated", (await one("select count(*)::int n from information_schema.role_table_grants where table_schema='public' and table_name like 'advance%' and grantee in ('anon','authenticated')")).n === 0);

// ═══ Avances et dépenses ═══
const melSep = (await saveExpense({ purchaseDate: "2026-09-20", supplier: "Manor", originalAmount: "100", paidAt: "2026-09-20", payerId: MEL, personalAdvance: true })).body.data;
await saveExpense({ purchaseDate: "2026-10-02", supplier: "Migros", originalAmount: "50", paidAt: "2026-10-02", payerId: BENTO });
const eli1 = (await saveExpense({ purchaseDate: "2026-10-03", supplier: "Landi", originalAmount: "80", paidAt: "2026-10-03", payerId: ELI, personalAdvance: true })).body.data;
const eli2 = (await saveExpense({ purchaseDate: "2026-10-04", supplier: "Coop", originalAmount: "20", paidAt: "2026-10-04", payerId: ELI, personalAdvance: true })).body.data;
const eliUsd = (await saveExpense({ purchaseDate: "2026-10-05", supplier: "AliExpress", currency: "USD", originalAmount: "15", chfAmount: "", paidAt: "2026-10-05", payerId: ELI, personalAdvance: true })).body.data;
const nahyaAdv = (await saveExpense({ purchaseDate: "2026-10-06", supplier: "Pharmacie", originalAmount: "30", paidAt: "2026-10-06", payerId: NAHYA, personalAdvance: true })).body.data;
const melToPay = (await saveExpense({ purchaseDate: "2026-10-07", supplier: "Imprimeur", originalAmount: "45", status: "to_pay", payerId: MEL, personalAdvance: true })).body.data;
const bentoExp = (await one("select id from public.expenses where supplier='Migros'")).id;
const sepBefore = (await period(...SEP)).totals, octBefore = (await period(...OCT)).totals, novBefore = (await period(...NOV)).totals;
check("Avances comptées une fois dans les dépenses (sept. 100 ; oct. 50+80+20+30+45 = 225)", sepBefore.engaged.known === 100 && octBefore.engaged.known === 225 && sepBefore.engaged.advances === 100, { sep: sepBefore.engaged, oct: octBefore.engaged });

const melOct0 = await person("2026-10", "Mel");
check("Avance encore « À payer » (fournisseur pas payé) : visible, hors « reste à rembourser »", melOct0.advances.find((x) => x.id === melToPay.id).state === "supplier_unpaid" && melOct0.openEnd === 100 && melOct0.newInMonth === 0, melOct0);

// ═══ Remboursement partiel puis report ═══
r = await repay(MEL, "2026-10-05", [{ expenseId: melSep.id, amount: "40" }], { reference: "E-banking 05.10", idempotencyKey: "same-key" });
const r2 = await call({ action: "advance_repay", idempotencyKey: "same-key", payerId: MEL, paidAt: "2026-10-05", allocations: [{ expenseId: melSep.id, amount: "40" }] });
check("Remboursement partiel de 40 (double clic → un seul)", r.status === 200 && r.body.data.code.startsWith("REMB-") && r2.body.data.replayed === true && (await one("select count(*)::int n from public.advance_repayments")).n === 1, r.body);
let mel = await person("2026-10", "Mel");
let a = mel.advances.find((x) => x.id === melSep.id);
check("Octobre : début 100, remboursé 40, fin 60 ; avance « reportée », partiellement remboursée", mel.openStart === 100 && mel.repaidInMonth === 40 && mel.openEnd === 60 && a.carried_over && a.state === "partly_repaid" && a.remaining_now === 60, mel);
check("Le remboursement ne crée AUCUNE deuxième dépense (septembre et octobre inchangés)",
  JSON.stringify((await period(...SEP)).totals.engaged) === JSON.stringify(sepBefore.engaged) && JSON.stringify((await period(...OCT)).totals.engaged) === JSON.stringify(octBefore.engaged)
  && JSON.stringify((await period(...OCT)).totals.paid) === JSON.stringify(octBefore.paid));
check("La dépense de l'avance indique le remboursé et le reste", (await period(...SEP)).expenses.find((e) => e.id === melSep.id).advance.remaining === 60);
mel = await person("2026-11", "Mel");
check("Novembre : 60 reportés en début de mois, sans nouvelle déduction", mel.openStart === 60 && mel.advances.find((x) => x.id === melSep.id).carried_over && JSON.stringify((await period(...NOV)).totals.engaged) === JSON.stringify(novBefore.engaged));
r = await repay(MEL, "2026-11-10", [{ expenseId: melSep.id, amount: "70" }]);
check("Rembourser plus que le reste (70 > 60) → refus", r.status === 409, r.body);
r = await repay(MEL, "2026-11-10", [{ expenseId: melSep.id, amount: "60" }]);
mel = await person("2026-11", "Mel");
check("Solde de 60 le 10.11 : avance remboursée, fin de mois 0", r.status === 200 && mel.advances.find((x) => x.id === melSep.id).state === "settled" && mel.openEnd === 0 && mel.repaidInMonth === 60);
r = await repay(MEL, "2026-11-11", [{ expenseId: melSep.id, amount: "1" }]);
check("Avance déjà remboursée : ne peut plus être proposée ni remboursée", r.status === 409 && /entièrement/.test(r.body.error));
check("Décembre : l'avance soldée n'apparaît plus", !(await person("2026-12", "Mel")).advances.some((x) => x.id === melSep.id));

// ═══ Un remboursement pour plusieurs avances ═══
r = await repay(ELI, "2026-10-20", [{ expenseId: eli1.id, amount: "80" }, { expenseId: eli2.id, amount: "20" }], { reference: "TWINT" });
let eli = await person("2026-10", "Eli");
check("Un virement de 100 pour deux avances d'Eli : deux affectations, les deux soldées", r.status === 200 && r.body.data.total === 100 && eli.advances.filter((x) => x.state === "settled").length === 2 && (await ov("2026-10")).repayments.find((x) => x.code === r.body.data.code).allocations.length === 2);
check("Avance d'Eli au montant inconnu : listée, non remboursable", eli.unknownCount === 1 && eli.advances.find((x) => x.id === eliUsd.id).state === "unknown_amount");
r = await repay(ELI, "2026-10-21", [{ expenseId: eliUsd.id, amount: "10" }]);
check("Rembourser une avance au montant CHF inconnu → refus", r.status === 409 && /montant CHF inconnu/.test(r.body.error));
r = await repay(MEL, "2026-10-21", [{ expenseId: melToPay.id, amount: "10" }]);
check("Rembourser une avance encore « À payer » → refus", r.status === 409, r.body);
r = await repay(MEL, "2026-10-21", [{ expenseId: eli1.id, amount: "1" }]);
check("Rembourser à Mel une avance d'Eli → refus", r.status === 409, r.body);
r = await repay(BENTO, "2026-10-21", [{ expenseId: bentoExp, amount: "1" }]);
check("Remboursement au compte Bento → refus", r.status === 409, r.body);
r = await repay(ELI, "2026-10-21", [{ expenseId: eliUsd.id, amount: "1" }, { expenseId: eliUsd.id, amount: "1" }]);
check("Même avance deux fois dans un remboursement → refus", r.status === 409, r.body);
r = await repay(ELI, "2026-10-21", []);
check("Remboursement sans avance → refus", r.status === 400, r.body);

// ═══ Nahya ═══
r = await repay(NAHYA, "2026-10-25", [{ expenseId: nahyaAdv.id, amount: "30" }]);
const nahya = await person("2026-10", "Nahya");
check("Nahya remboursée de son avance (salariée, hors répartition)", r.status === 200 && nahya.kind === "employee" && nahya.openEnd === 0);

// ═══ Garde-fous sur une avance déjà remboursée ═══
r = await call({ action: "delete", id: eli1.id, reason: "test" });
check("Supprimer une avance remboursée → refus", r.status === 409 && /annulez d'abord/.test(r.body.error), r.body);
const base = { purchaseDate: "2026-10-03", supplier: "Landi", currency: "CHF", originalAmount: "80", status: "paid", paidAt: "2026-10-03", categoryId: cat("Emballages et décorations"), receiptMissingReason: "test" };
r = await call({ action: "save", id: eli1.id, ...base, payerId: MEL, personalAdvance: true });
check("Changer la personne d'une avance remboursée → refus", r.status === 409);
r = await call({ action: "save", id: eli1.id, ...base, payerId: ELI, personalAdvance: false });
check("Retirer la case « avance » d'une avance remboursée → refus", r.status === 409);
r = await call({ action: "save", id: eli1.id, ...base, currency: "EUR", originalAmount: "80", chfAmount: "", payerId: ELI, personalAdvance: true });
check("Effacer le montant CHF d'une avance remboursée → refus", r.status === 409);
r = await call({ action: "save", id: eli1.id, ...base, originalAmount: "70", payerId: ELI, personalAdvance: true });
eli = await person("2026-10", "Eli");
check("Montant corrigé à la baisse (80 → 70) : accepté, « trop remboursé » de 10 signalé, rien d'automatique", r.status === 200 && eli.overpaid === 10 && eli.advances.find((x) => x.id === eli1.id).state === "overpaid");

// ═══ Correction : annulation tracée ═══
const melRep = (await ov("2026-11")).repayments.find((x) => x.payer_name === "Mel");
r = await call({ action: "advance_void_repayment", id: melRep.id, reason: "" });
check("Annuler sans raison → refus", r.status === 409);
r = await call({ action: "advance_void_repayment", id: melRep.id, reason: "virement refusé par la banque" });
mel = await person("2026-11", "Mel");
check("Remboursement annulé : reste rétabli (60), non compté", r.status === 200 && mel.openEnd === 60 && mel.repaidInMonth === 0 && (await ov("2026-11")).totals.repaidInMonth === 0);
check("… toujours visible, marqué annulé (rien n'est effacé)", (await ov("2026-11")).repayments.find((x) => x.id === melRep.id).voided_at !== null);
r = await call({ action: "advance_void_repayment", id: melRep.id, reason: "x" });
check("Annuler deux fois → refus", r.status === 404);
const hist = (await call({ action: "history", table: "advance_repayments", id: melRep.id })).body.data;
check("Historique : création puis annulation avec l'auteur", hist.length === 2 && hist[0].after.void_reason === "virement refusé par la banque" && hist[0].actor === "naglemelodie@gmail.com", hist);
r = await repay(MEL, "2026-11-15", [{ expenseId: melSep.id, amount: "60" }]);
check("Après annulation, l'avance redevient remboursable", r.status === 200 && (await person("2026-11", "Mel")).openEnd === 0);

// ═══ Toujours aucune deuxième dépense ═══
check("Après tous les remboursements : dépenses de septembre et novembre inchangées", JSON.stringify((await period(...SEP)).totals.engaged) === JSON.stringify(sepBefore.engaged) && JSON.stringify((await period(...NOV)).totals) === JSON.stringify(novBefore));
const octNow = (await period(...OCT)).totals.engaged;
check("Octobre : seule la correction 80 → 70 change l'engagé (225 → 215), jamais les remboursements", octNow.known === 215, octNow);

// ═══ Excel ═══
const finance = (await invoke("finance-month", { month: "2026-10" })).body.data;
const wb = CX.buildComptaWorkbook(ExcelJS, salesStub(finance), finance, await period(...OCT), null, await ov("2026-10"));
const file = path.join(tmp, "k3.xlsx");
await wb.xlsx.writeFile(file);
const rb = new ExcelJS.Workbook(); await rb.xlsx.readFile(file);
check("Excel : feuille « Avances et remboursements »", rb.worksheets.map((w) => w.name).includes("Avances et remboursements"));
const W = rb.getWorksheet("Avances et remboursements");
const findRow = (ws, label, col = 1) => { let row = null; ws.eachRow((y) => { if (String(y.getCell(col).value ?? "").startsWith(label)) row = y; }); return row; };
const val = (c) => (c.value && typeof c.value === "object" && "result" in c.value ? c.value.result : c.value);
const melRow = findRow(W, melSep.code, 2);
check("Avance de Mel : 100, remboursé avant 0, dans le mois 40, reste fin de mois en formule (60), « reportée »",
  melRow.getCell(5).value === 100 && melRow.getCell(7).value === 40 && melRow.getCell(8).value.formula === `E${melRow.number}-F${melRow.number}-G${melRow.number}` && val(melRow.getCell(8)) === 60 && /reportée/.test(melRow.getCell(9).value));
const S = rb.getWorksheet("Synthèse");
const repaid = findRow(S, "Remboursé aux personnes dans le mois");
check("Synthèse : remboursé en octobre = 40 + 100 + 30 = 170, en formule, hors dépenses", val(repaid.getCell(2)) === 170 && String(repaid.getCell(2).value.formula).includes("'Avances et remboursements'!"));
check("Synthèse : dépenses engagées toujours 215 (remboursements non ajoutés)", val(findRow(S, "Engagé (date d'achat").getCell(2)) === 215);
check("Contrôle « remboursements = affectations » OK", val(findRow(W, "Contrôle").getCell(2)) === "OK");
check("Dossier INCOMPLET : avance au montant inconnu et trop-remboursé signalés", /montant CHF de l'avance à saisir/.test(findRow(S, "INCOMPLET").getCell(1).value) && /trop remboursée/.test(findRow(S, "INCOMPLET").getCell(1).value));

// ═══ Compatibilité, garde-fous ═══
r = await saveExpense({ purchaseDate: "2026-10-12", supplier: "Test", originalAmount: "5", paidAt: "2026-10-12", payerId: BENTO });
check("Actions K1 inchangées", r.status === 200);
check("Salaire (K2) toujours lisible", (await call({ action: "salary_overview", month: "2026-10" })).status === 200);
check("Aucun appel externe (Make, e-mail)", (await one("select count(*)::int n from net._calls")).n === 0);
const before = await one("select (select count(*) from public.advance_repayments) r, (select count(*) from public.advance_repayment_allocations) a, (select string_agg(coalesce(voided_at::text,'-'), ',' order by code) from public.advance_repayments) v");
await db.exec(fs.readFileSync(F12, "utf8"));
const after = await one("select (select count(*) from public.advance_repayments) r, (select count(*) from public.advance_repayment_allocations) a, (select string_agg(coalesce(voided_at::text,'-'), ',' order by code) from public.advance_repayments) v");
check("Relance de F12 : rien n'est modifié", JSON.stringify(before) === JSON.stringify(after));

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
