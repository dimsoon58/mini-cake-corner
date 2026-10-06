// Sortie de Notion / Make (F24) — interrupteur notion_sync_enabled (actif par
// défaut), alertes Notion conditionnelles, déclencheurs make_*, rapport
// quotidien Supabase (un e-mail par jour au plus), sessions workshop.
// Schéma de production (PGlite) + F1–F24, vrai code partagé (order-side-
// effects, workshop-make, order-refunds) et vraies fonctions daily-health-
// report et manage-workshop-sessions. Make, Resend et les fonctions d'e-mail
// sont SIMULÉS : aucun e-mail, aucun appel réseau, aucun paiement.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_notion_exit.mjs
import { freshDb } from "./load.mjs";
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

process.on("unhandledRejection", (e) => { console.log("ERROR:", e?.stack ?? e); process.exit(2); });

const ROOT = path.resolve(import.meta.dirname, "../..");
const MIG = path.join(ROOT, "migrations");
let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 700) : ""); } };

const migrations = fs.readdirSync(MIG).filter((f) => /^202610(02(09|10|11|12|13|14|16|17|18|19)|03|04|05)/.test(f)).sort().map((f) => path.join(MIG, f));
const F24 = migrations.find((f) => f.includes("_f24_"));
const db = await freshDb({ migrations });
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

// ── supabase-js minimal → SQL ────────────────────────────────────────────
const fmt = (v, type) => (v instanceof Date ? (type === 1082 ? v.toISOString().slice(0, 10) : v.toISOString()) : v);
function from(table) {
  let cols = "*", orderBy = "", lim = "", op = "select", values = null, single = null, returning = false; const where = []; const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const b = {
    select(c) { if (op !== "select") returning = true; cols = (c ?? "*").split(",").map((s) => s.trim()).filter(Boolean).join(", "); return b; },
    update(v) { op = "update"; values = v; return b; },
    insert(v) { op = "insert"; values = v; return b; },
    eq(c, v) { where.push(`${c}::text = ${p(String(v))}`); return b; },
    neq(c, v) { where.push(`${c}::text is distinct from ${p(String(v))}`); return b; },
    gte(c, v) { where.push(`${c} >= ${p(v)}`); return b; },
    lte(c, v) { where.push(`${c} <= ${p(v)}`); return b; },
    lt(c, v) { where.push(`${c} < ${p(v)}`); return b; },
    in(c, v) { where.push(`${c}::text = any(${p(v.map(String))}::text[])`); return b; },
    is(c, v) { where.push(v === null ? `${c} is null` : `${c} is ${v}`); return b; },
    not(c, opr, v) { where.push(opr === "is" && v === null ? `${c} is not null` : `not (${c} ${opr} ${p(v)})`); return b; },
    or() { return b; },
    order(c, o = {}) { orderBy += `${orderBy ? "," : " order by"} ${c} ${o.ascending === false ? "desc" : "asc"}`; return b; },
    limit(n) { lim = ` limit ${Number(n)}`; return b; },
    maybeSingle() { single = "maybe"; return b; },
    single() { single = "one"; return b; },
    then(res, rej) {
      const w = where.length ? ` where ${where.join(" and ")}` : "";
      let sql;
      if (op === "update") sql = `update public.${table} set ${Object.entries(values).map(([k, v]) => `${k} = ${p(v)}`).join(", ")}${w} returning ${returning ? cols : "id"}`;
      else if (op === "insert") { const ks = Object.keys(values); sql = `insert into public.${table} (${ks.join(", ")}) values (${ks.map((k) => p(values[k])).join(", ")}) returning ${returning ? cols : "id"}`; }
      else sql = `select ${cols} from public.${table}${w}${orderBy}${lim}`;
      db.query(sql, params)
        .then((r) => {
          const rows = r.rows.map((row) => Object.fromEntries(r.fields.map((f) => [f.name, fmt(row[f.name], f.dataTypeID)])));
          if (single) return res({ data: rows[0] ?? null, error: single === "one" && !rows[0] ? { message: "no rows" } : null });
          res({ data: rows, error: null });
        })
        .catch((e) => res({ data: null, error: { message: e.message, code: e.code } }))
        .catch(rej);
    },
  };
  return b;
}
const rpcCalls = [];
const rpc = async (fn, args = {}) => {
  rpcCalls.push(fn);
  const ks = Object.keys(args);
  try {
    const res = await db.query(`select * from public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(", ")})`,
      ks.map((k) => (Array.isArray(args[k]) ? args[k] : args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k])));
    const cols = res.fields.map((f) => f.name);
    return { data: cols.length === 1 && cols[0] === fn ? (res.rows[0]?.[fn] ?? null) : res.rows, error: null };
  } catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
};
const invokes = [];
const fetches = [];
globalThis.__supa = {
  from, rpc,
  functions: { invoke: async (name, opts) => { invokes.push({ name, body: opts?.body }); return { data: { success: true }, error: null }; } },
  auth: { getUser: async (j) => ({ data: { user: j === "admin-jwt" ? { email: "naglemelodie@gmail.com" } : j === "client-jwt" ? { email: "x@y.ch" } : null }, error: null }) },
  storage: { from: () => ({ upload: async () => ({ data: {}, error: null }), createSignedUrl: async (p) => ({ data: { signedUrl: `https://signed.test/${p}` }, error: null }) }) },
};
let resendStatus = 200;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  fetches.push({ url: u, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null });
  if (u.includes("api.resend.com")) return new Response(JSON.stringify({ id: `email-${fetches.length}` }), { status: resendStatus });
  if (u.includes("make.com") || u.includes("make.test")) return new Response("Accepted", { status: 200 });
  throw new Error("réseau inattendu " + u);
};
const ENV = { RETRY_SWEEP_SECRET: "retry-secret", SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x", ADMIN_ORDER_PIN: "1234", RESEND_API_KEY: "re_test", DAILY_REPORT_SECRET: "daily-secret",
  MAKE_WORKSHOP_WEBHOOK_URL: "https://hook.make.test/workshops", MAKE_REPAIR_WEBHOOK_URL: "https://hook.make.test/repair", MAKE_REPAIR_TOKEN: "t", SITE_BASE_URL: "https://site.test" };
globalThis.Deno = { env: { get: (k) => ENV[k] } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nx-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), "export function createClient() { return globalThis.__supa; }");
fs.writeFileSync(path.join(tmp, "pdf.mjs"), "export const PDFDocument = { create: async () => { throw new Error('pdf'); } }; export const StandardFonts = {}; export const rgb = () => null;");
const plugins = [{ name: "m", setup(b) {
  b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
  b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
  b.onResolve({ filter: /^npm:pdf-lib/ }, () => ({ path: path.join(tmp, "pdf.mjs") }));
} }];
// Un seul paquet pour le code partagé : même instance de l'interrupteur partout.
fs.writeFileSync(path.join(tmp, "entry.ts"), [
  `export * from "${path.join(ROOT, "functions/_shared/order-side-effects.ts")}";`,
  `export { claimAndDispatchWorkshopReservationSync, retryPendingWorkshopReservationSync } from "${path.join(ROOT, "functions/_shared/workshop-make.ts")}";`,
  `export { applyOrderRefund } from "${path.join(ROOT, "functions/_shared/order-refunds.ts")}";`,
  `export { notionSyncEnabled, resetNotionSyncCache } from "${path.join(ROOT, "functions/_shared/notion-sync.ts")}";`,
].join("\n"));
await build({ entryPoints: [path.join(tmp, "entry.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "shared.mjs"), logLevel: "error", plugins });
const S = await import(path.join(tmp, "shared.mjs"));
const fns = {};
for (const name of ["daily-health-report", "manage-workshop-sessions", "retry-order-side-effects", "confirm-workshop-refund"]) {
  await build({ entryPoints: [path.join(ROOT, `functions/${name}/index.ts`)], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, `${name}.mjs`), logLevel: "error", plugins });
  await import(path.join(tmp, `${name}.mjs`));
  fns[name] = globalThis.__handler;
}
const call = async (name, body, { jwt = "admin-jwt", query = "" } = {}) => {
  const r = await fns[name](new Request(`http://x/${query}`, { method: "POST", headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body ?? {}) }));
  return { status: r.status, body: await r.json() };
};
const setNotion = async (v) => { await q("update public.app_settings set value = $1::jsonb, updated_by = 'test' where key = 'notion_sync_enabled'", [JSON.stringify(v)]); S.resetNotionSyncCache(); };
const makeCalls = () => fetches.filter((f) => /make\.(com|test)/.test(f.url)).length;

// ── Données ─────────────────────────────────────────────────────────────
// Les 4 sessions présentes en production (le schéma de référence n'a pas de données).
await q(`insert into public.workshop_sessions (id, workshop_type, workshop_date, workshop_time, unit_price, max_capacity) values
  ('sig-2026-10-03','signature','2026-10-03','13:00',85,8), ('paint-2026-10-07','paint','2026-10-07','14:00',65,10),
  ('paint-2026-10-10','paint','2026-10-10','14:00',65,10), ('paint-2026-10-14','paint','2026-10-14','14:00',65,10) on conflict (id) do nothing`);
let n = 0;
async function webOrder({ paid = false, finalized = true, minutesAgo = 30, workshop = false, notion = "pending" } = {}) {
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, order_validation, physical_validation,
      pickup_delivery_date, order_source, fulfillment_type, finalized_at, notion_sync_status, created_at, postfinance_transaction_id)
    values ('fr','Test','Client',$1,'079',90,$2,'pending',$3,'2026-10-20','website',$4,$5,$6, now() - ($7 || ' minutes')::interval, 'pf-' || $1) returning id`,
    [`t${++n}@example.com`, paid ? "paid" : "pending", workshop ? "not_applicable" : "pending", workshop ? "workshop_only" : "cake_only",
     finalized ? new Date().toISOString() : null, notion, String(minutesAgo)]);
  await q("update public.orders set order_number=$2 where id=$1", [o.id, `ORD-NX-${n}`]);
  if (workshop) {
    const it = await one(`insert into public.order_items (order_id, product, total, workshop_type, workshop_participants, workshop_session_id, workshop_date, workshop_time)
      values ($1,'workshop',65,'paint',1,'paint-2026-10-14','2026-10-14','14:00') returning id`, [o.id]);
    await q(`insert into public.workshop_reservations (workshop_reference, order_id, order_item_id, workshop_session_id, workshop_type, purchased_seats, cancelled_seats, unit_price, status)
      values ($1,$2,$3,'paint-2026-10-14','paint',1,0,65,'pending')`, [`WS-NX-${n}`, o.id, it.id]);
  } else {
    await q("insert into public.order_items (order_id, product, total, size, flavors) values ($1,'bento_cake',90,'10cm','{vanilla}')", [o.id]);
  }
  return o.id;
}
const anomalies = async () => (await q("select issue_type, order_number from public.order_health_anomalies")).map((r) => r.issue_type);

// ═══ 1. Réglages par défaut : rien ne change ═════════════════════════════
check("Par défaut : synchronisation Notion ACTIVE, rapport Supabase INACTIF", (await one("select public.notion_sync_enabled() a, public.app_setting_bool('daily_report_enabled', true) b")).a === true
  && (await one("select public.app_setting_bool('daily_report_enabled', true) b")).b === false);
check("Clé absente : valeur par défaut (jamais « désactivé » par erreur)", (await one("select public.app_setting_bool('inconnue', true) v")).v === true);
check("Interrupteur lu par les fonctions : actif", (await S.notionSyncEnabled(globalThis.__supa)) === true);

// ═══ 2. Alertes Notion : seulement si la synchronisation est active ══════
const late = await webOrder({ paid: true, minutesAgo: 30 });
await q("insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, order_source, fulfillment_type, postfinance_transaction_id, order_number) values ('fr','A','B','x@example.com','0',10,'paid','website','cake_only',null,'ORD-NX-REF')");
let a = await anomalies();
check("Notion actif : alerte « SYNCHRO_NOTION » présente (comme aujourd'hui)", a.includes("SYNCHRO_NOTION"), a);
check("Autres alertes inchangées (paiement sans référence)", a.includes("PAIEMENT_SANS_REFERENCE"));
const sumOn = (await one("select anomaly_count from public.order_health_summary")).anomaly_count;
await setNotion(false);
a = await anomalies();
check("Notion désactivé : l'alerte Notion disparaît, les autres restent", !a.includes("SYNCHRO_NOTION") && a.includes("PAIEMENT_SANS_REFERENCE"), a);
check("Rapport de 8 h (order_health_summary) : compte sans l'alerte Notion", (await one("select anomaly_count from public.order_health_summary")).anomaly_count === sumOn - 1);
await setNotion(true);

// ═══ 3. Déclencheurs make_* (pg_net) ═════════════════════════════════════
const netCalls = async () => (await one("select count(*)::int n from net._calls")).n;
let before = await netCalls();
await q("update public.orders set payment_status='paid' where id=$1", [await webOrder()]);
check("Notion actif : changement de paiement → envoi pg_net (comme avant)", (await netCalls()) === before + 1);
await setNotion(false);
before = await netCalls();
await q("update public.orders set payment_status='paid' where id=$1", [await webOrder()]);
const uid = (await one("select gen_random_uuid() id")).id;
await q("insert into auth.users (id, email) values ($1,'nx-profile@example.com')", [uid]);
await q("update public.profiles set newsletter_subscription = true where id=$1", [uid]);
check("Notion désactivé : aucun envoi pg_net (paiement, nouveau profil, cagnotte / newsletter)", (await netCalls()) === before, { before, after: await netCalls() });
await setNotion(true);
before = await netCalls();
await q("update public.profiles set newsletter_subscription = false where id=$1", [uid]);
check("Notion réactivé : envois rétablis", (await netCalls()) === before + 1);

// ═══ 4. Après paiement : e-mails sans Make, rien en double ════════════════
const o1 = await webOrder();
let m0 = makeCalls(), i0 = invokes.length;
let r = await S.runSideEffects(globalThis.__supa, o1);
check("Notion actif : envoi vers Make (7026183) et e-mails admin + client", makeCalls() === m0 + 1 && invokes.slice(i0).map((x) => x.name).sort().join(",") === "notify-order,send-order-received-email", invokes.slice(i0));
check("Notion actif : commande PAS terminée tant que Make n'a pas confirmé (comme aujourd'hui)", r.complete === false && !(await one("select side_effects_done_at from public.orders where id=$1", [o1])).side_effects_done_at);
await setNotion(false);
m0 = makeCalls(); i0 = invokes.length;
r = await S.runSideEffects(globalThis.__supa, o1);
check("Notion désactivé : commande terminée SANS Make, aucun nouvel e-mail (marqueurs)", r.complete === true && makeCalls() === m0 && invokes.length === i0
  && !!(await one("select side_effects_done_at from public.orders where id=$1", [o1])).side_effects_done_at);
const o2 = await webOrder();
m0 = makeCalls(); i0 = invokes.length;
r = await S.runSideEffects(globalThis.__supa, o2);
const second = await S.runSideEffects(globalThis.__supa, o2);
check("Notion désactivé, nouvelle commande : 1 e-mail admin + 1 e-mail client, AUCUN appel Make, terminée", r.complete === true && makeCalls() === m0
  && invokes.slice(i0).map((x) => x.name).sort().join(",") === "notify-order,send-order-received-email", invokes.slice(i0));
check("Reprise suivante : rien de renvoyé", second.complete === true && invokes.length === i0 + 2 && makeCalls() === m0);
check("areSideEffectsComplete : vrai sans confirmation Make quand Notion est désactivé", (await S.areSideEffectsComplete(globalThis.__supa, o2)) === true
  && !(await one("select make_notified_at from public.orders where id=$1", [o2])).make_notified_at);

// Workshops (7319889)
const w1 = await webOrder({ workshop: true });
const res1 = (await one("select id from public.workshop_reservations where order_id=$1", [w1])).id;
m0 = makeCalls(); const rc0 = rpcCalls.length;
let d = await S.claimAndDispatchWorkshopReservationSync(globalThis.__supa, res1);
check("Notion désactivé : aucun envoi workshop vers Make, aucune réservation verrouillée", d.dispatched === false && makeCalls() === m0
  && !rpcCalls.slice(rc0).includes("claim_workshop_reservation_make_sync"));
const sweep = await S.retryPendingWorkshopReservationSync(globalThis.__supa);
check("Notion désactivé : la reprise workshop n'envoie rien", sweep.scanned === 0 && makeCalls() === m0);
await setNotion(true);
d = await S.claimAndDispatchWorkshopReservationSync(globalThis.__supa, res1);
check("Notion actif : envoi workshop vers Make comme avant", d.dispatched === true && makeCalls() === m0 + 1 && fetches.at(-1).url === ENV.MAKE_WORKSHOP_WEBHOOK_URL, d);

// Remboursement marqué fait (ancien bouton) → webhook statut (7028025, déjà désactivé)
const rf = await webOrder({ paid: true });
await q("update public.orders set refund_status='to_refund', refund_due_amount=90 where id=$1", [rf]);
await setNotion(false);
m0 = makeCalls();
await S.applyOrderRefund(globalThis.__supa, rf, { reference: "REF-1", isFullRefund: false });
check("Notion désactivé : remboursement enregistré, aucun appel Make", (await one("select refund_status from public.orders where id=$1", [rf])).refund_status === "refunded" && makeCalls() === m0);
await setNotion(true);

// ═══ 4b. Écarts avec la production séparés du lot (phase 0) ═════════════
// Reprise des factures gâteau (étape 0c) : absente de la reprise planifiée en production.
await setNotion(false);
const inv1 = await webOrder({ paid: true });
await q("update public.orders set order_validation='approved', physical_validation='approved' where id=$1", [inv1]);
let rc = rpcCalls.length;
await S.runSideEffects(globalThis.__supa, inv1, { physicalInvoiceRetry: false });
check("Reprise planifiée (option désactivée) : aucune tentative de facture gâteau", !rpcCalls.slice(rc).includes("claim_technical_alert")
  && !(await one("select invoice_path from public.orders where id=$1", [inv1])).invoice_path);
const inv2 = await webOrder({ paid: true });
await q("update public.orders set order_validation='approved', physical_validation='approved' where id=$1", [inv2]);
rc = rpcCalls.length;
await S.runSideEffects(globalThis.__supa, inv2);
check("Paiement / webhook (par défaut) : la tentative de facture gâteau existe toujours, comme en production", rpcCalls.slice(rc).includes("claim_technical_alert"));
const inv3 = await webOrder({ paid: true });
await q("update public.orders set order_validation='approved', physical_validation='approved' where id=$1", [inv3]);
rc = rpcCalls.length;
r = await fns["retry-order-side-effects"](new Request("http://x/?s=retry-secret", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
check("Vraie fonction retry-order-side-effects : passe les commandes, sans tentative de facture gâteau", r.status === 200 && rpcCalls.slice(rc).includes("claim_side_effect_retry")
  && !rpcCalls.slice(rc).includes("claim_technical_alert") && !(await one("select invoice_path from public.orders where id=$1", [inv3])).invoice_path, r.status);
await setNotion(true);
// CORS de confirm-workshop-refund : identiques à la production (« * »).
for (const origin of [null, "https://dimsoon58.github.io", "https://autre-origine.example"]) {
  const rr = await fns["confirm-workshop-refund"](new Request("http://x/", { method: "OPTIONS", headers: origin ? { Origin: origin } : {} }));
  check(`confirm-workshop-refund OPTIONS (origine ${origin ?? "aucune"}) : « * » comme en production`, rr.headers.get("Access-Control-Allow-Origin") === "*");
}
const cr = await fns["confirm-workshop-refund"](new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://autre-origine.example" }, body: "{}" }));
check("confirm-workshop-refund sans PIN : toujours refusé (CORS sans effet sur la sécurité)", cr.status >= 400 && cr.headers.get("Access-Control-Allow-Origin") === "*", cr.status);

// ═══ 4c. Retour en arrière : les commandes terminées pendant la coupure ═══
// La reprise ne prend que les commandes sans « terminée » : celles terminées pendant la coupure
// doivent être remises explicitement en file (requêtes de la checklist, phase 4).
// make_notified_at vide = « pas de confirmation Notion », pas forcément « jamais envoyée ».
const mainCalls = () => fetches.filter((f) => f.url === S.MAKE_WEBHOOK_URL).length;
const repairCalls = () => fetches.filter((f) => f.url === ENV.MAKE_REPAIR_WEBHOOK_URL).length;
const col = async (id, c) => (await one(`select ${c} v from public.orders where id=$1`, [id])).v;
// Avant la coupure : C envoyée au scénario principal, sans confirmation (Make arrêté en cours de route) ;
// B envoyée, sa confirmation arrivera pendant les 5 minutes de la bascule ; un ancien cas terminé hors coupure.
const cutC = await webOrder();
await S.runSideEffects(globalThis.__supa, cutC);
await q("update public.orders set make_webhook_dispatched_at = now() - interval '20 minutes' where id=$1", [cutC]);
// C2 : même situation, mais Make est mort AVANT de créer la fiche Notion (fiche absente).
const cutC2 = await webOrder();
await S.runSideEffects(globalThis.__supa, cutC2);
await q("update public.orders set make_webhook_dispatched_at = now() - interval '20 minutes', notion_sync_status = 'processing' where id=$1", [cutC2]);
const cutB = await webOrder();
await S.runSideEffects(globalThis.__supa, cutB);
const legacy = await webOrder();
await q("update public.orders set side_effects_done_at = now() - interval '30 days' where id=$1", [legacy]);
await setNotion(false);
const cutA = await webOrder();
for (const id of [cutA, cutB, cutC, cutC2]) await S.runSideEffects(globalThis.__supa, id);
await q("update public.orders set notion_sync_status='synced' where id=$1", [cutB]);
check("Pendant la coupure : A, B et C terminées, aucune confirmation Notion notée",
  (await Promise.all([cutA, cutB, cutC].map((id) => col(id, "side_effects_done_at")))).every(Boolean)
  && (await Promise.all([cutA, cutB, cutC].map((id) => col(id, "make_notified_at")))).every((v) => !v));
check("C a bien déjà été envoyée avant la coupure (make_notified_at vide ≠ jamais envoyée)", !!(await col(cutC, "make_webhook_dispatched_at")) && !(await col(cutA, "make_webhook_dispatched_at")));
await setNotion(true);
const pick = async () => (await q(`select id from public.orders where finalized_at is not null and side_effects_done_at is null and order_failure_reason is null`)).map((x) => x.id);
check("Après réactivation, SANS remise en file : la reprise ne les reprend pas (d'où les requêtes de la checklist)", !(await pick()).some((id) => [cutA, cutB, cutC].includes(id)));
const fx = (f) => fs.readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");
const listed = await q(fx("f24-rollback-select.sql"));
const cas = Object.fromEntries(listed.map((x) => [x.id, x.cas]));
check("Étape 1 (lecture seule) : A, B et C listées avec le bon cas — y compris C finalisée AVANT la coupure",
  cas[cutA] === "A_jamais_envoyee" && cas[cutB] === "B_confirmee_entre_temps" && cas[cutC] === "C_envoyee_sans_confirmation", cas);
check("Étape 1 : C2 (fiche absente) aussi en cas C", cas[cutC2] === "C_envoyee_sans_confirmation");
check("Étape 1 : rien d'autre (ancienne commande terminée hors coupure exclue)", listed.length === 4 && !cas[legacy], listed.map((x) => x.order_number));
m0 = makeCalls(); i0 = invokes.length; let mc0 = mainCalls(), rp0 = repairCalls();
await db.exec(fx("f24-rollback-requeue.sql"));
let picked = await pick();
check("Étape 2 : A et B remises en file, C NON", picked.includes(cutA) && picked.includes(cutB) && !picked.includes(cutC) && !picked.includes(cutC2));
for (const id of [cutA, cutB]) await S.runSideEffects(globalThis.__supa, id);
check("A : un seul premier envoi (7026183), aucun e-mail renvoyé", mainCalls() === mc0 + 1 && repairCalls() === rp0 && invokes.length === i0);
check("B : aucun envoi, confirmation notée, terminée", !!(await col(cutB, "make_notified_at")) && !!(await col(cutB, "side_effects_done_at")) && makeCalls() === m0 + 1);
await S.runSideEffects(globalThis.__supa, cutA);
check("A, passage suivant : rien de renvoyé en attendant la confirmation", makeCalls() === m0 + 1);
// Étapes 3a / 3b : listes d'ID explicites, vérifiées dans Notion par l'ID Supabase.
const withIds = (sql, ids) => sql.replace("('00000000-0000-0000-0000-000000000000'::uuid)", ids.map((id) => `('${id}'::uuid)`).join(", "));
const noop3a = await q(fx("f24-rollback-requeue-repair.sql"));
const noop3b = await q(fx("f24-rollback-resend-absent.sql"));
check("Étapes 3a / 3b avec la liste d'exemple : aucune ligne modifiée", noop3a.length === 0 && noop3b.length === 0 && !(await pick()).includes(cutC));
const up3a = await q(withIds(fx("f24-rollback-requeue-repair.sql"), [cutC, cutB, legacy]));
picked = await pick();
check("Étape 3a (fiche présente) : seule la commande C listée est remise en file (B, ancienne et C2 ignorées)",
  up3a.length === 1 && up3a[0].id === cutC && picked.includes(cutC) && !picked.includes(cutC2), up3a);
await S.runSideEffects(globalThis.__supa, cutC);
check("C (fiche présente) : réparation seule (7323863), JAMAIS de second premier envoi, aucun e-mail", repairCalls() === rp0 + 1 && mainCalls() === mc0 + 1 && invokes.length === i0
  && fetches.at(-1).body?.orderId === cutC);
await S.runSideEffects(globalThis.__supa, cutC);
check("C, passage suivant : pas de seconde réparation dans les 10 minutes", repairCalls() === rp0 + 1);
await q("update public.orders set notion_sync_status='error' where id=$1", [cutC]);
await S.runSideEffects(globalThis.__supa, cutC);
check("C en erreur Notion : encore la réparation seule, jamais le premier envoi", repairCalls() === rp0 + 2 && mainCalls() === mc0 + 1);
const up3b = await q(withIds(fx("f24-rollback-resend-absent.sql"), [cutC2, cutB, cutA]));
check("Étape 3b (fiche absente) : seule C2 est rendue « jamais envoyée » (A et B refusées)", up3b.length === 1 && up3b[0].id === cutC2, up3b);
check("Étape 3b : C2 de nouveau en attente Notion, sans trace d'envoi", (await col(cutC2, "notion_sync_status")) === "pending" && !(await col(cutC2, "make_webhook_dispatched_at")) && (await pick()).includes(cutC2));
const rp1 = repairCalls();
await S.runSideEffects(globalThis.__supa, cutC2);
check("C2 (fiche absente) : un seul PREMIER envoi vers 7026183, aucune réparation, aucun e-mail", mainCalls() === mc0 + 2 && repairCalls() === rp1 && invokes.length === i0
  && fetches.at(-1).url === S.MAKE_WEBHOOK_URL);
await S.runSideEffects(globalThis.__supa, cutC2);
check("C2, passage suivant : rien de renvoyé en attendant la confirmation", mainCalls() === mc0 + 2 && repairCalls() === rp1);
check("C2 : déjà terminée ou relancée, l'étape 3b ne la reprend plus", (await q(withIds(fx("f24-rollback-resend-absent.sql"), [cutC2]))).length === 0);
check("Commandes manuelles jamais concernées (pas de finalized_at : ni la reprise ni les requêtes ne les prennent)",
  /o\.finalized_at is not null/.test(fx("f24-rollback-select.sql")) && /o\.finalized_at is not null/.test(fx("f24-rollback-requeue.sql")) && /o\.finalized_at is not null/.test(fx("f24-rollback-requeue-repair.sql")) && /o\.finalized_at is not null/.test(fx("f24-rollback-resend-absent.sql")));
check("Workshops : resynchronisés automatiquement après réactivation (aucune requête nécessaire)", (await q("select id from public.workshop_reservations where make_synced_updated_at is null or make_synced_updated_at < updated_at")).length > 0);

// ═══ 5. Rapport quotidien Supabase ═══════════════════════════════════════
const emails = () => fetches.filter((f) => f.url.includes("api.resend.com"));
r = await call("daily-health-report", {}, { jwt: null, query: "?s=faux" });
check("Rapport : mauvais secret → refusé", r.status === 403);
ENV.DAILY_REPORT_TEST_NOW = "2026-10-06T06:05:00Z"; // 08:05 à Zurich
let e0 = emails().length;
r = await call("daily-health-report", {}, { jwt: null, query: "?s=daily-secret" });
check("Rapport désactivé par défaut : rien d'envoyé (Make 7325098 reste le seul rapport)", r.body.data?.skipped === "disabled" && emails().length === e0);
await q("update public.app_settings set value='true'::jsonb, updated_by='test' where key='daily_report_enabled'");
ENV.DAILY_REPORT_TEST_NOW = "2026-10-06T05:30:00Z"; // 07:30
r = await call("daily-health-report", {}, { jwt: null, query: "?s=daily-secret" });
check("Avant 8 h : rien", r.body.data?.skipped === "outside_window" && emails().length === e0);
ENV.DAILY_REPORT_TEST_NOW = "2026-10-06T06:05:00Z";
r = await call("daily-health-report", {}, { jwt: null, query: "?s=daily-secret" });
const mail = emails().at(-1);
check("8 h 05 avec anomalies : UN e-mail à Mel, clé d'idempotence du jour", r.body.data?.sent === true && emails().length === e0 + 1
  && JSON.stringify(mail.body.to) === '["naglemelodie@gmail.com"]' && mail.headers["Idempotency-Key"] === "daily-health-report-2026-10-06", { r: r.body, mail });
check("Contenu : les alertes utiles (paiement sans référence…)", /Paiement sans référence PostFinance/.test(mail.body.html) && /anomalie/.test(mail.body.subject));
ENV.DAILY_REPORT_TEST_NOW = "2026-10-06T07:10:00Z"; // 09:10, même jour
r = await call("daily-health-report", {}, { jwt: null, query: "?s=daily-secret" });
check("Deuxième passage le même jour : aucun 2e e-mail", r.body.data?.skipped === "already_done" && emails().length === e0 + 1);
ENV.DAILY_REPORT_TEST_NOW = "2026-10-07T09:30:00Z"; // 11:30 le lendemain
r = await call("daily-health-report", {}, { jwt: null, query: "?s=daily-secret" });
check("Après 10 h : rien (pas de rapport tardif qui doublerait Make)", r.body.data?.skipped === "outside_window" && emails().length === e0 + 1);
await q("delete from public.pending_payments"); await q("update public.orders set postfinance_transaction_id='pf-ref' where order_number='ORD-NX-REF'");
await q("update public.orders set notion_sync_status='synced'");
await q("update public.orders set order_failure_reason=null");
ENV.DAILY_REPORT_TEST_NOW = "2026-10-08T06:00:00Z";
r = await call("daily-health-report", {}, { jwt: null, query: "?s=daily-secret" });
check("Aucune anomalie : pas d'e-mail, jour enregistré « no_anomaly »", r.body.data?.sent === false && emails().length === e0 + 1
  && (await one("select status from public.daily_report_runs where report_date='2026-10-08'")).status === "no_anomaly", r.body);
await q("update public.orders set postfinance_transaction_id=null where order_number='ORD-NX-REF'");
resendStatus = 500;
ENV.DAILY_REPORT_TEST_NOW = "2026-10-09T06:00:00Z";
r = await call("daily-health-report", {}, { jwt: null, query: "?s=daily-secret" });
resendStatus = 200;
const r2 = await call("daily-health-report", {}, { jwt: null, query: "?s=daily-secret" });
check("Échec d'envoi : noté « error », repris une seule fois au passage suivant", r.status === 502 && r2.body.data?.sent === true
  && (await one("select status from public.daily_report_runs where report_date='2026-10-09'")).status === "sent", [r.body, r2.body]);
e0 = emails().length;
r = await call("daily-health-report", { action: "preview" });
check("Aperçu (administratrice) : contenu renvoyé, rien d'envoyé ni d'enregistré", r.status === 200 && r.body.data.anomalyCount >= 1 && emails().length === e0);
check("Aperçu : refusé à un compte non admin", (await call("daily-health-report", { action: "preview" }, { jwt: "client-jwt" })).status === 401);

// ═══ 6. Sessions workshop ════════════════════════════════════════════════
const ws = (body, jwt) => call("manage-workshop-sessions", { pin: "1234", ...body }, { jwt });
r = await ws({ action: "list" });
const p14 = r.body.data.find((s) => s.id === "paint-2026-10-14");
check("Liste : sessions existantes avec places occupées et réservations", r.status === 200 && r.body.data.length === 4 && p14.occupied === 1 && p14.reservations === 1 && p14.remaining === 9, p14);
r = await ws({ action: "save", type: "signature", date: "2026-11-21", time: "13:00", price: "90", capacity: 8 });
check("Créer une session : identifiant lisible, ouverte", r.status === 200 && r.body.data.session.id === "sig-2026-11-21" && r.body.data.session.is_open === true, r.body);
check("Nouvelle session visible pour le site (get_workshop_availability)", (await q("select * from public.get_workshop_availability() where id='sig-2026-11-21'"))[0]?.remaining_seats === 8);
check("Doublon même type, date et heure : refusé", (await ws({ action: "save", type: "signature", date: "2026-11-21", time: "13:00", price: "90", capacity: 8 })).status === 409);
r = await ws({ action: "save", type: "signature", date: "2026-11-21", time: "16:00", price: "90", capacity: 8 });
check("Même jour, autre heure : autorisé (identifiant avec l'heure)", r.status === 200 && r.body.data.session.id === "sig-2026-11-21-1600");
const itemPriceBefore = (await one("select oi.workshop_unit_price, oi.total, wr.unit_price from public.order_items oi join public.workshop_reservations wr on wr.order_item_id = oi.id where wr.workshop_session_id='paint-2026-10-14'"));
check("Capacité 0 : refusée", (await ws({ action: "save", id: "paint-2026-10-14", type: "paint", date: "2026-10-14", time: "14:00", price: "65", capacity: 0 })).status === 409);
const big = await webOrder({ workshop: true });
await q("update public.workshop_reservations set purchased_seats = 4, status = 'confirmed', workshop_reference = 'WS-NX-BIG' where order_id = $1", [big]);
r = await ws({ action: "save", id: "paint-2026-10-14", type: "paint", date: "2026-10-14", time: "14:00", price: "65", capacity: 3 });
check("Capacité 3 alors que 5 places sont occupées : refusée, message clair", r.status === 409 && /5 place/.test(r.body.error), r.body);
r = await ws({ action: "save", id: "paint-2026-10-14", type: "signature", date: "2026-10-14", time: "14:00", price: "65", capacity: 10 });
check("Changer le type d'une session réservée : refusé", r.status === 409 && /type ne peut pas changer/.test(r.body.error));
r = await ws({ action: "save", id: "paint-2026-10-14", type: "paint", date: "2026-10-15", time: "14:00", price: "65", capacity: 10 });
check("Changer la date d'une session réservée : confirmation demandée, rien modifié", r.status === 409 && r.body.reason === "confirm"
  && (await one("select workshop_date::text d from public.workshop_sessions where id='paint-2026-10-14'")).d === "2026-10-14", r.body);
r = await ws({ action: "save", id: "paint-2026-10-14", type: "paint", date: "2026-10-15", time: "15:00", price: "70", capacity: 12, confirm: true });
check("Avec confirmation : date, heure, prix et capacité modifiés, identifiant et réservations conservés", r.status === 200 && r.body.data.session.id === "paint-2026-10-14"
  && (await one("select count(*)::int n from public.workshop_reservations where workshop_session_id='paint-2026-10-14'")).n === 2, r.body);
const itemPriceAfter = (await one("select oi.workshop_unit_price, oi.total, wr.unit_price from public.order_items oi join public.workshop_reservations wr on wr.order_item_id = oi.id where wr.workshop_session_id='paint-2026-10-14' and wr.workshop_reference like 'WS-NX-%' and wr.workshop_reference <> 'WS-NX-BIG'"));
check("Nouveau prix : les réservations existantes gardent leur prix", JSON.stringify(itemPriceBefore) === JSON.stringify(itemPriceAfter), [itemPriceBefore, itemPriceAfter]);
r = await ws({ action: "save", id: "sig-2026-11-21", type: "signature", date: "2026-11-21", time: "13:00", price: "90", capacity: 8, isOpen: false });
check("Fermer une session : plus réservable sur le site (is_open faux)", r.status === 200 && (await one("select is_open from public.workshop_sessions where id='sig-2026-11-21'")).is_open === false);
check("Aucune suppression possible (pas d'action)", (await ws({ action: "delete", id: "sig-2026-11-21" })).status === 400 && (await one("select count(*)::int n from public.workshop_sessions")).n === 6);
const h = (await ws({ action: "history", id: "paint-2026-10-14" })).body.data;
check("Historique : avant / après, auteur", h.length === 1 && h[0].actor === "naglemelodie@gmail.com" && h[0].before.workshop_date === "2026-10-14" && h[0].after.workshop_date === "2026-10-15");
check("Sans PIN : modification refusée", (await call("manage-workshop-sessions", { action: "save", type: "paint", date: "2026-12-01", time: "14:00", price: "65", capacity: 10 })).status === 403);
check("Compte non admin : refusé", (await ws({ action: "list" }, "client-jwt")).status === 401);
check("Valeurs invalides : refusées", (await ws({ action: "save", type: "paint", date: "2026-12-01", time: "25:00", price: "65", capacity: 10 })).status === 400
  && (await ws({ action: "save", type: "paint", date: "2026-12-01", time: "14:00", price: "0", capacity: 10 })).status === 400);

// ═══ 7. Droits et relance ════════════════════════════════════════════════
check("Tables F24 fermées à anon / authenticated", (await one(`select count(*)::int n from information_schema.role_table_grants where table_schema='public'
  and table_name in ('app_settings','app_settings_audit','daily_report_runs','workshop_session_audit') and grantee in ('anon','authenticated')`)).n === 0);
check("Changement de réglage historisé (qui, avant, après)", (await one("select count(*)::int n from public.app_settings_audit where key='notion_sync_enabled' and actor='test'")).n >= 4);
const snap = JSON.stringify(await q("select key, value from public.app_settings order by key"));
await db.exec(fs.readFileSync(F24, "utf8"));
check("Relance de F24 : réglages et sessions inchangés", JSON.stringify(await q("select key, value from public.app_settings order by key")) === snap
  && (await one("select count(*)::int n from public.workshop_sessions")).n === 6);
check("Aucun appel réseau réel (Make et Resend simulés)", fetches.every((f) => /make\.(com|test)|api\.resend\.com/.test(f.url)));

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
