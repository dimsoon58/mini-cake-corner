// Compta en 3 espaces (F22) — commandes du mois avec leurs montants
// enregistrés (admin_sales_orders_month) et ajouts « fiduciaire uniquement ».
// Schéma de production (PGlite) + F1–F22, vraie fonction manage-expenses,
// stockage simulé. Ne se connecte jamais à Supabase ; aucune vraie commande,
// aucun e-mail, aucun paiement.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_compta_fiduciary.mjs
import { freshDb } from "./load.mjs";
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

process.on("unhandledRejection", (e) => { console.log("ERROR:", e?.stack ?? e); process.exit(2); });

const ROOT = path.resolve(import.meta.dirname, "../..");
const MIG = path.join(ROOT, "migrations");
let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 900) : ""); } };

const migrations = fs.readdirSync(MIG).filter((f) => /^202610(02(09|10|11|12|13|14|16|17|18|19)|03|04|05)/.test(f)).sort().map((f) => path.join(MIG, f));
const F22 = migrations.find((f) => f.includes("_f22_"));
const db = await freshDb({ migrations });
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];
const num = (x) => Math.round(Number(x) * 100) / 100;
const sum = (rows, f = (l) => l.amount) => num(rows.reduce((s, l) => s + Number(f(l)), 0));

// ── Vraie fonction manage-expenses (stockage simulé) ─────────────────────
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x", ADMIN_ORDER_PIN: "1234" })[k] } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "f22-"));
globalThis.__storage = [];
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), `export function createClient() { return {
  auth: { getUser: async (j) => ({ data: { user: j === "admin-jwt" ? { email: "naglemelodie@gmail.com" } : j === "client-jwt" ? { email: "x@y.ch" } : null }, error: null }) },
  rpc: (fn, args) => globalThis.__rpc(fn, args),
  storage: { from: (bucket) => ({
    createSignedUploadUrl: async (p) => { globalThis.__storage.push({ op: "upload", bucket, path: p }); return { data: { token: "tok", path: p }, error: null }; },
    createSignedUrl: async (p, s) => { globalThis.__storage.push({ op: "sign", bucket, path: p, seconds: s }); return { data: { signedUrl: "https://signed.test/" + bucket + "/" + p + "?exp=" + s }, error: null }; },
  }) } }; }`);
await build({ entryPoints: [path.join(ROOT, "functions/manage-expenses/index.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "me.mjs"), logLevel: "warning",
  plugins: [{ name: "m", setup(b) {
    b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
    b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
  } }] });
await import(path.join(tmp, "me.mjs"));
const handler = globalThis.__handler;
globalThis.__rpc = async (fn, args) => {
  const ks = Object.keys(args ?? {});
  try {
    const res = await db.query(`select * from public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(", ")})`, ks.map((k) => args[k]));
    const cols = res.fields.map((f) => f.name);
    return { data: cols.length === 1 && cols[0] === fn ? (res.rows[0]?.[fn] ?? null) : res.rows, error: null };
  } catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
};
const call = async (body, jwt = "admin-jwt") => {
  const r = await handler(new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
};

// ── Commandes (mêmes cas que test_compta_sales) ──────────────────────────
let n = 0;
async function order({ num: nb, items, paidAt = null, pay = "paid", validation = "approved", physical = "approved", manual = false,
  delivery = 0, welcome = 0, express = 0, adjustment = 0, partner = 0, reward = 0, date = null, ft = "cake_only" }) {
  const c = (await one("select gen_random_uuid() id")).id;
  await q("insert into auth.users (id, email) values ($1, $2)", [c, `c${++n}@t.ch`]);
  const itemsTotal = items.reduce((s, i) => s + i.total, 0);
  const total = Math.round((itemsTotal + delivery - welcome - partner - reward + express + adjustment) * 100) / 100;
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, paid_at, order_validation,
      customer_id, order_source, created_via, delivery_fee, welcome_discount_amount, express_surcharge_amount, price_adjustment_amount,
      partner_discount_amount, partner_name, reward_amount_used, physical_validation, pickup_delivery_date, fulfillment_type)
    values ('fr','Claire','Dupont','c@t.ch','000',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
    [total, pay, paidAt, validation, c, manual ? "manual order" : "website", manual ? "admin" : null, delivery, welcome, express, adjustment,
      partner, partner ? "Studio Partenaire" : null, reward, physical, date, ft]);
  await q("update public.orders set order_number = $2 where id = $1", [o.id, nb]);
  const ids = [];
  const fByDate = {};
  for (const it of items) {
    let fid = null;
    if (it.date) {
      fid = fByDate[it.date] ??= (await one("insert into public.order_fulfillments (order_id, pickup_delivery_date, delivery_method, delivery_fee) values ($1,$2,$3,$4) returning id",
        [o.id, it.date, it.fee ? "delivery" : "pickup", it.fee ?? 0])).id;
    }
    ids.push((await one(`insert into public.order_items (order_id, product, total, quantity, size, flavors, fulfillment_id, created_at)
      values ($1,'bento_cake',$2,$3,'bento','{vanilla}',$4, now() + ($5 || ' seconds')::interval) returning id`, [o.id, it.total, it.qty ?? 1, fid, String(ids.length)])).id);
  }
  return { id: o.id, num: nb, items: ids, total };
}
const refund = (o, amount, date, items = null) => q(`select * from public.ingest_refund(p_order_id=>$1, p_amount=>$2, p_refunded_at=>$3, p_source=>'admin',
  p_method=>'twint', p_allow_gesture=>true, p_idempotency_key=>$4, p_item_ids=>$5)`, [o.id, amount, date, `k-${Math.random()}`, items]);

const P1 = await order({ num: "ORD-P1", paidAt: "2026-09-20T10:00:00Z", items: [{ total: 60, date: "2026-10-10" }] });
const M = await order({ num: "ORD-M", paidAt: "2026-10-01T09:00:00Z", delivery: 25, welcome: 10, express: 6,
  items: [{ total: 40, date: "2026-10-05", fee: 10 }, { total: 30, date: "2026-10-05", fee: 10 }, { total: 50, date: "2026-11-03", fee: 15 }] });
const K = await order({ num: "ORD-K", paidAt: "2026-10-03T09:00:00Z", items: [{ total: 40, date: "2026-10-20" }, { total: 35, date: "2026-10-20" }] });
await q("update public.order_items set production_status='cancelled' where id=$1", [K.items[1]]);
await refund(K, 35, "2026-10-21 12:00 Europe/Zurich", [K.items[1]]);
const G = await order({ num: "ORD-G", paidAt: "2026-10-03T09:00:00Z", items: [{ total: 80, date: "2026-10-22" }] });
await refund(G, 20, "2026-11-02 12:00 Europe/Zurich");
const U = await order({ num: "ORDM-U", manual: true, pay: "pending", adjustment: -5, items: [{ total: 55, date: "2026-10-25" }] });
const S = await order({ num: "ORDM-S", manual: true, pay: "pending", items: [{ total: 70, date: "2026-09-15" }] });   // impayé de septembre
const Q2 = await order({ num: "ORD-Q", paidAt: "2026-10-04T09:00:00Z", items: [{ total: 61, qty: 2, date: "2026-10-27" }] });
const Z = await order({ num: "ORD-Z", paidAt: "2026-10-04T09:00:00Z", validation: "cancelled", delivery: 12, items: [{ total: 60, date: "2026-10-28", fee: 12 }] });
await q("update public.order_items set production_status='cancelled' where order_id=$1", [Z.id]);
await refund(Z, 72, "2026-10-29 12:00 Europe/Zurich");
const PA = await order({ num: "ORD-PA", paidAt: "2026-10-06T09:00:00Z", partner: 9, reward: 3.5, items: [{ total: 90, date: "2026-10-18" }] });
await order({ num: "ORD-W", pay: "pending", physical: "pending", validation: "pending", items: [{ total: 99, date: "2026-10-26" }] });   // à accepter

const salesOct = (await call({ action: "sales_month", month: "2026-10" })).body.data;
const salesNov = (await call({ action: "sales_month", month: "2026-11" })).body.data;
let r = await call({ action: "sales_orders_month", month: "2026-10" });
const so = r.body.data;
const ord = (o) => so.orders.find((x) => x.orderId === o.id);

// ═══ Commandes du mois ═══════════════════════════════════════════════════
check("Commandes du mois : lecture admin, une entrée par commande ayant une ligne en octobre", r.status === 200
  && so.orders.map((o) => o.orderNumber).sort().join(",") === "ORD-G,ORD-K,ORD-M,ORD-P1,ORD-PA,ORD-Q,ORD-Z,ORDM-U", so.orders.map((o) => o.orderNumber));
check("Commande à accepter : pas dans la compta", !so.orders.some((o) => o.orderNumber === "ORD-W"));
check("Commande annulée gardée visible (statut « cancelled »)", ord(Z)?.orderValidation === "cancelled" && Number(ord(Z).refunded) === 72);
check("Montants enregistrés de la commande multi-dates : articles 120, livraison 25, express 6, bienvenue 10, aucun écart", (() => {
  const c = ord(M).components; return Number(c.items) === 120 && Number(c.delivery) === 25 && Number(c.express) === 6 && Number(c.welcome) === 10 && Number(c.other) === 0;
})(), ord(M)?.components);
check("Multi-dates : « répartie sur plusieurs mois » (octobre, novembre)", ord(M).spansMonths === true && JSON.stringify(ord(M).months) === '["2026-10","2026-11"]');
check("Remise partenaire et cagnotte au niveau de la commande, montant = enregistré", Number(ord(PA).components.partner) === 9 && Number(ord(PA).components.reward) === 3.5
  && Number(ord(PA).components.other) === 0 && Number(ord(PA).amount) === 77.5 && ord(PA).partnerName === "Studio Partenaire");
check("Ajustement manuel (−5) au niveau de la commande", Number(ord(U).components.adjustment) === -5 && Number(ord(U).amount) === 50 && Number(ord(U).components.other) === 0);
check("Remboursé et net par commande (remboursements comptés, toutes dates)", Number(ord(K).refunded) === 35 && Number(ord(K).net) === 40
  && Number(ord(G).refunded) === 20 && Number(ord(G).refundedInMonth) === 0 && Number(ord(Z).refundedInMonth) === 72);
check("Payée en septembre, réalisée en octobre : listée avec sa date de paiement de septembre", !!ord(P1) && String(ord(P1).paidAt).slice(0, 7) === "2026-09");
const fOct = (await q("select public.admin_finance_month('2026-10-01', false) f"))[0].f;
check("… et AUCUN deuxième encaissement en octobre", !fOct.collections.some((c) => c.orderId === P1.id));
// Les lignes F17 regroupées par commande gardent les totaux (jamais montant × nombre de produits).
const byOrder = {};
for (const l of salesOct.lines) (byOrder[l.orderId] ??= []).push(l);
check("Lignes regroupées par commande : la somme = « ventes » F17 du mois (aucune duplication)", num(Object.values(byOrder).reduce((s, ls) => s + sum(ls.filter((l) => l.state !== "refused"))
  , 0)) === num(salesOct.cards.gross));
check("Quantité 2 : deux lignes de 30.50, pas 2 × 61", byOrder[Q2.id].length === 2 && byOrder[Q2.id].every((l) => Number(l.amount) === 30.5));
check("Multi-mois : part d'octobre + part de novembre = montant de la commande", num(sum(byOrder[M.id]) + sum(salesNov.lines.filter((l) => l.orderId === M.id))) === num(ord(M).amount));
check("Commandes sur un seul mois : somme des lignes = montant enregistré", [P1, K, G, U, Q2, Z, PA].every((o) => sum(byOrder[o.id]) === num(ord(o).amount)),
  [P1, K, G, U, Q2, Z, PA].map((o) => [o.num, sum(byOrder[o.id]), ord(o).amount]));
check("Reste à encaisser du mois inchangé (F17) : ORDM-U seulement", Number(salesOct.cards.toCollect) === 50 && salesOct.cards.toCollectOrders === 1);
check("Impayés des mois précédents : alerte séparée (ORDM-S, septembre, 70)", so.unpaidBefore.count === 1 && Number(so.unpaidBefore.amount) === 70
  && so.unpaidBefore.orders[0].orderNumber === "ORDM-S");
check("Mois invalide refusé", (await call({ action: "sales_orders_month", month: "2026-13" })).status === 400);
check("Non admin : refusé", (await call({ action: "sales_orders_month", month: "2026-10" }, "client-jwt")).status === 401);

// ═══ Dépenses communes, avance, solde (base du partage) ══════════════════
const settings = (await call({ action: "settings" })).body.data;
const cat = (name) => settings.categories.find((c) => c.name === name).id;
const payer = (slug) => settings.payers.find((p) => p.slug === slug).id;
const MEL = payer("mel"), BENTO = payer("bento");
r = await call({ action: "save", idempotencyKey: "dep-1", purchaseDate: "2026-10-10", supplier: "Migros", categoryId: cat("Matériel"), currency: "CHF", originalAmount: "50", status: "paid", paidAt: "2026-10-10", payerId: BENTO, receiptMissingReason: "test" });
const DEP1 = r.body.data;
await call({ action: "save", idempotencyKey: "dep-2", purchaseDate: "2026-10-12", supplier: "Coop", categoryId: cat("Matériel"), currency: "CHF", originalAmount: "80", status: "paid", paidAt: "2026-10-12", payerId: MEL, personalAdvance: true, receiptMissingReason: "test" });
await q("insert into public.bank_balances (balance_date, amount, created_by) values ('2026-10-31', 1500, 'test')");

const snapshot = async () => {
  const st = (await call({ action: "settlement_get", month: "2026-10-01" })).body.data;
  return JSON.stringify({
    figures: st.figures, treasury: st.treasury, draft: st.draft, partnersAdvances: st.partnersAdvances, bank: st.bankBalances,
    advances: (await call({ action: "advances_overview", month: "2026-10" })).body.data,
    period: (await call({ action: "period", from: "2026-10-01", to: "2026-10-31" })).body.data.totals,
    sales: (await call({ action: "sales_month", month: "2026-10" })).body.data.cards,
    receipts: (await call({ action: "receipts_period", from: "2026-10-01", to: "2026-10-31" })).body.data.length,
    expenses: (await one("select count(*)::int n from public.expenses")).n,
    moves: (await one("select (select count(*) from public.bank_balances) + (select count(*) from public.settlement_payouts) + (select count(*) from public.advance_repayments) n")).n,
  });
};
const before = await snapshot();

// ═══ Ajouts « fiduciaire uniquement » ════════════════════════════════════
const fid = (fields) => call({ action: "fiduciary_save", date: "2026-10-11", supplier: "Migros", categoryId: cat("Matériel"), amount: "50", payerId: BENTO, ...fields });
r = await fid({ idempotencyKey: "fid-1", description: "Ustensiles", comment: "à examiner" });
check("Doublon possible (même montant, 1 jour d'écart, même fournisseur qu'une dépense commune) : BLOQUÉ, rien d'enregistré", r.status === 409 && r.body.reason === "duplicate"
  && r.body.matches?.[0]?.code === DEP1.code && (await one("select count(*)::int n from public.fiduciary_expenses")).n === 0, r.body);
r = await fid({ idempotencyKey: "fid-1", description: "Ustensiles", comment: "à examiner", confirmNotDuplicate: true });
const FID1 = r.body.data;
check("Après « Ce n'est pas un doublon » : enregistré (FID-2026-0001), confirmation signalée", r.status === 200 && FID1.code === "FID-2026-0001" && FID1.confirmedNotDuplicate === true, r.body);
const conf = await q("select * from public.fiduciary_duplicate_confirmations where fiduciary_id=$1", [FID1.id]);
check("Confirmation gardée : auteur, date, lignes concernées", conf.length === 1 && conf[0].created_by === "naglemelodie@gmail.com" && conf[0].matches[0].code === DEP1.code && !!conf[0].created_at);
const hist = (await call({ action: "history", table: "fiduciary_duplicate_confirmations", id: conf[0].id })).body.data;
check("Confirmation dans l'historique", hist.length === 1 && hist[0].action === "insert" && hist[0].actor === "naglemelodie@gmail.com", hist);
r = await fid({ idempotencyKey: "fid-1", confirmNotDuplicate: true });
check("Double clic (même clé) : une seule ligne", r.body.data?.replayed === true && (await one("select count(*)::int n from public.fiduciary_expenses")).n === 1);
r = await fid({ idempotencyKey: "fid-2", supplier: "Galaxus", amount: "120", payerId: MEL, date: "2026-10-14", description: "Imprimante" });
const FID2 = r.body.data;
check("Ajout sans ressemblance : enregistré sans confirmation (payé par Mel)", r.status === 200 && FID2.code === "FID-2026-0002" && FID2.confirmedNotDuplicate === false, r.body);
r = await fid({ idempotencyKey: "fid-3", date: "2026-10-12" });
check("Ressemble à la dépense commune ET à l'ajout FID-0001 : les deux signalés, bloqué", r.status === 409 && r.body.matches.map((m) => m.code).sort().join(",") === [DEP1.code, "FID-2026-0001"].sort().join(","), r.body);
r = await call({ action: "fiduciary_save", id: FID2.id, date: "2026-10-13", supplier: "Migros", amount: "50", payerId: MEL });
check("Modification qui crée une ressemblance : bloquée aussi, ligne inchangée", r.status === 409 && r.body.reason === "duplicate" && Number((await one("select chf_amount from public.fiduciary_expenses where id=$1", [FID2.id])).chf_amount) === 120);
r = await call({ action: "fiduciary_save", id: FID2.id, date: "2026-10-14", supplier: "Galaxus", amount: "120", payerId: MEL, description: "Imprimante laser" });
check("Modification sans ressemblance : OK", r.status === 200 && (await one("select description from public.fiduciary_expenses where id=$1", [FID2.id])).description === "Imprimante laser");
check("Champs obligatoires : fournisseur", (await fid({ idempotencyKey: "x1", supplier: "" })).status === 409);
check("Champs obligatoires : montant positif", (await fid({ idempotencyKey: "x2", amount: "0" })).status === 409 && (await fid({ idempotencyKey: "x3", amount: "-3" })).status === 400);
check("Champs obligatoires : date", (await fid({ idempotencyKey: "x4", date: "" })).status === 400);
check("Non admin : refusé", (await fid({ idempotencyKey: "x5" }, "client-jwt")).status === 401 || (await call({ action: "fiduciary_save", date: "2026-10-11", supplier: "a", amount: "1" }, "client-jwt")).status === 401);

// Justificatifs
r = await call({ action: "fiduciary_upload_url", id: FID1.id, mimeType: "application/pdf", size: 1000, fileName: "Ticket Migros.pdf" });
const up = r.body.data;
check("Envoi de justificatif : URL signée, chemin fiduciary/<id>/ dans le bucket privé", r.status === 200 && up.path.startsWith(`fiduciary/${FID1.id}/`) && up.bucket === "expense-receipts", r.body);
r = await call({ action: "fiduciary_attach", id: FID1.id, path: up.path, fileName: "Ticket Migros.pdf", mimeType: "application/pdf", size: 1000 });
const att = r.body.data.id;
check("Justificatif rattaché ; un 2e envoi du même fichier ne crée pas de doublon", r.status === 200
  && (await call({ action: "fiduciary_attach", id: FID1.id, path: up.path, fileName: "Ticket Migros.pdf", mimeType: "application/pdf", size: 1000 })).body.data.id === att);
check("Chemin d'une autre ligne refusé", (await call({ action: "fiduciary_attach", id: FID2.id, path: up.path, fileName: "x.pdf", mimeType: "application/pdf" })).status === 409);
r = await call({ action: "fiduciary_view_attachment", id: FID1.id, attachmentId: att });
check("Consultation : lien signé de 5 minutes", r.status === 200 && r.body.data.url.includes(up.path) && r.body.data.expiresIn === 300);
let fp = (await call({ action: "fiduciary_period", from: "2026-10-01", to: "2026-10-31" })).body.data;
check("Période : 2 ajouts, total 170, 1 pièce manquante (FID-0002)", fp.count === 2 && Number(fp.total) === 170 && fp.missingReceiptCount === 1, fp);
check("Mention « Fiduciaire uniquement — traitement à valider » et confirmation visible", fp.items.every((i) => i.label === "Fiduciaire uniquement — traitement à valider" && i.treatment === "to_validate")
  && fp.items.find((i) => i.code === "FID-2026-0001").confirmations.length === 1);
let rec = (await call({ action: "receipts_period", from: "2026-10-01", to: "2026-10-31", includeFiduciary: true })).body.data;
check("Justificatifs du dossier fiduciaire : la pièce FID y figure avec son code", rec.some((x) => x.code === "FID-2026-0001" && x.path === up.path));
check("Justificatifs de la compta interne : sans les pièces fiduciaires", !(await call({ action: "receipts_period", from: "2026-10-01", to: "2026-10-31" })).body.data.some((x) => String(x.code).startsWith("FID")));

// ═══ Aucun effet sur la trésorerie, les avances ni le partage ════════════
const after = await snapshot();
check("Ajouts fiduciaires : résultat, trésorerie, réserve, parts, avances, dépenses, ventes et mouvements IDENTIQUES", after === before);
const adv = (await call({ action: "advances_overview", month: "2026-10" })).body.data;
check("Ajout payé par Mel : jamais une avance à rembourser", JSON.stringify(adv).includes("Coop") && !JSON.stringify(adv).includes("Galaxus"));

// Suppression (raison obligatoire), historique.
check("Suppression sans raison : refusée", (await call({ action: "fiduciary_delete", id: FID2.id })).status === 409);
r = await call({ action: "fiduciary_delete", id: FID2.id, reason: "saisie en double" });
fp = (await call({ action: "fiduciary_period", from: "2026-10-01", to: "2026-10-31" })).body.data;
check("Suppression logique : retirée de la période, gardée en base", r.status === 200 && fp.count === 1 && (await one("select deleted_by from public.fiduciary_expenses where id=$1", [FID2.id])).deleted_by === "naglemelodie@gmail.com");
const h2 = (await call({ action: "history", table: "fiduciary_expenses", id: FID2.id })).body.data;
check("Historique de l'ajout : création, modification, suppression", h2.map((x) => x.action).join(",") === "delete,update,insert", h2.map((x) => x.action));
check("Après suppression : toujours aucun effet sur le partage", (await snapshot()) === before);

// ═══ Droits et relance ═══════════════════════════════════════════════════
check("Tables fermées à anon / authenticated", (await one(`select count(*)::int n from information_schema.role_table_grants where table_schema='public'
  and table_name like 'fiduciary%' and grantee in ('anon','authenticated')`)).n === 0);
check("Fonctions F22 interdites à authenticated", (await one("select has_function_privilege('authenticated','public.fiduciary_save(uuid,text,date,text,uuid,text,numeric,uuid,text,text,boolean,text)','execute') a, has_function_privilege('authenticated','public.admin_sales_orders_month(date,boolean)','execute') b"))
  .a === false);
const snapF = JSON.stringify(await q("select id, code, chf_amount, deleted_at from public.fiduciary_expenses order by code"));
await db.exec(fs.readFileSync(F22, "utf8"));
check("Relance de F22 : sans erreur, rien ne change", JSON.stringify(await q("select id, code, chf_amount, deleted_at from public.fiduciary_expenses order by code")) === snapF && (await snapshot()) === before);

// ═══ Export « dossier fiduciaire » par période (vrai code du site) ══════
const REPO = path.resolve(ROOT, "..");
fs.writeFileSync(path.join(tmp, "client.mjs"), "export const supabase = {};");
await build({
  entryPoints: [path.join(REPO, "src/lib/fiduciaryExport.ts")], bundle: true, format: "esm", platform: "node",
  outfile: path.join(tmp, "fx.mjs"), logLevel: "warning", external: ["exceljs", "jszip"],
  loader: { ".png": "empty", ".jpg": "empty", ".jpeg": "empty", ".webp": "empty", ".svg": "empty", ".gif": "empty" },
  plugins: [{ name: "alias", setup(b) {
    b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: path.join(tmp, "client.mjs") }));
    b.onResolve({ filter: /^@\// }, (a) => {
      const base = path.join(REPO, "src", a.path.slice(2));
      for (const ext of ["", ".ts", ".tsx", "/index.ts"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return { path: base + ext };
      return { path: base };
    });
    b.onResolve({ filter: /^jszip$/ }, () => ({ path: path.join(REPO, "node_modules/jszip/lib/index.js") }));
  } }],
});
const FX = await import(path.join(tmp, "fx.mjs"));
const ExcelJS = (await import(path.join(REPO, "node_modules/exceljs/excel.js"))).default;
const JSZip = (await import(path.join(REPO, "node_modules/jszip/lib/index.js"))).default;
// Une dépense commune sans justificatif ni raison (pièce manquante), une avec justificatif.
r = await call({ action: "save", idempotencyKey: "dep-3", purchaseDate: "2026-11-04", supplier: "Manor", categoryId: cat("Matériel"), currency: "CHF", originalAmount: "33", status: "paid", paidAt: "2026-11-04", payerId: BENTO });
const DEP3 = r.body.data;
r = await call({ action: "upload_url", expenseId: DEP1.id, mimeType: "image/jpeg", size: 500, fileName: "ticket migros.jpg" });
await call({ action: "attach", expenseId: DEP1.id, path: r.body.data.path, fileName: "ticket migros.jpg", mimeType: "image/jpeg", size: 500 });
const fin = async (m) => (await q("select public.admin_finance_month($1::date, false) f", [`${m}-01`]))[0].f;
const months = ["2026-10", "2026-11"];
const data = {
  from: "2026-10-01", to: "2026-11-30", months,
  sales: await Promise.all(months.map(async (m) => (await call({ action: "sales_month", month: m })).body.data)),
  orders: await Promise.all(months.map(async (m) => (await call({ action: "sales_orders_month", month: m })).body.data)),
  finance: await Promise.all(months.map(fin)),
  salary: await Promise.all(months.map(async (m) => (await call({ action: "salary_overview", month: m })).body.data)),
  expenses: (await call({ action: "period", from: "2026-10-01", to: "2026-11-30" })).body.data,
  fiduciary: (await call({ action: "fiduciary_period", from: "2026-10-01", to: "2026-11-30" })).body.data,
  receipts: (await call({ action: "receipts_period", from: "2026-10-01", to: "2026-11-30", includeFiduciary: true })).body.data,
};
const fetched = [];
const { blob, files, missing } = await FX.buildFiduciaryZip(ExcelJS, data, async (url) => { fetched.push(url); return new Blob([`fichier ${url}`]); });
const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
const names = Object.keys(zip.files);
const xlsxName = names.find((n) => n.endsWith(".xlsx"));
check("Export : un Excel nommé par période, un LISEZMOI et un index", xlsxName === "Bento-Cake-Studio_dossier-fiduciaire_2026-10_2026-11.xlsx" && names.includes("LISEZMOI.txt") && names.includes("justificatifs/index.csv"), names);
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(await zip.file(xlsxName).async("nodebuffer"));
check("Feuilles : synthèse, commandes, montants, paiements, remboursements, dépenses, salaire, ajouts, justificatifs, pièces manquantes",
  wb.worksheets.map((w) => w.name).join("|") === "Synthèse|Commandes|Montants des commandes|Paiements|Remboursements|Dépenses communes|Salaire|Ajouts fiduciaires|Justificatifs|Pièces manquantes",
  wb.worksheets.map((w) => w.name));
const rows = (name) => { const out = []; wb.getWorksheet(name).eachRow((row, i) => { if (i > 1) out.push(row); }); return out; };
const cellNum = (v) => Number(typeof v === "object" && v ? v.result ?? v : v);
check("Commandes : une ligne par gâteau / workshop des 2 mois (aucune duplication)", rows("Commandes").length === data.sales[0].lines.length + data.sales[1].lines.length);
check("Commandes : la vente nette des lignes = ventes nettes des 2 mois",
  Math.round(rows("Commandes").reduce((s, r) => s + cellNum(r.getCell(14).value), 0) * 100) / 100 === Math.round((Number(data.sales[0].cards.net) + Number(data.sales[1].cards.net)) * 100) / 100);
const syn = Object.fromEntries(rows("Synthèse").map((r) => [String(r.getCell(1).value), r.getCell(2).value]));
check("Synthèse : ventes nettes, encaissements, remboursements = chiffres de la page",
  Number(syn["Ventes nettes (mois de réalisation)"]) === Math.round((Number(data.sales[0].cards.net) + Number(data.sales[1].cards.net)) * 100) / 100
  && Number(syn["Encaissements"]) === Math.round((Number(data.finance[0].cards.collected) + Number(data.finance[1].cards.collected)) * 100) / 100
  && Number(syn["Remboursements effectués"]) === Math.round((Number(data.finance[0].cards.refunded) + Number(data.finance[1].cards.refunded)) * 100) / 100, syn);
check("Synthèse : dépenses communes et ajouts fiduciaires totalisés À PART (50 + 80 + 33 / 50)", Number(syn["Dépenses communes (date d'achat dans la période)"]) === 163
  && Number(syn["Ajouts « fiduciaire uniquement »"]) === 50 && Number(syn["Écart avec notre suivi interne"]) === 50, syn);
check("Montants des commandes : multi-mois marqué « prorata », remise partenaire négative", rows("Montants des commandes").some((r) => r.getCell(2).value === "ORD-M" && String(r.getCell(16).value).includes("prorata"))
  && rows("Montants des commandes").some((r) => r.getCell(2).value === "ORD-PA" && cellNum(r.getCell(9).value) === -9));
check("Paiements : P1 (payé en septembre) absent de la période octobre–novembre", !rows("Paiements").some((r) => r.getCell(2).value === "ORD-P1"));
// Chaque justificatif ↔ sa ligne.
const idx = rows("Justificatifs");
const okRefs = idx.every((r) => {
  const sheetName = r.getCell(3).value, line = r.getCell(4).value, file = String(r.getCell(1).value);
  const target = wb.getWorksheet(sheetName)?.getRow(line);
  return target && String(target.getCell(1).value) === r.getCell(2).value && String(target.values.find((v) => typeof v === "string" && v.includes(file)) ?? "").includes(file) && !!zip.file(file);
});
check("Chaque justificatif : référence = sa ligne Excel (feuille + n° de ligne), fichier présent dans le ZIP", idx.length === 2 && okRefs, idx.map((r) => r.values));
check("Fichiers nommés par référence (DEP-…, FID-…)", files.every((f) => f.name.startsWith(f.code + "_")) && files.some((f) => f.code.startsWith("FID-")) && files.some((f) => f.code.startsWith("DEP-")));
check("Pièces manquantes signalées : la dépense sans justificatif ni raison (Manor)", missing.length === 1 && missing[0].ref === DEP3.code && rows("Pièces manquantes").length === 1, missing);
check("Ajouts fiduciaires : mention et confirmation « Ce n'est pas un doublon » dans l'Excel", rows("Ajouts fiduciaires").length === 1
  && String(rows("Ajouts fiduciaires")[0].getCell(8).value) === "Fiduciaire uniquement — traitement à valider" && String(rows("Ajouts fiduciaires")[0].getCell(10).value).includes(DEP1.code));
check("Rien n'est envoyé : seuls les justificatifs sont lus (liens signés)", fetched.length === 2 && fetched.every((u) => u.startsWith("https://signed.test/")));
const failing = await FX.buildFiduciaryZip(ExcelJS, data, async () => { throw new Error("404"); });
check("Justificatif non récupéré : signalé comme pièce manquante, jamais silencieux", failing.missing.length === 3 && failing.files.every((f) => !f.ok));
check("Export : aucun effet sur le partage", (await snapshot()) !== "" && JSON.parse(await snapshot()).moves === JSON.parse(before).moves);

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
