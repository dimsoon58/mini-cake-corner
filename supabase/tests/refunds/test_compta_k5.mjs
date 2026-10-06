// Compta, lot K5 — finalisation des exports : liste unique des manques
// (page = Excel), contrôles croisés décompte ↔ feuilles sources, dossier
// complet en un ZIP. Aucune migration : F1–F13 + vraie fonction
// manage-expenses + vrai code d'export du site.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_compta_k5.mjs
import { freshDb } from "./load.mjs";
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

process.on("unhandledRejection", (e) => { console.log("ERROR:", e?.message, e?.where ?? ""); process.exit(2); });

const ROOT = path.resolve(import.meta.dirname, "../..");
const REPO = path.resolve(ROOT, "..");
const MIG = path.join(ROOT, "migrations");
const migrations = fs.readdirSync(MIG).filter((f) => /^(20261002(09|10|11|12|13|14|16|17|18)|20261004)/.test(f)).sort().map((f) => path.join(MIG, f));
const F13 = migrations.find((f) => f.includes("_f13_"));

let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra) : ""); } };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

const db = await freshDb({ migrations });
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

// ── Vraies fonctions (esbuild) ───────────────────────────────────────────
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x", ADMIN_ORDER_PIN: "1234" })[k] } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "k5-"));
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
const BENTO = payer("bento");
const PIN = "1234";
let n = 0;
async function revenue(amount, paidAt) {
  const c = (await one("select gen_random_uuid() id")).id;
  await q("insert into auth.users (id, email) values ($1, $2)", [c, `k5-${++n}@t.ch`]);
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, paid_at, order_validation, customer_id, order_source,
      physical_validation, pickup_delivery_date)
    values ('fr','Claire','Dupont','c@t.ch','000',$1,'paid',$2,'approved',$3,'website','approved',($2::timestamptz at time zone 'Europe/Zurich')::date) returning id`, [amount, paidAt, c]);
  await q("update public.orders set order_number=$2 where id=$1", [o.id, `ORD-K5-${n}`]);
  await q("insert into public.order_items (order_id, product, total, size) values ($1,'bento_cake',$2,'10cm')", [o.id, amount]);
}
const month = "2026-10", from = "2026-10-01", to = "2026-10-31";
const data = async () => ({
  sales: (await call({ action: "sales_month", month })).body.data,
  finance: (await invoke("finance-month", { month })).body.data,
  period: (await call({ action: "period", from, to })).body.data,
  salary: (await call({ action: "salary_overview", month })).body.data,
  advances: (await call({ action: "advances_overview", month })).body.data,
  settlement: (await call({ action: "settlement_get", month: from })).body.data,
});
const findRow = (ws, label) => { let row = null; ws.eachRow((y) => { if (String(y.getCell(1).value ?? "").startsWith(label)) row = y; }); return row; };
const val = (c) => (c.value && typeof c.value === "object" && "result" in c.value ? c.value.result : c.value);
async function workbook(d) {
  const wb = CX.buildComptaWorkbook(ExcelJS, d.sales, d.finance, d.period, d.salary, d.advances, d.settlement);
  const file = path.join(tmp, `k5-${Math.random()}.xlsx`);
  await wb.xlsx.writeFile(file);
  const rb = new ExcelJS.Workbook(); await rb.xlsx.readFile(file);
  return rb;
}
const stateText = (rb) => String((findRow(rb.getWorksheet("Synthèse"), "COMPLET") ?? findRow(rb.getWorksheet("Synthèse"), "INCOMPLET")).getCell(1).value);
let r, d, rb;

// ═══ Mois d'octobre : données ═══
await revenue(6000, "2026-10-05T10:00:00Z");
r = await call({ action: "save", idempotencyKey: "e1", purchaseDate: "2026-10-06", supplier: "Migros", categoryId: cat("Courses de production"), currency: "CHF", originalAmount: "200", status: "paid", paidAt: "2026-10-06", payerId: BENTO });
const migros = r.body.data;
const sal = (await call({ action: "salary_overview", month })).body.data.members[0].months;
for (const m of sal) await call({ action: "salary_confirm", id: m.id, net: m.salary_month === "2026-10-01" ? "1700" : "100" });
const oct = sal.find((m) => m.salary_month === "2026-10-01");
await call({ action: "salary_add_payment", idempotencyKey: "s1", monthId: oct.id, paidAt: "2026-10-25", amount: "1700" });

// ═══ Liste unique des manques (page = Excel) ═══
d = await data();
let issues = CX.comptaDossierIssues(d.sales, d.finance, d.period, d.salary, d.advances, d.settlement);
rb = await workbook(d);
check("Avant tout : dossier INCOMPLET avec exactement la même liste dans l'Excel et pour la page", /^INCOMPLET — /.test(stateText(rb)) && stateText(rb) === `INCOMPLET — ${issues.join(" · ")}`, { issues, excel: stateText(rb) });
check("Manques détectés : justificatif de la dépense, justificatifs de salaire, décompte non validé, solde de fin de mois", issues.some((i) => /justificatif\(s\) manquant/.test(i)) && issues.some((i) => /SAL-2026-10-NAHYA : justificatif manquant/.test(i)) && issues.includes("décompte Mel / Eli non validé") && issues.includes("solde bancaire de fin de mois manquant"), issues);

// ═══ Contrôles croisés : décompte = feuilles sources ═══
const D = rb.getWorksheet("Décompte Mel-Eli et versements");
const ctl = (label) => val(findRow(D, label).getCell(2));
check("Contrôle « Ventes maintenues = feuille Ventes du mois » : OK", ctl("Ventes maintenues = feuille Ventes du mois") === "OK");
check("Contrôle « Dépenses = feuille Dépenses » : OK", ctl("Dépenses du mois = feuille Dépenses") === "OK");
check("Contrôle « Salaire = feuille Salaire » : OK", ctl("Salaire = feuille Salaire") === "OK");
check("Contrôles en formules Excel (recalculés à l'ouverture)", String(findRow(D, "Ventes maintenues = feuille Ventes du mois").getCell(2).value.formula).includes("'Ventes du mois'!") && String(findRow(D, "Dépenses du mois = feuille Dépenses").getCell(2).value.formula).includes("'Dépenses'!") && String(findRow(D, "Salaire = feuille Salaire").getCell(2).value.formula).includes("'Salaire'!"));
check("Synthèse : « Contenu du dossier » liste les feuilles et le ZIP des justificatifs", !!findRow(rb.getWorksheet("Synthèse"), "• Feuille « Décompte Mel-Eli et versements »") && !!findRow(rb.getWorksheet("Synthèse"), "• Justificatifs"));

// ═══ Tout compléter → COMPLET ═══
await call({ action: "save", id: migros.id, purchaseDate: "2026-10-06", supplier: "Migros", categoryId: cat("Courses de production"), currency: "CHF", originalAmount: "200", status: "paid", paidAt: "2026-10-06", payerId: BENTO, receiptMissingReason: "ticket perdu" });
const up = await call({ action: "upload_url", salaryMonthId: oct.id, fileName: "decompte.pdf", mimeType: "application/pdf", size: 10 });
await call({ action: "salary_attach", salaryMonthId: oct.id, path: up.body.data.path, fileName: "decompte.pdf", mimeType: "application/pdf", size: 10 });
// Les mois de salaire suivants ont été confirmés à 100 sans versement ni décompte : seul octobre compte pour l'export d'octobre.
await q("insert into public.bank_balances (balance_date, amount, created_by) values ('2026-10-31', 8000, 'test')");
r = await call({ action: "settlement_validate", pin: PIN, month: from });
check("Décompte d'octobre validé (PIN)", r.status === 200, r.body);
d = await data();
issues = CX.comptaDossierIssues(d.sales, d.finance, d.period, d.salary, d.advances, d.settlement);
rb = await workbook(d);
check("Plus aucun manque : page et Excel disent « COMPLET »", issues.length === 0 && /^COMPLET/.test(stateText(rb)), { issues, excel: stateText(rb) });

// ═══ Modification après validation : l'Excel le montre ═══
await call({ action: "save", idempotencyKey: "e2", purchaseDate: "2026-10-20", supplier: "Oubli", categoryId: cat("Matériel"), currency: "CHF", originalAmount: "50", status: "paid", paidAt: "2026-10-20", payerId: BENTO, receiptMissingReason: "x" });
d = await data();
rb = await workbook(d);
const D2 = rb.getWorksheet("Décompte Mel-Eli et versements");
check("Dépense ajoutée à octobre après validation : contrôle « Dépenses » = ÉCART (décompte figé)", val(findRow(D2, "Dépenses du mois = feuille Dépenses").getCell(2)) === "ÉCART" && /mois validé/.test(String(findRow(D2, "Dépenses du mois = feuille Dépenses").getCell(1).value)));
check("… et le dossier repasse INCOMPLET (ajustement à créer), sans rien modifier", /ajustement à créer/.test(stateText(rb)) && Number(d.settlement.validated.expenses) === 200);

// ═══ Dossier complet en un ZIP ═══
const rec = (await call({ action: "receipts_period", from, to })).body.data;
const excelBlob = new Blob([await (CX.buildComptaWorkbook(ExcelJS, d.sales, d.finance, d.period, d.salary, d.advances, d.settlement)).xlsx.writeBuffer()]);
issues = CX.comptaDossierIssues(d.sales, d.finance, d.period, d.salary, d.advances, d.settlement);
const { blob, failed } = await CX.buildDossierZip(excelBlob, rec, month, issues, async (u) => new Blob([u]));
const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
const names = Object.keys(zip.files).sort();
check("ZIP complet : Excel + justificatifs/ (noms = ID de l'Excel) + index + LISEZMOI", failed.length === 0 && names.includes("Bento-Cake-Studio_compta_2026-10.xlsx") && names.includes("justificatifs/SAL-2026-10-NAHYA_1_decompte.pdf") && names.includes("justificatifs/index_justificatifs_2026-10.csv") && names.includes("LISEZMOI.txt"), names);
const readme = await zip.file("LISEZMOI.txt").async("string");
check("LISEZMOI : dossier INCOMPLET, avec la liste des manques", /ÉTAT : INCOMPLET/.test(readme) && /ajustement à créer/.test(readme));
const { blob: b2 } = await CX.buildDossierZip(excelBlob, [{ ...rec[0], url: null }], month, [], async (u) => new Blob([u]));
const z2 = await JSZip.loadAsync(Buffer.from(await b2.arrayBuffer()));
check("Pièce non récupérable : marquée MANQUANT dans l'index, dossier non présenté comme complet", /MANQUANT/.test(await z2.file("justificatifs/index_justificatifs_2026-10.csv").async("string")) && /INCOMPLET/.test(await z2.file("LISEZMOI.txt").async("string")));

// ═══ Rien n'est supprimé, rien n'est déplacé ═══
check("Aucune donnée supprimée par les exports", (await one("select count(*)::int n from public.expenses where deleted_at is not null")).n === 0 && (await one("select count(*)::int n from public.settlements")).n === 1);

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
