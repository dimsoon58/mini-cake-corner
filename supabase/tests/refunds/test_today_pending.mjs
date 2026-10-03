// Admin > Aujourd'hui — commandes en attente de validation (« À décider »).
// Vraie fonction get-today sur le schéma de production (PGlite, F1–F14,
// lecture via une petite traduction supabase-js → SQL). Ne se connecte
// jamais à Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_today_pending.mjs
import { freshDb } from "./load.mjs";
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

process.on("unhandledRejection", (e) => { console.log("ERROR:", e?.stack ?? e); process.exit(2); });

const ROOT = path.resolve(import.meta.dirname, "../..");
const MIG = path.join(ROOT, "migrations");
let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 800) : ""); } };

const db = await freshDb({ migrations: fs.readdirSync(MIG).filter((f) => /^20261002(09|10|11|12|13|14|16|17|18|19)/.test(f)).sort().map((f) => path.join(MIG, f)) });
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

// ── supabase-js minimal → SQL (lecture seule) ────────────────────────────
const fmt = (v, type) => (v instanceof Date ? (type === 1082 ? v.toISOString().slice(0, 10) : v.toISOString()) : v);
let writes = 0;
function from(table) {
  let cols = "*", orderBy = "", lim = ""; const where = []; const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const b = {
    select(c) { cols = c.split(",").map((s) => s.trim()).filter(Boolean).join(", "); return b; },
    eq(c, v) { where.push(`${c}::text = ${p(String(v))}`); return b; },
    neq(c, v) { where.push(`${c}::text <> ${p(String(v))}`); return b; },
    gte(c, v) { where.push(`${c} >= ${p(v)}`); return b; },
    lte(c, v) { where.push(`${c} <= ${p(v)}`); return b; },
    in(c, v) { where.push(`${c}::text = any(${p(v.map(String))}::text[])`); return b; },
    not(c, op, v) { if (op === "in") where.push(`not (${c}::text = any(${p(String(v).replace(/[()]/g, "").split(","))}::text[]))`); else if (op === "is") where.push(`${c} is not ${v}`); return b; },
    is(c, v) { where.push(v === null ? `${c} is null` : `${c} is ${v}`); return b; },
    order(c, o = {}) { orderBy = ` order by ${c} ${o.ascending === false ? "desc" : "asc"}`; return b; },
    limit(n) { lim = ` limit ${Number(n)}`; return b; },
    insert() { writes++; return b; }, update() { writes++; return b; }, upsert() { writes++; return b; }, delete() { writes++; return b; },
    then(res, rej) {
      db.query(`select ${cols} from public.${table}${where.length ? ` where ${where.join(" and ")}` : ""}${orderBy}${lim}`, params)
        .then((r) => res({ data: r.rows.map((row) => Object.fromEntries(r.fields.map((f) => [f.name, fmt(row[f.name], f.dataTypeID)]))), error: null }))
        .catch((e) => res({ data: null, error: { message: e.message } }))
        .catch(rej);
    },
  };
  return b;
}
globalThis.__supa = {
  from,
  rpc: async () => { writes++; return { data: null, error: null }; },
  auth: { getUser: async (j) => ({ data: { user: j === "admin-jwt" ? { email: "naglemelodie@gmail.com" } : null }, error: null }) },
};
globalThis.fetch = async () => { throw new Error("réseau interdit dans ce test"); };
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x" })[k] } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "td-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), "export function createClient() { return globalThis.__supa; }");
await build({ entryPoints: [path.join(ROOT, "functions/get-today/index.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "fn.mjs"), logLevel: "error",
  plugins: [{ name: "m", setup(b) {
    b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
    b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
  } }] });
await import(path.join(tmp, "fn.mjs"));
const handler = globalThis.__handler;
const call = async (body = {}, jwt = "admin-jwt") => {
  const r = await handler(new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
};

// ── Données ─────────────────────────────────────────────────────────────
const D = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(Date.now() + 5 * 86400000));
let n = 0;
async function order({ num, pay = "pending", physical = "pending", validation = "pending", manual = false, draft = false, failure = null, type = "cake_only", createdAgo = "2 hours" }) {
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, order_validation, physical_validation,
      pickup_delivery_date, order_source, created_via, is_draft, order_failure_reason, fulfillment_type, created_at)
    values ('fr','Claire','Dupont',$1,'+41790000000',60,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() - $11::interval) returning id`,
    [`c${++n}@test.ch`, pay, validation, physical, D, manual ? "manual order" : "website", manual ? "admin" : null, draft, failure, type, createdAgo]);
  await q("update public.orders set order_number=$2 where id=$1", [o.id, num]);
  await q("insert into public.order_items (order_id, product, size, shape, flavors, total) values ($1, $2, 'bento', 'round', '{Vanilla}', 60)", [o.id, type === "workshop_only" ? "workshop" : "bento_cake"]);
  return o.id;
}
const authorized = await order({ num: "ORD-A-1", createdAgo: "3 days" });                 // capture différée : autorisée, en attente
const authorizedWs = await order({ num: "ORD-A-2", physical: "not_applicable", type: "workshop_only" }); // workshop seul en attente
const oldPaid = await order({ num: "ORD-A-3", pay: "paid" });                              // ancienne capture immédiate
const accepted = await order({ num: "ORD-B-1", pay: "paid", physical: "approved", validation: "approved" });
const refused = await order({ num: "ORD-B-2", physical: "rejected", validation: "rejected" });
const cancelled = await order({ num: "ORD-B-3", validation: "cancelled" });
const failed = await order({ num: "ORD-B-4", failure: "capacity", validation: "cancelled" });
const wsDone = await order({ num: "ORD-B-5", pay: "paid", physical: "not_applicable", validation: "approved", type: "workshop_only" });
const manual = await order({ num: "ORDM-B-6", manual: true, validation: "approved" });     // manuelle : pas de décision
const draft = await order({ num: "ORDM-B-7", manual: true, draft: true });
const refunded = await order({ num: "ORD-B-8", pay: "refunded" });

// ═══ Fonction ═══════════════════════════════════════════════════════════
check("Accès : sans connexion → 401", (await call({}, null)).status === 401);
const r = await call();
check("Aujourd'hui : réponse 200", r.status === 200, r.body);
const ids = (r.body.toDecide ?? []).map((o) => o.orderId);
check("Commande du site autorisée (paiement « pending », capture différée) : à décider", ids.includes(authorized));
check("Workshop seul en attente de décision : à décider", ids.includes(authorizedWs));
check("Ancienne commande payée encore en attente de décision : toujours listée", ids.includes(oldPaid));
check("Acceptée, refusée, annulée, en échec, workshop confirmé, manuelle, brouillon, remboursée : pas à décider",
  ![accepted, refused, cancelled, failed, wsDone, manual, draft, refunded].some((id) => ids.includes(id)), ids);
check("Exactement 3 commandes à décider", ids.length === 3, ids);
const a = r.body.toDecide.find((o) => o.orderId === authorized);
check("Chaque commande indique depuis quand elle attend (reçue il y a 3 jours)", !!a?.receivedAt && Math.round((Date.now() - Date.parse(a.receivedAt)) / 86400000) === 3, a);
check("Champs limités (n°, client, total, date, réception)", Object.keys(a).sort().join() === ["customerName", "date", "orderId", "orderNumber", "receivedAt", "total"].join());
check("Commande manuelle validée en attente de paiement : toujours « à encaisser »", (r.body.toCollect ?? []).some((o) => o.orderId === manual));
check("Lecture seule : aucune écriture", writes === 0);

// ═══ Page ═══════════════════════════════════════════════════════════════
const page = fs.readFileSync(path.resolve(ROOT, "../src/pages/AdminToday.tsx"), "utf8");
check("Page : bandeau « N commande(s) en attente de validation » avec la plus ancienne", page.includes('data-testid="pending-banner"') && page.includes("commandes en attente de validation") && page.includes("la plus ancienne"));
check("Page : « en attente depuis N jours » en rouge au-delà d'un jour", page.includes("en attente depuis") && page.includes("text-red-700"));

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
