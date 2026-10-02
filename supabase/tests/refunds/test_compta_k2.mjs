// Compta, lot K2 (version simplifiée) — migration F11 (salaire mensuel de
// Nahya : prévu / confirmé / versé) + vraie fonction manage-expenses + vrai
// export Excel / ZIP du site. Base locale PGlite = schéma de production +
// F1–F11. Ne se connecte jamais à Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_compta_k2.mjs
import { freshDb } from "./load.mjs";
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

process.on("unhandledRejection", (e) => { console.log("ERROR:", e?.message, e?.where ?? ""); process.exit(2); });

const ROOT = path.resolve(import.meta.dirname, "../..");
const REPO = path.resolve(ROOT, "..");
const MIG = path.join(ROOT, "migrations");
const migrations = fs.readdirSync(MIG).filter((f) => /^20261002(09|10|11|12|13|14|16)/.test(f)).sort().map((f) => path.join(MIG, f));
const F11 = migrations.find((f) => f.includes("_f11_compta_salary"));

let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra) : ""); } };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

const db = await freshDb({ migrations });
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

// ── Vraies fonctions (esbuild) ───────────────────────────────────────────
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x", ADMIN_ORDER_PIN: "1234" })[k] } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "k2-"));
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
const NAHYA = (await one("select public.team_member_id('nahya') id")).id;
const ELI = (await one("select public.team_member_id('elie') id")).id;
let keyN = 0;
const saveExpense = (fields) => call({ action: "save", idempotencyKey: `e-${++keyN}`, status: "paid", ...fields });
const period = async (from, to) => (await call({ action: "period", from, to })).body.data;
const ov = async (m) => (await call({ action: "salary_overview", month: m })).body.data;
const monthOf = async (m) => (await ov(m)).members[0].months.find((x) => x.salary_month === `${m}-01`);
const OCT = ["2026-10-01", "2026-10-31"];
let r, x;

// ═══ Accès ═══
check("Accès : sans connexion → 401", (await call({ action: "salary_overview", month: "2026-10" }, null)).status === 401);
check("Accès : non admin → 401", (await call({ action: "salary_add_payment", monthId: NAHYA }, "client-jwt")).status === 401);
check("Tables salaire fermées à anon / authenticated", (await one("select count(*)::int n from information_schema.role_table_grants where table_schema='public' and table_name like 'salary%' and grantee in ('anon','authenticated')")).n === 0);

// ═══ Mois du contrat (septembre compris), rien d'inventé ═══
let o = await ov("2026-10");
const months = o.members[0].months;
check("Mois de salaire créés pour le contrat : 09, 10, 11, 12.2026 (septembre compris)", months.map((m) => m.code).join() === "SAL-2026-09-NAHYA,SAL-2026-10-NAHYA,SAL-2026-11-NAHYA,SAL-2026-12-NAHYA", months.map((m) => m.code));
check("Seule Nahya a un salaire (Eli non)", o.members.length === 1 && o.members[0].name === "Nahya");
check("Sans montant saisi : prévu et confirmé « à saisir » (null, jamais 0)", months.every((m) => m.planned === null && m.confirmed_net === null && m.status === "to_confirm" && m.remaining === null));
check("Totaux du mois : prévu et confirmé null (pas 0)", o.totals.plannedForMonth === null && o.totals.confirmedForMonth === null && o.totals.toConfirmCount === 1);
check("Aucun mois proposé en plus (contrat inchangé)", o.members[0].proposedMonths.length === 0);

// ═══ Montant prévu récurrent, changeable à partir d'un mois ═══
r = await call({ action: "salary_set_rate", memberId: NAHYA, fromMonth: "2026-09", amount: "1700" });
check("Net prévu 1700 à partir de septembre", r.status === 200 && (await ov("2026-10")).members[0].months.every((m) => m.planned === 1700));
r = await call({ action: "salary_set_rate", memberId: NAHYA, fromMonth: "2026-11", amount: "1750" });
const ms = (await ov("2026-10")).members[0].months;
check("Nouveau montant 1750 à partir de novembre : septembre et octobre gardent 1700", ms.map((m) => m.planned).join() === "1700,1700,1750,1750", ms.map((m) => m.planned));
check("Aucun prorata automatique (septembre prévu = 1700)", ms[0].planned === 1700);
check("Le montant prévu ne crée ni net confirmé ni versement", ms.every((m) => m.confirmed_net === null && m.paid === 0 && m.status === "to_confirm"));
r = await call({ action: "salary_set_rate", memberId: ELI, fromMonth: "2026-10", amount: "100" });
check("Montant prévu pour Eli → refus (pas salariée)", r.status === 409);

// ═══ Net confirmé depuis le décompte ═══
const oct = await monthOf("2026-10");
r = await call({ action: "salary_confirm", id: oct.id, net: "1689.40" });
x = await monthOf("2026-10");
check("Net d'octobre confirmé 1689.40 (≠ prévu 1700, séparés) : « À payer »", r.status === 200 && x.confirmed_net === 1689.4 && x.planned === 1700 && x.status === "to_pay" && x.remaining === 1689.4 && x.paid === 0);
check("Confirmer n'enregistre aucun versement (aucun « payé » automatique)", x.payments.length === 0 && (await ov("2026-10")).totals.paidInMonth === 0);
const sep = await monthOf("2026-09");
await call({ action: "salary_confirm", id: sep.id, net: "113.30" });
check("Septembre : montant confirmé saisi tel quel (113.30), pas de prorata", (await monthOf("2026-09")).confirmed_net === 113.3);

// ═══ Plusieurs versements, chacun daté ═══
r = await call({ action: "salary_add_payment", idempotencyKey: "v1", monthId: oct.id, paidAt: "2026-10-25", amount: "1000", method: "transfer", reference: "E-banking" });
const r2 = await call({ action: "salary_add_payment", idempotencyKey: "v1", monthId: oct.id, paidAt: "2026-10-25", amount: "1000" });
x = await monthOf("2026-10");
check("1er versement 1000 le 25.10 (double clic → un seul)", r.status === 200 && r2.body.data.replayed === true && x.payments.length === 1 && x.paid === 1000 && x.remaining === 689.4 && x.status === "partly_paid");
r = await call({ action: "salary_add_payment", idempotencyKey: "v2", monthId: oct.id, paidAt: "2026-11-02", amount: "700" });
check("Versement au-delà du reste (700 > 689.40) → refus", r.status === 409, r.body);
r = await call({ action: "salary_add_payment", idempotencyKey: "v3", monthId: oct.id, paidAt: "2026-11-02", amount: "689.40" });
x = await monthOf("2026-10");
check("2e versement 689.40 le 02.11 : total versé 1689.40, reste 0, « Payé »", x.paid === 1689.4 && x.remaining === 0 && x.status === "paid" && x.payments.map((p) => p.paid_at).join() === "2026-10-25,2026-11-02");
o = await ov("2026-10");
const oNov = await ov("2026-11");
check("Versements comptés à leur date : 1000 en octobre, 689.40 en novembre", o.totals.paidInMonth === 1000 && oNov.totals.paidInMonth === 689.4);
check("Mois de salaire ≠ mois de versement : octobre reste le mois de salaire", oNov.paymentsInMonth[0].month_code === "SAL-2026-10-NAHYA");
const nov = await monthOf("2026-11");
r = await call({ action: "salary_add_payment", idempotencyKey: "v4", monthId: nov.id, paidAt: "2026-11-20", amount: "500" });
x = await monthOf("2026-11");
check("Versement avant confirmation du net : accepté, reste « net à confirmer » (null)", r.status === 200 && x.paid === 500 && x.remaining === null && x.status === "to_confirm");
const dec = await monthOf("2026-12");
await call({ action: "salary_confirm", id: dec.id, net: "1750" });
check("Décembre confirmé, aucun versement saisi : « À payer », jamais payé automatiquement", (await monthOf("2026-12")).status === "to_pay" && (await monthOf("2026-12")).paid === 0);

// ═══ Le salaire n'est jamais une dépense ═══
let p = await period(...OCT);
check("Aucun total de dépenses ne contient le salaire", p.totals.engaged.known === 0 && p.totals.paid.known === 0 && p.expenses.length === 0);
r = await saveExpense({ purchaseDate: "2026-10-31", supplier: "Caisse AVS", categoryId: cat("Charges sociales"), currency: "CHF", originalAmount: "250", paidAt: "2026-10-31", payerId: payer("bento"), receiptMissingReason: "x" });
p = await period(...OCT);
check("Charges sociales saisies à la main : dépense normale, comptée une fois", p.totals.engaged.known === 250 && p.expenses[0].counted === true && p.expenses[0].salary_to_reconcile === false);

// ═══ Ancienne dépense « Salaires » : comptée tant qu'elle n'est pas rapprochée ═══
r = await saveExpense({ purchaseDate: "2026-09-30", supplier: "Nahya", description: "Salaire septembre", categoryId: cat("Salaires"), currency: "CHF", originalAmount: "113.30", paidAt: "2026-10-01", payerId: payer("bento"), receiptMissingReason: "virement" });
const oldSal = r.body.data;
let sepP = await period("2026-09-01", "2026-09-30");
let row = sepP.expenses.find((e) => e.id === oldSal.id);
check("Dépense « Salaires » non rapprochée : RESTE comptée dans les dépenses, signalée", row.counted === true && row.salary_to_reconcile === true && sepP.totals.engaged.known === 113.3 && sepP.totals.salary.toReconcileCount === 1);
check("… listée à rapprocher dans l'onglet Salaire", (await ov("2026-09")).expensesToReconcile.some((e) => e.id === oldSal.id));
const oct2 = await monthOf("2026-10");
r = await call({ action: "salary_reconcile_expense", expenseId: oldSal.id, paymentId: oct2.payments[0].id });
check("Rapprochement avec un versement d'un autre montant → refus", r.status === 409, r.body);
r = await call({ action: "salary_reconcile_expense", expenseId: oldSal.id, monthId: sep.id, idempotencyKey: "rec-1" });
const created = r.body.data;
sepP = await period("2026-09-01", "2026-09-30");
row = sepP.expenses.find((e) => e.id === oldSal.id);
x = await monthOf("2026-09");
check("Rapprochée (versement créé depuis la dépense) : sort des dépenses…", r.status === 200 && row.counted === false && row.salary_payment.code === created.paymentCode && sepP.totals.engaged.known === 0);
check("… et compte une seule fois, comme versement de septembre (date de la dépense)", x.paid === 113.3 && x.status === "paid" && x.payments[0].paid_at === "2026-10-01" && x.payments[0].expense.id === oldSal.id);
r = await call({ action: "salary_delete_payment", id: x.payments[0].id, reason: "test" });
check("Supprimer un versement rapproché → refus (annuler d'abord le rapprochement)", r.status === 409);
await call({ action: "salary_reconcile_expense", expenseId: oldSal.id });
sepP = await period("2026-09-01", "2026-09-30");
check("Rapprochement annulé : la dépense redevient comptée (jamais zéro fois)", sepP.expenses.find((e) => e.id === oldSal.id).counted === true && sepP.totals.engaged.known === 113.3);
r = await call({ action: "salary_reconcile_expense", expenseId: oldSal.id, paymentId: x.payments[0].id });
sepP = await period("2026-09-01", "2026-09-30");
check("Rapprochement avec le versement existant de même montant", r.status === 200 && sepP.totals.engaged.known === 0 && (await monthOf("2026-09")).paid === 113.3);
r = await saveExpense({ purchaseDate: "2026-09-30", supplier: "Nahya bis", categoryId: cat("Salaires"), currency: "CHF", originalAmount: "113.30", paidAt: "2026-10-01", payerId: payer("bento"), receiptMissingReason: "x" });
r = await call({ action: "salary_reconcile_expense", expenseId: r.body.data.id, paymentId: x.payments[0].id });
check("Un versement ne peut être rapproché que d'une seule dépense", r.status === 409, r.body);

// ═══ Prolongation : mois proposés, ajout manuel ═══
await q(`select public.team_save_contract(null, $1, 'Prolongation', '2026-12-28', '2027-03-28', 50, 1260, 1575, 252, 126, 1260,
  '{"1":240,"2":240,"3":240,"4":300,"5":240,"6":0,"7":0}'::jsonb, true, true, 'reference', null, 'test')`, [NAHYA]);
o = await ov("2026-10");
check("Prolongation : janvier à mars 2027 proposés (décembre déjà présent), rien ajouté seul", o.members[0].proposedMonths.join() === "2027-01-01,2027-02-01,2027-03-01" && o.members[0].months.length === 4, o.members[0].proposedMonths);
r = await call({ action: "salary_add_months", memberId: NAHYA, months: ["2027-01", "2027-02"] });
o = await ov("2026-10");
check("Ajout manuel de janvier et février : mars reste proposé", r.body.data.added === 2 && o.members[0].months.length === 6 && o.members[0].proposedMonths.join() === "2027-03-01");
check("Nouveaux mois : prévu 1750 (montant en vigueur), confirmé à saisir", o.members[0].months.at(-1).planned === 1750 && o.members[0].months.at(-1).confirmed_net === null);

// ═══ Décompte facultatif ═══
check("Sans décompte : « justificatif manquant »", (await monthOf("2026-10")).document_missing === true);
const up = await call({ action: "upload_url", salaryMonthId: oct.id, fileName: "decompte octobre.pdf", mimeType: "application/pdf", size: 1000 });
check("Envoi du décompte : chemin salary/<mois>/ dans le bucket privé", up.status === 200 && up.body.data.path.startsWith(`salary/${oct.id}/`) && up.body.data.bucket === "expense-receipts");
r = await call({ action: "salary_attach", salaryMonthId: oct.id, path: `salary/${sep.id}/x.pdf`, fileName: "x.pdf", mimeType: "application/pdf" });
check("Rattacher un fichier d'un autre mois → refus", r.status === 409);
await call({ action: "salary_attach", salaryMonthId: oct.id, path: up.body.data.path, fileName: "decompte octobre.pdf", mimeType: "application/pdf", size: 1000 });
x = await monthOf("2026-10");
check("Décompte joint : plus « manquant »", x.document_missing === false && x.documents.length === 1);
r = await call({ action: "salary_view_document", salaryMonthId: oct.id, id: x.documents[0].id });
check("Aperçu : lien signé de 5 minutes", r.status === 200 && /exp=300$/.test(r.body.data.url));

// ═══ Historique, suppressions ═══
const hist = (await call({ action: "history", table: "salary_months", id: oct.id })).body.data;
check("Historique : confirmation du net (à saisir → 1689.40) avec l'auteur", hist.some((h) => h.action === "update" && h.before.confirmed_net === null && h.after.confirmed_net === 1689.4 && h.actor === "naglemelodie@gmail.com"));
r = await call({ action: "salary_delete_month", id: oct.id, reason: "x" });
check("Retirer un mois avec versements → refus", r.status === 409);
const v4 = (await monthOf("2026-11")).payments[0];
r = await call({ action: "salary_delete_payment", id: v4.id, reason: "" });
check("Supprimer un versement sans raison → refus", r.status === 409);
r = await call({ action: "salary_delete_payment", id: v4.id, reason: "erreur de saisie" });
check("Versement supprimé (logiquement), total recalculé", r.status === 200 && (await monthOf("2026-11")).paid === 0 && (await one("select deleted_at is not null d from public.salary_payments where id=$1", [v4.id])).d);

// ═══ Excel ═══
const finance = (await invoke("finance-month", { month: "2026-10" })).body.data;
const wb = CX.buildComptaWorkbook(ExcelJS, finance, await period(...OCT), await ov("2026-10"));
const file = path.join(tmp, "k2.xlsx");
await wb.xlsx.writeFile(file);
const rb = new ExcelJS.Workbook(); await rb.xlsx.readFile(file);
check("Excel : feuille « Salaire » après « Dépenses »", rb.worksheets.map((w) => w.name).join("|") === "Synthèse|Commandes et articles|Encaissements|Remboursements|Dépenses|Salaire");
const findRow = (ws, label) => { let row = null; ws.eachRow((y) => { if (String(y.getCell(1).value ?? "").startsWith(label)) row = y; }); return row; };
const val = (c) => (c.value && typeof c.value === "object" && "result" in c.value ? c.value.result : c.value);
const W = rb.getWorksheet("Salaire");
const rowOct = findRow(W, "SAL-2026-10-NAHYA"), rowNov = findRow(W, "SAL-2026-11-NAHYA");
check("Feuille Salaire : prévu 1700, confirmé 1689.40, versé 1689.40, reste en formule = 0", rowOct.getCell(3).value === 1700 && rowOct.getCell(4).value === 1689.4 && rowOct.getCell(5).value === 1689.4 && rowOct.getCell(6).value.formula === `D${rowOct.number}-E${rowOct.number}` && rowOct.getCell(4).value - rowOct.getCell(5).value === 0);
check("Novembre non confirmé : « montant à saisir » (pas 0)", rowNov.getCell(4).value === "montant à saisir" && rowNov.getCell(6).value === "montant à saisir");
const S = rb.getWorksheet("Synthèse");
check("Synthèse : versé en octobre 1113.30 = 1000 (25.10) + 113.30 (versement daté du 01.10, créé depuis la dépense) — formule vers la feuille Salaire", val(findRow(S, "Versé dans le mois").getCell(2)) === 1113.3 && String(findRow(S, "Versé dans le mois").getCell(2).value.formula).includes("'Salaire'!"));
check("Synthèse : prévu / confirmé affichés séparément du versé", findRow(S, "Net prévu pour le mois de salaire").getCell(2).value === 1700 && findRow(S, "Net confirmé").getCell(2).value === 1689.4);
check("Synthèse : dépenses engagées = 250 (charges sociales), salaire non ajouté", val(findRow(S, "Engagé (date d'achat").getCell(2)) === 250);
const finS = (await invoke("finance-month", { month: "2026-09" })).body.data;
const wbS = CX.buildComptaWorkbook(ExcelJS, finS, await period("2026-09-01", "2026-09-30"), await ov("2026-09"));
let reconciled = null; wbS.getWorksheet("Dépenses").eachRow((y) => { if (y.getCell(1).value === oldSal.code) reconciled = y; });
check("Septembre : la dépense « Salaires » rapprochée est « Non — rapprochée » et hors du total", String(reconciled.getCell(17).value).startsWith("Non — rapprochée") && findRow(wbS.getWorksheet("Synthèse"), "Engagé (date d'achat").getCell(2).value.result === 113.3);
check("Dossier INCOMPLET (net de novembre à confirmer pour un export de novembre)", /net à confirmer/.test(findRow(CX.buildComptaWorkbook(ExcelJS, (await invoke("finance-month", { month: "2026-11" })).body.data, await period("2026-11-01", "2026-11-30"), await ov("2026-11")).getWorksheet("Synthèse"), "INCOMPLET").getCell(1).value));

// ═══ ZIP ═══
const rec = (await call({ action: "receipts_period", from: OCT[0], to: OCT[1] })).body.data;
const { blob } = await CX.buildReceiptsZip(rec, "2026-10", async (u) => new Blob([u]));
const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
check("ZIP : décompte nommé SAL-2026-10-NAHYA_1_…", Object.keys(zip.files).includes("SAL-2026-10-NAHYA_1_decompte_octobre.pdf"), Object.keys(zip.files));

// ═══ Compatibilité et garde-fous ═══
r = await saveExpense({ purchaseDate: "2026-10-12", supplier: "Coop", categoryId: cat("Cuisine"), currency: "EUR", originalAmount: "10", chfAmount: "", paidAt: "2026-10-12", payerId: payer("mel"), personalAdvance: true });
p = await period(...OCT);
check("Actions du lot K1 inchangées", r.status === 200 && p.totals.engaged.unknownCount === 1 && p.totals.engaged.known === 250);
check("Aucun appel externe (Make, e-mail)", (await one("select count(*)::int n from net._calls")).n === 0);
const before = await one("select (select count(*) from public.salary_months) m, (select count(*) from public.salary_payments) p, (select count(*) from public.salary_rates) r, (select string_agg(coalesce(salary_payment_id::text,'-'), ',' order by code) from public.expenses) l");
await db.exec(fs.readFileSync(F11, "utf8"));
const after = await one("select (select count(*) from public.salary_months) m, (select count(*) from public.salary_payments) p, (select count(*) from public.salary_rates) r, (select string_agg(coalesce(salary_payment_id::text,'-'), ',' order by code) from public.expenses) l");
check("Relance de F11 : rien n'est modifié (mars 2027 reste seulement proposé)", JSON.stringify(before) === JSON.stringify(after), { before, after });

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
