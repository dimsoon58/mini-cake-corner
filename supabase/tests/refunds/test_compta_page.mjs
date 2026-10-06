// Compta — page finale (F17) : « Tableau du mois (Excel) » = écran, une
// ligne par gâteau ; « Mel / Eli » : résultat à partager ≠ disponible à
// verser (sommes dues par les clients et paiements de commandes futures
// jamais disponibles). Schéma de production + F1–F17, vraie fonction
// manage-expenses, vrai code d'export et de calcul du décompte.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_compta_page.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "page-"));
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

// Module de calcul du décompte (le même que le serveur).
await build({ entryPoints: [path.join(ROOT, "functions/_shared/settlement.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "st.mjs"), logLevel: "warning" });
const ST = await import(path.join(tmp, "st.mjs"));
const num = (x) => Math.round(Number(x) * 100) / 100;

// ── Données : octobre 2026 ──────────────────────────────────────────────
let n = 0;
async function order({ items, paidAt = null, pay = "paid", manual = false, adjustment = 0 }) {
  const c = (await one("select gen_random_uuid() id")).id;
  await q("insert into auth.users (id, email) values ($1, $2)", [c, `p${++n}@t.ch`]);
  const total = items.reduce((t, i) => t + i.total, 0) + adjustment;
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, paid_at, order_validation, customer_id,
      order_source, created_via, price_adjustment_amount, physical_validation, pickup_delivery_date)
    values ('fr','Claire','Dupont','c@t.ch','000',$1,$2,$3,'approved',$4,$5,$6,$7,'approved',$8) returning id`,
    [total, pay, paidAt, c, manual ? "manual order" : "website", manual ? "admin" : null, adjustment, items[0].date]);
  await q("update public.orders set order_number = $2 where id = $1", [o.id, `${manual ? "ORDM" : "ORD"}-P${n}`]);
  const ids = [];
  const byDate = {};
  for (const it of items) {
    const f = byDate[it.date] ??= (await one("insert into public.order_fulfillments (order_id, pickup_delivery_date, delivery_method, delivery_fee) values ($1,$2,'pickup',0) returning id", [o.id, it.date])).id;
    ids.push((await one(`insert into public.order_items (order_id, product, total, quantity, size, flavors, fulfillment_id) values ($1,'bento_cake',$2,$3,'10cm','{vanilla}',$4) returning id`,
      [o.id, it.total, it.qty ?? 1, f])).id);
  }
  return { id: o.id, items: ids };
}
await order({ paidAt: "2026-09-20T10:00:00Z", items: [{ total: 60, date: "2026-10-10" }] });            // payé en septembre pour octobre
await order({ paidAt: "2026-10-02T10:00:00Z", items: [{ total: 90, qty: 2, date: "2026-10-12" }] });   // quantité 2 → 2 lignes
await order({ paidAt: "2026-10-15T10:00:00Z", items: [{ total: 45, date: "2026-11-20" }] });           // payé en octobre pour novembre
await order({ manual: true, pay: "pending", adjustment: -5, items: [{ total: 55, date: "2026-10-25" }] }); // non payée → restant à payer 50
const K = await order({ paidAt: "2026-10-03T10:00:00Z", items: [{ total: 40, date: "2026-10-20" }, { total: 35, date: "2026-10-20" }] });
await q("update public.order_items set production_status='cancelled' where id=$1", [K.items[1]]);
await q(`select * from public.ingest_refund(p_order_id=>$1, p_amount=>35, p_refunded_at=>'2026-10-21 12:00 Europe/Zurich', p_source=>'admin',
  p_method=>'twint', p_allow_gesture=>true, p_idempotency_key=>'k-cancel', p_item_ids=>$2)`, [K.id, [K.items[1]]]);

const month = "2026-10", from = "2026-10-01", to = "2026-10-31";
const sales = (await call({ action: "sales_month", month })).body.data;
const c = sales.cards;
check("Action sales_month (manage-expenses) : ventes maintenues d'octobre = 60 + 90 + 50 + 40 = 240", num(c.net) === 240 && num(c.toCollect) === 50 && num(c.cancelled) === 35, c);
check("Action sales_month : refusée sans connexion admin", (await call({ action: "sales_month", month }, "client-jwt")).status !== 200 && !(await call({ action: "sales_month", month }, "client-jwt")).body.data);

// ═══ Tableau du mois (Excel) = écran ════════════════════════════════════
const d = {
  sales, finance: (await invoke("finance-month", { month })).body.data, period: (await call({ action: "period", from, to })).body.data,
  salary: (await call({ action: "salary_overview", month })).body.data, advances: (await call({ action: "advances_overview", month })).body.data,
  settlement: (await call({ action: "settlement_get", month: from })).body.data,
};
const wb = CX.buildComptaWorkbook(ExcelJS, d.sales, d.finance, d.period, d.salary, d.advances, d.settlement);
const file = path.join(tmp, "page.xlsx");
await wb.xlsx.writeFile(file);
const rb = new ExcelJS.Workbook(); await rb.xlsx.readFile(file);
const findRow = (ws, label, col = 1) => { let row = null; ws.eachRow((y) => { if (String(y.getCell(col).value ?? "").startsWith(label)) row = y; }); return row; };
const val = (x) => (x.value && typeof x.value === "object" && "result" in x.value ? x.value.result : x.value);
check("Feuilles : Synthèse, Ventes du mois, puis encaissements en détail secondaire (sans « Commandes et articles » par date de paiement)",
  rb.worksheets.map((w) => w.name).slice(0, 5).join("|") === "Synthèse|Ventes du mois|Encaissements - résumé|Encaissements|Remboursements" && !rb.getWorksheet("Commandes et articles"),
  rb.worksheets.map((w) => w.name));
const V = rb.getWorksheet("Ventes du mois");
const dataRows = [];
V.eachRow((y, i) => { if (i > 1 && y.getCell(2).value && /^ORD/.test(String(y.getCell(2).value))) dataRows.push(y); });
check("Une ligne par gâteau : autant de lignes que l'écran (quantité 2 = 2 lignes, annulé visible)", dataRows.length === sales.lines.length && dataRows.length === 6, dataRows.length);
const q2 = dataRows.filter((y) => String(y.getCell(5).value).includes("(1/2)") || String(y.getCell(5).value).includes("(2/2)"));
check("Quantité 2 : deux lignes de 45", q2.length === 2 && q2.every((y) => val(y.getCell(10)) === 45));
check("Ligne annulée : état « Annulé », vente retenue 0, remboursement d'annulation en information", dataRows.some((y) => y.getCell(6).value === "Annulé" && (val(y.getCell(13)) === 0 || (val(y.getCell(13)) ?? {}).formula === `IF(F${y.number}="Vendu",J${y.number},0)-K${y.number}`) && y.getCell(12).value === 35));
check("Payé en septembre pour octobre : dans octobre, « Payée le » 20.09", dataRows.some((y) => val(y.getCell(10)) === 60 && y.getCell(15).value instanceof Date && y.getCell(15).value.toISOString().startsWith("2026-09-20")));
check("Payé en octobre pour novembre : absent d'octobre", !dataRows.some((y) => y.getCell(2).value === "ORD-P3") && dataRows.some((y) => y.getCell(2).value === "ORD-P2"));
const tot = (label) => val(findRow(V, label, 5).getCell(label.startsWith("= Ventes") || label.startsWith("Restant") ? 13 : 10));
check("Totaux de la feuille = cartes de l'écran (ventes, annulés, maintenues, restant à payer)", num(tot("Ventes du mois (vendues")) === num(c.gross) && num(tot("− Articles annulés")) === num(c.cancelled)
  && num(tot("= Ventes maintenues")) === num(c.net) && num(tot("Restant à payer")) === num(c.toCollect), { gross: tot("Ventes du mois (vendues"), net: tot("= Ventes maintenues") });
check("Totaux en formules (SUM / SUMIFS sur les lignes)", /^SUM\(M/.test(findRow(V, "= Ventes maintenues", 5).getCell(13).value.formula) && /^SUMIFS\(M/.test(findRow(V, "Restant à payer", 5).getCell(13).value.formula));
const S = rb.getWorksheet("Synthèse");
check("Synthèse : résumé du mois = écran (ventes maintenues, restant à payer), en formules vers « Ventes du mois »",
  num(val(findRow(S, "Ventes maintenues (après").getCell(2))) === 240 && String(findRow(S, "Ventes maintenues (après").getCell(2).value.formula).includes("'Ventes du mois'!")
  && num(val(findRow(S, "Restant à payer par les clients").getCell(2))) === 50);
check("Synthèse : dépenses du mois et salaire dans le résumé", !!findRow(S, "Dépenses du mois (date d'achat") && !!findRow(S, "Salaire net confirmé du mois"));
check("Contrôles ventes OK", val(findRow(S, "Somme des lignes « Vente retenue »").getCell(2)) === "OK" && val(findRow(S, "Ventes (vendues + annulées) = ventes du serveur").getCell(2)) === "OK");
const D = rb.getWorksheet("Décompte Mel-Eli et versements");
check("Décompte : revenus = ventes maintenues (240), contrôle croisé vers « Ventes du mois » OK", num(val(findRow(D, "Ventes maintenues du mois").getCell(2))) === 240
  && val(findRow(D, "Ventes maintenues = feuille Ventes du mois").getCell(2)) === "OK" && num(val(findRow(D, "dont encore dû par les clients").getCell(2))) === 50);
check("Même liste de manques pour la page et l'Excel", String(findRow(S, "INCOMPLET").getCell(1).value) === `INCOMPLET — ${CX.comptaDossierIssues(d.sales, d.finance, d.period, d.salary, d.advances, d.settlement).join(" · ")}`);

// ═══ Disponible à verser : trésorerie au 31.10 ══════════════════════════
await q("insert into public.bank_balances (balance_date, amount, created_by) values ('2026-10-31', 1000, 'test')");
const bal = (await one("select id from public.bank_balances where balance_date='2026-10-31'")).id;
const tr = (await call({ action: "treasury_check", balanceId: bal })).body.data;
check("Trésorerie au 31.10 : paiement reçu pour novembre (45) déduit du disponible", num(tr.customerPrepayments) === 45 && num(tr.available) === num(1000 - 45 - tr.invoicesToPay - tr.salaryRemaining - tr.advancesToRepay - tr.sharesUnpaid), tr);
check("Trésorerie au 31.10 : encore dû par les clients (50) en information, jamais ajouté au disponible", num(tr.customersOwe) === 50);
check("Trésorerie au 31.10 (F18) : l'article annulé déjà remboursé n'est plus dû (0)", num(tr.customerRefundsOwed) === 0);
const st = (await call({ action: "settlement_get", month: from })).body.data;
check("Décompte d'octobre : ventes du mois, dont 50 encore dus (avertissement)", num(st.figures.revenueNet) === 240 && num(st.draft.toCollectInResult) === 50 && st.draft.warnings.some((w) => /encore dû par les clients/.test(w)), st.draft);

{
  const wb2 = CX.buildComptaWorkbook(ExcelJS, d.sales, d.finance, d.period, d.salary, d.advances, st);
  const f2 = path.join(tmp, "page2.xlsx"); await wb2.xlsx.writeFile(f2);
  const rb2 = new ExcelJS.Workbook(); await rb2.xlsx.readFile(f2);
  const D2 = rb2.getWorksheet("Décompte Mel-Eli et versements");
  const ro = findRow(D2, "− remboursements clients encore dus"), av = findRow(D2, "Trésorerie disponible");
  check("Excel : ligne « remboursements clients encore dus » et trésorerie disponible en formule qui la déduit",
    !!ro && String(av.getCell(2).value.formula).includes(`-B${ro.number}`) && num(val(av.getCell(2))) === num(tr.available), av?.getCell(2).value);
}
// Calcul pur : base constituée, 1'000 à partager.
const base = {
  month: "2027-03-01", monthEnd: "2027-03-31", startMonth: "2026-10-01",
  rules: { id: "r", base_target: 4000, monthly_extra: 300, mel_pct: 60, mel_payer_id: "m", eli_payer_id: "e" }, melName: "Mel", eliName: "Eli", validated: null,
  prev: { id: "p", month: "2027-02-01", retainedCum: 4300, baseConstituted: true, extraCum: 300, lossOut: 0 }, prevMonthValidated: true,
  figures: { revenueNet: 1300, salesToCollect: 400, collected: 0, refunded: 0, refundsUndatedCount: 0, refundsToReviewCount: 0, expensesKnown: 0, expensesCount: 0,
    expensesUnknown: [], expensesUndated: [], investments: [], salaryTotal: 0, salaryLines: [], salaryToConfirm: [] },
  adjustments: [], bankBalance: { id: "b", date: "2027-03-31", amount: 5600 },
  treasury: { balance: 5600, invoicesToPay: 0, invoicesUnknownCount: 0, salaryRemaining: 0, advancesToRepay: 0, advancesUnknownCount: 0, sharesUnpaid: 0,
    customerPrepayments: 700, customersOwe: 400, available: 4900 },
};
let x = ST.computeSettlement(base, { ackCashShort: true });
check("Résultat à partager 1'000 (1'300 − 300 d'épargne), mais disponible à verser 300 seulement (4'900 − 4'000 − 600)", x.toShare === 1000 && x.payableNow === 300 && x.notYetAvailable === 700 && x.toCollectInResult === 400, x);
check("Le partage reste calculé à 60 / 40 sur le résultat (Mel 600, Eli 400) ; le non-disponible reste dû", x.melShare === 600 && x.eliShare === 400 && x.flags.cashShort);
x = ST.computeSettlement({ ...base, treasury: { ...base.treasury, customerPrepayments: 0, available: 5600 } });
check("Sans paiements de commandes futures : tout le résultat est disponible (1'000)", x.payableNow === 1000 && x.notYetAvailable === 0 && !x.flags.cashShort);
x = ST.computeSettlement({ ...base, treasury: { ...base.treasury, available: 3900 } }, { ackBaseBreach: true, ackCashShort: true });
check("Trésorerie sous la base : rien de disponible à verser (jamais négatif)", x.payableNow === 0 && x.notYetAvailable === 1000);

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
