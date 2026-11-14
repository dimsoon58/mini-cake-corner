// Modifier une commande manuelle dont un gâteau est déjà commencé en
// Production (14.11.2026). Avant : « Failed to replace products … violates
// foreign key constraint production_stock_movements_order_item_id_fkey ».
// Vraie fonction manage-manual-order sur le schéma de production (PGlite).
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild pdf-lib@1.17.1
//   node test_manual_edit_keeps_production.mjs
import { freshDb } from "./load.mjs";
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

process.on("unhandledRejection", (e) => { console.log("ERROR:", e?.stack ?? e); process.exit(2); });

const ROOT = path.resolve(import.meta.dirname, "../..");
const REPO = path.resolve(ROOT, "..");
const MIG = path.join(ROOT, "migrations");
let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 900) : ""); } };

const migrations = fs.readdirSync(MIG).filter((f) => /^202610(02(09|10|11|12|13|14|16|17|18|19)|03|04|05|06|13)/.test(f) || /_f3[46]_|_f4[1245]_|christmas_log_product/.test(f)).sort().map((f) => path.join(MIG, f));
const db = await freshDb({ migrations });
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

// ── supabase-js minimal → SQL ────────────────────────────────────────────
const fmt = (v, type) => (v instanceof Date ? (type === 1082 ? v.toISOString().slice(0, 10) : v.toISOString()) : v);
const val = (v) => (v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) ? JSON.stringify(v) : v);
function from(table) {
  let cols = "*", orderBy = "", lim = "", op = "select", values = null, single = null, returning = false; const where = []; const params = [];
  const p = (v) => { params.push(val(v)); return `$${params.length}`; };
  const b = {
    select(c) { if (op !== "select") returning = true; cols = (c ?? "*").split(",").map((s) => s.trim()).filter(Boolean).join(", "); return b; },
    update(v) { op = "update"; values = v; return b; },
    insert(v) { op = "insert"; values = v; return b; },
    delete() { op = "delete"; return b; },
    eq(c, v) { where.push(`${c}::text = ${p(String(v))}`); return b; },
    neq(c, v) { where.push(`${c}::text is distinct from ${p(String(v))}`); return b; },
    gte(c, v) { where.push(`${c} >= ${p(v)}`); return b; },
    lte(c, v) { where.push(`${c} <= ${p(v)}`); return b; },
    in(c, v) { where.push(`${c}::text = any(${p(v.map(String))}::text[])`); return b; },
    is(c, v) { where.push(v === null ? `${c} is null` : `${c} is ${v}`); return b; },
    not(c, o, v) { if (o === "is") where.push(`${c} is not ${v === null ? "null" : v}`); else if (o === "in") where.push(`not (${c}::text = any(${p(String(v).replace(/[()]/g, "").split(","))}::text[]))`); return b; },
    or(expr) { where.push(`(${expr.split(",").map((t) => { const [c, o, ...v] = t.split("."); return o === "is" ? `${c} is ${v.join(".")}` : `${c}::text = ${p(v.join("."))}`; }).join(" or ")})`); return b; },
    order(c, o = {}) { orderBy = ` order by ${c} ${o.ascending === false ? "desc" : "asc"}`; return b; },
    limit(n) { lim = ` limit ${Number(n)}`; return b; },
    maybeSingle() { single = "maybe"; return b; },
    single() { single = "one"; return b; },
    then(res, rej) {
      const w = where.length ? ` where ${where.join(" and ")}` : "";
      const ret = returning ? cols : "id";
      let sql;
      if (op === "update") sql = `update public.${table} set ${Object.entries(values).map(([k, v]) => `${k} = ${p(v)}`).join(", ")}${w} returning ${ret}`;
      else if (op === "delete") sql = `delete from public.${table}${w} returning id`;
      else if (op === "insert") {
        const rows = Array.isArray(values) ? values : [values];
        const ks = Object.keys(rows[0]);
        sql = `insert into public.${table} (${ks.join(", ")}) values ${rows.map((r) => `(${ks.map((k) => p(r[k])).join(", ")})`).join(", ")} returning ${ret}`;
      } else sql = `select ${cols} from public.${table}${w}${orderBy}${lim}`;
      db.query(sql, params)
        .then((r) => {
          const rows = r.rows.map((row) => Object.fromEntries(r.fields.map((f) => [f.name, fmt(row[f.name], f.dataTypeID)])));
          if (single) return res({ data: rows[0] ?? null, error: single === "one" && !rows[0] ? { message: "no rows", code: "PGRST116" } : null });
          res({ data: op !== "select" && !returning ? null : rows, error: null });
        })
        .catch((e) => res({ data: null, error: { message: e.message, code: e.code } }))
        .catch(rej);
    },
  };
  return b;
}
const SINGLE_ROW = ["cancel_workshop_seats_atomic"];
const rpc = async (fn, args = {}) => {
  const ks = Object.keys(args);
  try {
    const res = await db.query(`select * from public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(", ")})`, ks.map((k) => val(args[k])));
    const cols = res.fields.map((f) => f.name);
    if (cols.length === 1 && cols[0] === fn) return { data: res.rows[0]?.[fn] ?? null, error: null };
    const rows = res.rows.map((row) => Object.fromEntries(res.fields.map((f) => [f.name, fmt(row[f.name], f.dataTypeID)])));
    return { data: SINGLE_ROW.includes(fn) ? rows[0] ?? null : rows, error: null };
  } catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
};

// Stockage simulé (bucket « invoice »)
const stored = new Map();
const storage = { from: (bucket) => ({
  upload: async (p, bytes) => { stored.set(`${bucket}/${p}`, bytes); return { data: { path: p }, error: null }; },
  createSignedUrl: async (p) => ({ data: { signedUrl: `https://storage.test/${bucket}/${p}?sig` }, error: null }),
  createSignedUploadUrl: async (p) => ({ data: { token: "t", path: p }, error: null }),
  getPublicUrl: (p) => ({ data: { publicUrl: `https://storage.test/${bucket}/${p}` } }),
}) };

// JWT factices ; getUser simulé par jeton entier.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (email, sid) => `${b64({ alg: "HS256" })}.${b64({ email, session_id: sid })}.sig`;
const MEL = jwt("naglemelodie@gmail.com", "s1");
const USERS = { [MEL]: "naglemelodie@gmail.com" };

// ── Réseau simulé : Resend (avec Idempotency-Key), logo du site ───────────
const net = [];
const resendKeys = new Map();
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const headers = init.headers ?? {};
  const body = init.body && typeof init.body === "string" ? JSON.parse(init.body) : null;
  net.push({ url: u, headers, body });
  if (u.startsWith("https://api.resend.com/")) {
    const key = headers["Idempotency-Key"];
    if (key && resendKeys.has(key)) return new Response(JSON.stringify({ id: resendKeys.get(key) }), { status: 200 });
    const id = `em_${net.length}`;
    if (key) resendKeys.set(key, id);
    return new Response(JSON.stringify({ id }), { status: 200 });
  }
  if (/logo-red-email\.png$/.test(u)) return new Response("absent", { status: 404 });
  throw new Error(`réseau interdit dans ce test : ${u}`);
};
const delivered = () => {
  const seen = new Set(); const out = [];
  for (const c of net.filter((c) => c.url.startsWith("https://api.resend.com/"))) {
    const k = c.headers["Idempotency-Key"];
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    out.push(c);
  }
  return out;
};
const EMAIL = "test-interne@bentocakestudio.ch";
const mailsTo = () => delivered().filter((c) => c.body?.to?.includes(EMAIL));

const ENV = { SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x", ADMIN_ORDER_PIN: "4711", MAKE_CANCEL_SECRET: "make-secret-123", RESEND_API_KEY: "re_test" };
globalThis.Deno = { env: { get: (k) => ENV[k] } };
const pending = [];
globalThis.EdgeRuntime = { waitUntil: (p) => pending.push(p) };
const settle = async () => { while (pending.length) await pending.shift(); };

const fns = {};
globalThis.__supa = {
  from, rpc, storage,
  auth: { getUser: async (j) => ({ data: { user: USERS[j] ? { email: USERS[j] } : null }, error: null }) },
  functions: {
    invoke: async (name, { body } = {}) => {
      if (!fns[name]) return { data: null, error: { message: `fonction ${name} non simulée` } };
      const r = await fns[name](new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer service" }, body: JSON.stringify(body ?? {}) }));
      const data = await r.json();
      return r.ok ? { data, error: null } : { data: null, error: { message: data?.error ?? "error" } };
    },
  },
};


const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hi-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), "export function createClient() { return globalThis.__supa; }");
const NAMES = ["admin-pin", "manage-manual-order", "quote-manual-order", "send-manual-order-confirmation", "resend-order-confirmation", "get-production", "list-manual-orders"];
for (const name of NAMES) {
  await build({ entryPoints: [path.join(ROOT, `functions/${name}/index.ts`)], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, `${name}.mjs`), logLevel: "error",
    nodePaths: [path.resolve(ROOT, "../node_modules")],
    plugins: [{ name: "m", setup(b) {
      b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
      b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
      b.onResolve({ filter: /^npm:pdf-lib/ }, () => ({ path: path.resolve(ROOT, "../node_modules/pdf-lib/cjs/index.js") }));
    } }] });
  await import(path.join(tmp, `${name}.mjs`));
  fns[name] = globalThis.__handler;
}
const call = async (name, body, { token = MEL } = {}) => {
  const r = await fns[name](new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }));
  const out = { status: r.status, body: await r.json() };
  await settle();
  return out;
};
const T = (await call("admin-pin", { action: "unlock", pin: "4711" })).body.data.token;
const S = { _adminSession: T, pin: "__session__" };

const zToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
const shift = (n) => { const d = new Date(`${zToday}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const PAST = shift(-11), PAST2 = shift(-9), PAID_ON = shift(-8), FUTURE = shift(20);

const customer = { first_name: "TEST", last_name: "Historique", phone: "+41790000000", email: EMAIL, lang: "fr", channel: "in_person" };
const cakeItem = (flavor) => ({ product: "bento_cake", size: "bento", shape: "round", flavors: [flavor], design: "normal-without-border", extras: [], candles: [] });
const wsItem = (sid, n) => ({ product: "workshop", workshop_session_id: sid, workshop_participants: n, workshop_sponge_choices: Array(n).fill("vanilla") });
const pickup = (date, idx) => ({ date, deliveryMethod: "pickup", slot: "10:00 – 11:00", itemIndexes: idx });

const FUT = shift(10);
const items = async (id) => q(`select id, flavors, production_status, fulfillment_id, created_at from public.order_items where order_id=$1 order by created_at, id`, [id]);
// Historique Production comme update-production-status la crée (« Fait », stock pris).
const markDone = async (itemId, orderId) => {
  await q(`update public.order_items set production_status='completed' where id=$1`, [itemId]);
  const prep = await one(`insert into public.production_preparations (order_item_id, order_id, mode, needs) values ($1,$2,'stock','[]') returning id`, [itemId, orderId]);
  await q(`insert into public.production_stock_movements (sponge_base, product_category, delta, quantity_after, kind, preparation_id, order_item_id) values ('vanilla','bento',-1,0,'order_use',$1,$2)`, [prep.id, itemId]);
};

// ═══ 1. Commande à 2 gâteaux, le 1er « Fait » ═══════════════════════════
const body1 = { customer, items: [cakeItem("vanilla"), cakeItem("chocolate")], fulfillments: [pickup(FUT, [0, 1])] };
let r = await call("manage-manual-order", { action: "save", mode: "confirm", ...body1, ...S });
const O1 = r.body.orderId;
check("Commande créée", r.status === 200 && O1, r.body);
let all0 = await items(O1);
const a = all0.find((x) => x.flavors[0] === "Vanilla"), b = all0.find((x) => x.flavors[0] === "Chocolate");
await markDone(a.id, O1);

// Ré-enregistrer sans rien changer (cas de Mel) → OK, mêmes lignes, « Fait » gardé
r = await call("manage-manual-order", { action: "save", mode: "confirm", orderId: O1, ...body1, ...S });
let now = await items(O1);
check("Ré-enregistrement d'une commande avec un gâteau « Fait » : accepté", r.status === 200 && r.body.success, r.body);
check("Mêmes gâteaux (mêmes id), aucun recréé", now.length === 2 && now.map((x) => x.id).sort().join() === [a.id, b.id].sort().join(), now);
check("Le « Fait » du gâteau 1 est gardé", now.find((x) => x.id === a.id)?.production_status === "completed", now);
check("Historique stock toujours relié au gâteau", Number((await one(`select count(*)::int n from public.production_stock_movements where order_item_id=$1`, [a.id])).n) === 1);
check("Les gâteaux sont reliés à la nouvelle date", now.every((x) => x.fulfillment_id), now);

// Changer la date + le goût du gâteau 2 (pas commencé) → modifié sur place
const FUT2 = shift(12);
const body2 = { customer, items: [cakeItem("vanilla"), cakeItem("red-velvet")], fulfillments: [pickup(FUT2, [0, 1])] };
r = await call("manage-manual-order", { action: "save", mode: "confirm", orderId: O1, ...body2, ...S });
now = await items(O1);
const f2 = await one(`select pickup_delivery_date::text d from public.order_fulfillments where order_id=$1`, [O1]);
check("Nouvelle date + goût du gâteau 2 changé : accepté", r.status === 200 && r.body.success && f2.d === FUT2, { r: r.body, f2 });
check("Gâteau 2 modifié sur place (même id, nouveau goût)", now.find((x) => x.id === b.id) && JSON.stringify(now.find((x) => x.id === b.id).flavors) !== JSON.stringify(b.flavors), { before: b.flavors, now });
check("Gâteau 1 « Fait » inchangé", now.find((x) => x.id === a.id)?.production_status === "completed", now);

// Ajouter un 3e gâteau → inséré, les 2 autres gardés
const body3 = { ...body2, items: [...body2.items, cakeItem("chocolate")], fulfillments: [pickup(FUT2, [0, 1, 2])] };
r = await call("manage-manual-order", { action: "save", mode: "confirm", orderId: O1, ...body3, ...S });
now = await items(O1);
check("Ajout d'un gâteau : 3 lignes, les 2 anciennes gardées", r.status === 200 && now.length === 3 && [a.id, b.id].every((id) => now.some((x) => x.id === id)), now);

// Retirer le gâteau 3 (pas commencé) → supprimé
r = await call("manage-manual-order", { action: "save", mode: "confirm", orderId: O1, ...body2, ...S });
now = await items(O1);
check("Retrait d'un gâteau pas commencé : supprimé", r.status === 200 && now.length === 2 && [a.id, b.id].every((id) => now.some((x) => x.id === id)), now);

// Retirer le gâteau « Fait » → refus clair, commande inchangée
const before = JSON.stringify(await items(O1));
const fBefore = await one(`select pickup_delivery_date::text d from public.order_fulfillments where order_id=$1`, [O1]);
r = await call("manage-manual-order", { action: "save", mode: "confirm", orderId: O1, customer, items: [cakeItem("red-velvet")], fulfillments: [pickup(FUT, [0])], ...S });
check("Retrait d'un gâteau « Fait » : refusé avec un message clair", r.status === 500 && /already has a Production history/.test(r.body.error ?? ""), r.body);
const fAfter = await one(`select pickup_delivery_date::text d from public.order_fulfillments where order_id=$1`, [O1]);
check("… et la commande est remise exactement comme avant (gâteaux + date)", JSON.stringify(await items(O1)) === before && fAfter?.d === fBefore.d, { now: await items(O1), fAfter });

// Changer le goût du gâteau « Fait » → ce n'est plus le même gâteau : refus (jamais un « Fait » réutilisé pour un autre gâteau)
r = await call("manage-manual-order", { action: "save", mode: "confirm", orderId: O1, customer, items: [cakeItem("chocolate"), cakeItem("red-velvet")], fulfillments: [pickup(FUT2, [0, 1])], ...S });
check("Goût changé sur un gâteau « Fait » : refusé, commande inchangée", r.status === 500 && /already has a Production history/.test(r.body.error ?? "") && JSON.stringify(await items(O1)) === before, r.body);

// ═══ 2. Ordre stable au chargement (lignes créées ensemble) ══════════════
r = await call("manage-manual-order", { action: "get", orderId: O1, ...S });
const ids = (await items(O1)).map((x) => x.id);
check("Chargement : produits dans un ordre stable (date de création puis id)", r.status === 200 && r.body.items.length === 2, r.body);

// ═══ 3. Historique (cas de la capture) : passer en « Commande historique » ═
const body4 = { customer, items: [cakeItem("vanilla")], fulfillments: [pickup(FUT, [0])] };
r = await call("manage-manual-order", { action: "save", mode: "confirm", ...body4, ...S });
const O4 = r.body.orderId;
const [c] = await items(O4);
await markDone(c.id, O4);
r = await call("manage-manual-order", { action: "save", mode: "confirm", orderId: O4, historical: true, customer, items: [cakeItem("vanilla")], fulfillments: [pickup(shift(-3), [0])], ...S });
now = await items(O4);
check("Passer une commande avec gâteau « Fait » en historique (date passée) : accepté", r.status === 200 && r.body.success, r.body);
check("… même gâteau, marqué remis", now.length === 1 && now[0].id === c.id && now[0].production_status === "picked_up", now);

// ═══ 4. Message traduit côté admin ═══════════════════════════════════════
const mo = fs.readFileSync(path.join(REPO, "src/lib/manualOrders.ts"), "utf8");
check("Message en français dans l'admin", /removed product already has a Production history/.test(mo) && /Annuler ce gâteau/.test(mo));

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
