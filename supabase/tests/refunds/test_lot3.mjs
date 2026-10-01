// Lot 3 — chiffres du mois (SQL admin_finance_month via la vraie fonction
// finance-month) + fichier Excel (vrai code src/lib/financeExport.ts, relu
// avec exceljs). Base locale PGlite = schéma de production + F1–F7.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild     (exceljs : dépendance du projet)
//   node test_lot3.mjs
import { freshDb } from "./load.mjs";
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

process.on("unhandledRejection", (e) => { console.log("ERROR:", e?.message, e?.where ?? ""); process.exit(2); });

const ROOT = path.resolve(import.meta.dirname, "../..");
const REPO = path.resolve(ROOT, "..");
const MIG = path.join(ROOT, "migrations");
const migrations = fs.readdirSync(MIG).filter((f) => /^20261002(09|10|11)/.test(f)).sort().map((f) => path.join(MIG, f));

let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra) : ""); } };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

const db = await freshDb({ migrations });
await db.query("insert into public.workshop_sessions (id, workshop_type, workshop_date, workshop_time, unit_price, max_capacity) values ('s1','signature','2026-10-10','14:00',85,10)");
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

// ── Fonction finance-month réelle ────────────────────────────────────────
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x" })[k] } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fm-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), `export function createClient() { return {
  auth: { getUser: async (j) => ({ data: { user: j === "admin-jwt" ? { email: "naglemelodie@gmail.com" } : null }, error: null }) },
  rpc: (fn, args) => globalThis.__rpc(fn, args) }; }`);
const mockPlugin = { name: "mock", setup(b) {
  b.onResolve({ filter: /^https:\/\/deno\.land\/std.*server\.ts$/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
  b.onResolve({ filter: /^npm:@supabase\/supabase-js/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
} };
await build({ entryPoints: [path.join(ROOT, "functions/finance-month/index.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "fn.mjs"), logLevel: "warning", plugins: [mockPlugin] });
globalThis.__rpc = async (fn, args) => {
  const ks = Object.keys(args ?? {});
  try {
    const res = await db.query(`select * from public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(", ")})`, ks.map((k) => args[k]));
    const cols = res.fields.map((f) => f.name);
    return { data: cols.length === 1 && cols[0] === fn ? (res.rows[0]?.[fn] ?? null) : res.rows, error: null };
  } catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
};
await import(path.join(tmp, "fn.mjs"));
const call = async (body, jwt = "admin-jwt") => {
  const r = await globalThis.__handler(new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
};
const month = async (m, includeTests = false) => (await call({ month: m, includeTests })).body.data;

// ── Excel : vrai code du site, assemblé pour Node ────────────────────────
fs.writeFileSync(path.join(tmp, "client.mjs"), "export const supabase = {};");
await build({
  entryPoints: [path.join(REPO, "src/lib/financeExport.ts")], bundle: true, format: "esm", platform: "node",
  outfile: path.join(tmp, "fx.mjs"), logLevel: "warning",
  loader: { ".png": "empty", ".jpg": "empty", ".jpeg": "empty", ".webp": "empty", ".svg": "empty", ".gif": "empty" },
  plugins: [{ name: "alias", setup(b) {
    b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: path.join(tmp, "client.mjs") }));
    b.onResolve({ filter: /^@\// }, async (a) => {
      const base = path.join(REPO, "src", a.path.slice(2));
      for (const ext of ["", ".ts", ".tsx", "/index.ts"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return { path: base + ext };
      return { path: base };
    });
  } }],
});
const { buildFinanceWorkbook } = await import(path.join(tmp, "fx.mjs"));
const ExcelJS = (await import(path.join(REPO, "node_modules/exceljs/excel.js"))).default;

// ── Données ─────────────────────────────────────────────────────────────
let n = 0;
async function order({ num, items, paidAt = null, status = "paid", validation = "approved", manual = false, draft = false, test = false,
  delivery = 0, welcome = 0, adjustment = 0, paidAmount = null, physical = "approved" }) {
  const c = (await one("select gen_random_uuid() id")).id;
  await q("insert into auth.users (id, email) values ($1, $2)", [c, `c${++n}@t.ch`]);
  await q("insert into public.profiles (id, email) values ($1, $2) on conflict (id) do nothing", [c, `c${n}@t.ch`]);
  const itemsTotal = items.reduce((s, i) => s + i.total, 0);
  const total = itemsTotal + delivery - welcome + adjustment;
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, paid_at, order_validation,
      customer_id, order_source, is_test, is_draft, created_via, delivery_fee, welcome_discount_amount, price_adjustment_amount, paid_amount, physical_validation, payment_method)
    values ('fr','Claire','Dupont','c@t.ch','000',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
    [total, status, paidAt, validation, c, manual ? "manual order" : "website", test, draft, manual ? "admin" : null, delivery, welcome, adjustment, paidAmount, physical, manual ? "twint" : null]);
  await q("update public.orders set order_number = $2 where id = $1", [o.id, num]);
  const ids = [];
  const fByDate = {};
  for (const it of items) {
    let fid = null;
    if (it.date) fid = fByDate[it.date] ??= (await one("insert into public.order_fulfillments (order_id, pickup_delivery_date, delivery_method) values ($1,$2,'pickup') returning id", [o.id, it.date])).id;
    ids.push((await one("insert into public.order_items (order_id, product, total, size, fulfillment_id, workshop_date, workshop_type, workshop_participants) values ($1,$2,$3,'10cm',$4,$5,$6,$7) returning id",
      [o.id, it.product ?? "bento_cake", it.total, fid, it.workshopDate ?? null, it.product === "workshop" ? "signature" : null, it.product === "workshop" ? 2 : null])).id);
  }
  return { id: o.id, num, items: ids, collected: paidAmount ?? total };
}
const refund = (o, amount, date, extra = {}) => q(`select * from public.ingest_refund(p_order_id=>$1, p_amount=>$2, p_refunded_at=>$3, p_source=>'admin',
  p_method=>'twint', p_allow_gesture=>true, p_idempotency_key=>$4, p_item_ids=>$5)`, [o.id, amount, date, `k-${Math.random()}`, extra.items ?? null]);

// A — commande de septembre (2 gâteaux + livraison 15), remboursée en octobre.
const A = await order({ num: "ORD-A", paidAt: "2026-09-20T10:00:00Z", items: [{ total: 60, date: "2026-09-25" }, { total: 40, date: "2026-09-25" }], delivery: 15 });
await refund(A, 30, "2026-10-05 12:00 Europe/Zurich", { items: [A.items[1]] });
// B — commande multi-dates (septembre + octobre), payée en septembre, livraison une fois.
const B = await order({ num: "ORD-B", paidAt: "2026-09-28T09:00:00Z", items: [{ total: 50, date: "2026-09-30" }, { total: 70, date: "2026-10-03" }], delivery: 10, welcome: 5 });
// C — commande manuelle d'octobre avec ajustement de prix, payée moins que le total.
const C = await order({ num: "ORDM-C", manual: true, paidAt: "2026-10-02T15:00:00Z", items: [{ total: 80, date: "2026-10-04" }, { total: 85, product: "workshop", workshopDate: "2026-10-10" }], adjustment: -15, paidAmount: 140 });
// D — bornes Zurich : 30.09 23:30 (septembre) et 01.10 00:30 (octobre).
const D1 = await order({ num: "ORD-D1", paidAt: "2026-09-30T21:30:00Z", items: [{ total: 11 }] });
const D2 = await order({ num: "ORD-D2", paidAt: "2026-09-30T22:30:00Z", items: [{ total: 22 }] });
// E — remboursement daté le 31.10 23:30 Zurich (octobre) ; F — non daté ; G — à vérifier.
const E = await order({ num: "ORD-E", paidAt: "2026-10-03T10:00:00Z", items: [{ total: 100 }] });
await refund(E, 10, "2026-10-31 23:30 Europe/Zurich");
await refund(E, 5, "2026-11-01 00:30 Europe/Zurich");
const F = await order({ num: "ORD-F", paidAt: "2026-10-04T10:00:00Z", items: [{ total: 50 }] });
await q("insert into public.order_manual_refunds (order_id, amount, note, created_by) values ($1, 7, 'ancien formulaire', 'x')", [F.id]);
const G = await order({ num: "ORD-G", paidAt: "2026-10-05T10:00:00Z", items: [{ total: 60 }] });
await refund(G, 20, "2026-10-06 12:00 Europe/Zurich");
// Même remboursement saisi aussi dans Notion (daté du même jour) → « à vérifier ».
await q("insert into public.order_refunds (order_id, postfinance_refund_id, amount, completed_at) values ($1, 'NOTION-G', 20, '2026-10-06T11:00:00Z')", [G.id]);
// À encaisser : ORDM confirmée non payée (oui), brouillon (non), panier site abandonné (non), site accepté non encaissé (oui).
await order({ num: "ORDM-H", manual: true, status: "pending", items: [{ total: 90 }] });
await order({ num: "ORDM-I", manual: true, status: "pending", draft: true, items: [{ total: 999 }] });
await order({ num: "ORD-J", status: "pending", validation: "pending", physical: "pending", items: [{ total: 888 }] });
await order({ num: "ORD-K", status: "pending", validation: "approved", items: [{ total: 45 }] });
// Reste à rembourser : décision 50 sur B, rien remboursé.
await q("select public.record_refund_decision($1, 50, 'Gâteau annulé', 'admin_cancel', 'dec-b', null, 'x')", [B.id]);
// Test : exclue des chiffres.
const T = await order({ num: "ORD-TEST", paidAt: "2026-10-07T10:00:00Z", items: [{ total: 500 }], test: true });
await refund(T, 100, "2026-10-08 12:00 Europe/Zurich");

// ═══ Accès ═══
check("Accès : sans connexion → 401", (await call({ month: "2026-10" }, null)).status === 401);
check("Mois invalide → 400", (await call({ month: "2026-13" })).status === 400 && (await call({ month: "oct" })).status === 400);

// ═══ Septembre ═══
const sep = await month("2026-09");
check("Septembre : encaissé = A + B + D1 (115 + 125 + 11 = 251)", near(sep.cards.collected, 251) && sep.cards.collectedCount === 3, sep.cards);
check("Septembre : aucun remboursement (celui de A est en octobre)", near(sep.cards.refunded, 0));
check("Septembre : net 251", near(sep.cards.net, 251));
check("Borne Zurich : 30.09 23:30 en septembre, 01.10 00:30 pas en septembre",
  sep.collections.some((c) => c.orderNumber === "ORD-D1") && !sep.collections.some((c) => c.orderNumber === "ORD-D2"));
const bLines = sep.lines.filter((l) => l.orderNumber === "ORD-B");
check("Multi-dates : B encaissée une seule fois, ses 2 gâteaux en lignes distinctes + 1 ligne d'ajustements (livraison 10, bienvenue −5)",
  bLines.filter((l) => l.lineType === "item").length === 2 && bLines.filter((l) => l.lineType === "adjustment").length === 1 && near(bLines.find((l) => l.lineType === "adjustment").amount, 5), bLines);
const byOrder = {};
for (const l of sep.lines) byOrder[l.orderNumber] = (byOrder[l.orderNumber] ?? 0) + Number(l.amount);
check("Somme des lignes de chaque commande = son encaissé", sep.collections.every((c) => near(byOrder[c.orderNumber], c.amount)), { byOrder, coll: sep.collections.map((c) => [c.orderNumber, c.amount]) });
check("Une commande sans frais ni remise n'a pas de ligne d'ajustements", !sep.lines.some((l) => l.orderNumber === "ORD-D1" && l.lineType === "adjustment"));

// ═══ Octobre ═══
const oct = await month("2026-10");
check("Octobre : encaissé = D2 + C (payé 140) + E + F + G = 22 + 140 + 100 + 50 + 60 = 372", near(oct.cards.collected, 372) && oct.cards.collectedCount === 5, oct.cards);
check("Octobre : remboursé = A 30 (commande de septembre) + E 10 (31.10 23:30) + G 20 = 60", near(oct.cards.refunded, 60) && oct.cards.refundedCount === 3, oct.refunds.map((r) => [r.orderNumber, r.amount, r.refundedAt]));
check("Octobre : net = 372 − 60 = 312", near(oct.cards.net, 312));
const aRef = oct.refunds.find((r) => r.orderNumber === "ORD-A");
check("Remboursement d'octobre lié à la commande de septembre (n° + date d'encaissement)", aRef && aRef.orderPaidAt.startsWith("2026-09-20") && aRef.items.length === 1);
check("Borne : remboursement du 01.11 00:30 absent d'octobre", !oct.refunds.some((r) => near(r.amount, 5)));
check("ORDM avec ajustement : encaissé = montant payé (140), lignes = 140", near(oct.collections.find((c) => c.orderNumber === "ORDM-C").amount, 140)
  && near(oct.lines.filter((l) => l.orderNumber === "ORDM-C").reduce((s, l) => s + Number(l.amount), 0), 140));
check("« À dater » : hors mois, montré à part (7)", near(oct.cards.undated, 7) && oct.cards.undatedCount === 1 && !oct.refunds.some((r) => r.orderNumber === "ORD-F") && oct.undatedRefunds.length === 1, { cards: oct.cards, und: oct.undatedRefunds.map((r) => [r.orderNumber, r.amount, r.source]) });
check("« À vérifier » : non compté, montré à part (20)", near(oct.cards.toReview, 20) && oct.cards.toReviewCount === 1, await q("select o.order_number, r.amount, r.status, r.source, r.review_reason from public.order_manual_refunds r join public.orders o on o.id=r.order_id where r.status <> 'counted' or r.refunded_at is null"));
check("À encaisser : ORDM confirmée + site accepté non encaissé (90 + 45) ; brouillon et panier abandonné exclus",
  near(oct.cards.toCollect, 135) && oct.cards.toCollectCount === 2 && !oct.toCollectList.some((t) => ["ORDM-I", "ORD-J"].includes(t.orderNumber)), oct.toCollectList);
check("Reste à rembourser : B 50", near(oct.cards.remainingToRefund, 50) && oct.cards.remainingCount === 1, oct.cards);
check("Commande de test exclue (encaissé et remboursé)", !oct.collections.some((c) => c.orderNumber === "ORD-TEST") && !oct.refunds.some((r) => r.orderNumber === "ORD-TEST"));
const octT = await month("2026-10", true);
check("Avec les tests : inclus", near(octT.cards.collected, 872) && near(octT.cards.refunded, 160));
check("Encaissé par canal : site 232 / manuel 140", near(oct.cards.byOrigin.website.collected, 232) && near(oct.cards.byOrigin.manual.collected, 140), oct.cards.byOrigin);

// ═══ Excel ═══
const wb = buildFinanceWorkbook(ExcelJS, oct);
const buf = await wb.xlsx.writeBuffer();
const file = path.join(tmp, "oct.xlsx");
fs.writeFileSync(file, Buffer.from(buf));
const rb = new ExcelJS.Workbook();
await rb.xlsx.readFile(file);
check("Excel : 4 onglets dans l'ordre", rb.worksheets.map((w) => w.name).join("|") === "Synthèse|Commandes et articles|Encaissements|Remboursements", rb.worksheets.map((w) => w.name));
const sheet = (name) => rb.getWorksheet(name);
const rowsOf = (ws) => { const out = []; ws.eachRow((r, i) => { if (i > 1) out.push(r); }); return out; };
const val = (cell) => (cell.value && typeof cell.value === "object" && "result" in cell.value ? cell.value.result : cell.value);
const findRow = (ws, label, col) => rowsOf(ws).find((r) => String(val(r.getCell(col)) ?? "").startsWith(label));

const enc = sheet("Encaissements");
const encRows = rowsOf(enc).filter((r) => r.getCell(2).value && !String(val(r.getCell(5)) ?? "").startsWith("Total"));
const encTotal = findRow(enc, "Total encaissé", 5);
check("Excel Encaissements : une ligne par commande encaissée (5), total = formule SUM = 372",
  encRows.length === 5 && /^SUM\(F2:F6\)$/.test(encTotal.getCell(6).value.formula) && near(val(encTotal.getCell(6)), 372), { n: encRows.length, total: encTotal?.getCell(6).value });
const lines = sheet("Commandes et articles");
const lineRows = rowsOf(lines).filter((r) => ["Article", "Ajustements"].includes(val(r.getCell(5))));
const itemRows = lineRows.filter((r) => val(r.getCell(5)) === "Article");
const octItems = oct.lines.filter((l) => l.lineType === "item").length;
check("Excel Commandes et articles : chaque article sur sa ligne", itemRows.length === octItems && octItems === 6, { itemRows: itemRows.length, octItems });
check("Excel : le total de commande n'est jamais répété sur les articles (Σ lignes = 372)",
  near(lineRows.reduce((s, r) => s + Number(val(r.getCell(10))), 0), 372) && near(val(findRow(lines, "Total encaissé", 6).getCell(10)), 372));
const workshopRow = itemRows.find((r) => String(val(r.getCell(6))).startsWith("Workshop"));
check("Excel : libellé atelier lisible + date d'atelier", workshopRow && val(workshopRow.getCell(7)) instanceof Date && val(workshopRow.getCell(7)).toISOString().startsWith("2026-10-10"));
const rem = sheet("Remboursements");
const remTotal = findRow(rem, "Total remboursé (mois)", 10);
check("Excel Remboursements : total du mois = 60 (formule)", near(val(remTotal.getCell(11)), 60) && /^SUM\(K2:K4\)$/.test(remTotal.getCell(11).value.formula), remTotal?.getCell(11).value);
const undTotal = findRow(rem, "Total à dater", 10);
check("Excel : bloc « À dater » séparé, hors du total du mois (7)", undTotal && near(val(undTotal.getCell(11)), 7) && !remTotal.getCell(11).value.formula.includes(String(undTotal.number)));
const aRow = rowsOf(rem).find((r) => val(r.getCell(2)) === "ORD-A");
check("Excel : remboursement d'octobre avec la date d'encaissement de la commande de septembre",
  aRow && val(aRow.getCell(1)).toISOString().startsWith("2026-10-05") && val(aRow.getCell(3)).toISOString().startsWith("2026-09-20"));
const syn = sheet("Synthèse");
const synRow = (label) => { let found = null; syn.eachRow((r) => { if (!found && String(val(r.getCell(1)) ?? "").startsWith(label)) found = r; }); return found; };
check("Excel Synthèse : encaissé / remboursé / net en formules liées aux onglets",
  synRow("Encaissé (date réelle").getCell(2).value.formula.startsWith("'Encaissements'!F") && synRow("Remboursé (date réelle").getCell(2).value.formula.startsWith("'Remboursements'!K")
  && near(val(synRow("Net du mois").getCell(2)), 312), { e: synRow("Encaissé (date réelle").getCell(2).value, n: synRow("Net du mois").getCell(2).value });
check("Excel Synthèse : 3 contrôles OK", ["Encaissements = Encaissé", "Commandes et articles = Encaissé", "Remboursements = Remboursé"].every((l) => val(synRow(l).getCell(2)) === "OK"));
check("Excel : aucune commande de test, aucun « à vérifier »",
  !rowsOf(enc).some((r) => val(r.getCell(2)) === "ORD-TEST") && !rowsOf(rem).some((r) => val(r.getCell(8)) === "NOTION-G"));
const dRow = rowsOf(enc).find((r) => val(r.getCell(2)) === "ORD-D2");
check("Excel : date d'encaissement au jour de Zurich (01.10 pour 30.09 22:30 UTC)", dRow && val(dRow.getCell(1)).toISOString().startsWith("2026-10-01"));
// Mois sans activité : fichier valide, totaux 0.
const empty = await month("2025-01");
const wb0 = buildFinanceWorkbook(ExcelJS, empty);
const buf0 = await wb0.xlsx.writeBuffer();
check("Mois vide : chiffres à 0 et fichier Excel valide", near(empty.cards.collected, 0) && buf0.byteLength > 2000);
fs.copyFileSync(file, path.join(os.tmpdir(), "bento-test-oct-2026.xlsx"));

console.log(`\n${passes} PASS, ${fails} FAIL`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
