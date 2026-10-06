// Gâteaux des workshops dans la production et le stock (F28, 06.10.2026) —
// parcours complet : réservation → Production (par session) → lots préparés
// et stock → nouvelle réservation → annulation de places (génoise notée) →
// gâteaux en trop (réutilisable / perdu) → annulation d'un lot. VRAIES
// fonctions get-production, workshop-production, cancel-workshop-seats,
// manage-workshop-sessions, manage-manual-order… sur le schéma de production
// (PGlite, F1–F28). Resend simulé : aucun e-mail réel, aucun réseau.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild pdf-lib@1.17.1
//   node test_workshop_production.mjs
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

const migrations = fs.readdirSync(MIG).filter((f) => /^202610(02(09|10|11|12|13|14|16|17|18|19)|03|04|05|06)/.test(f)).sort().map((f) => path.join(MIG, f));
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
const NAHYA = jwt("nahya.test@example.com", "s9");
const NAHYA_ID = "11111111-2222-3333-4444-555555555555";
const USERS = { [MEL]: { email: "naglemelodie@gmail.com", id: "aaaaaaaa-0000-0000-0000-000000000001" }, [NAHYA]: { email: "nahya.test@example.com", id: NAHYA_ID } };

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

const ENV = { SITE_BASE_URL: "https://site.test", SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x", ADMIN_ORDER_PIN: "4711", MAKE_CANCEL_SECRET: "make-secret-123", RESEND_API_KEY: "re_test" };
globalThis.Deno = { env: { get: (k) => ENV[k] } };
const pending = [];
globalThis.EdgeRuntime = { waitUntil: (p) => pending.push(p) };
const settle = async () => { while (pending.length) await pending.shift(); };

const fns = {};
globalThis.__supa = {
  from, rpc, storage,
  auth: { getUser: async (j) => ({ data: { user: USERS[j] ?? null }, error: null }),
    admin: { inviteUserByEmail: async () => ({ data: { user: { id: "x" } }, error: null }) } },
  functions: {
    invoke: async (name, { body } = {}) => {
      if (!fns[name]) return { data: null, error: { message: `fonction ${name} non simulée` } };
      const r = await fns[name](new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer service" }, body: JSON.stringify(body ?? {}) }));
      const data = await r.json();
      return r.ok ? { data, error: null } : { data: null, error: { message: data?.error ?? "error" } };
    },
  },
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m7-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), "export function createClient() { return globalThis.__supa; }");
const NAMES = ["admin-pin", "manage-manual-order", "send-manual-order-confirmation", "cancel-workshop-seats", "send-workshop-cancellation-email",
  "get-production", "workshop-production", "manage-workshop-sessions", "update-production-stock", "staff-access"];
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


await q("insert into auth.users (id, email) values ($1,'nahya.test@example.com'), ('aaaaaaaa-0000-0000-0000-000000000001','naglemelodie@gmail.com')", [NAHYA_ID]);
const nahyaMember = (await one("select id from public.team_members where slug='nahya'")).id;
await call("staff-access", { action: "invite", memberId: nahyaMember, email: "nahya.test@example.com", ...S });
check("Préparation : Nahya a son accès employée (production.update)", (await one("select permissions from public.staff_access where member_id=$1", [nahyaMember]))?.permissions.includes("production.update"));

// ── Données ──────────────────────────────────────────────────────────────
const DAY = "2026-12-30";
await q(`insert into public.workshop_sessions (id, workshop_type, workshop_date, workshop_time, unit_price, max_capacity, is_open) values ('ws-p','paint',$1,'18:00',65,10,true)`, [DAY]);
const customer = { first_name: "TEST", last_name: "Atelier", phone: "+41790000000", email: "test-interne@bentocakestudio.ch", lang: "fr", channel: "phone" };
const wsItem = (n, sponges) => ({ product: "workshop", workshop_session_id: "ws-p", workshop_participants: n, workshop_sponge_choices: sponges });
const book = async (sponges) => {
  const r = await call("manage-manual-order", { action: "save", mode: "confirm", customer, items: [wsItem(sponges.length, sponges)], fulfillments: [] });
  const p = await call("manage-manual-order", { action: "mark_paid", orderId: r.body.orderId, paymentMethod: "cash", sendConfirmation: false, ...S });
  if (p.status !== 200) throw new Error("booking failed " + JSON.stringify(p.body));
  return { orderId: r.body.orderId, resId: (await one("select id from public.workshop_reservations where order_id=$1", [r.body.orderId])).id };
};
const prod = async (who = MEL) => (await call("get-production", { from: DAY, to: DAY, ...(who === MEL ? S : {}) }, { token: who })).body;
const session = (p) => p.workshopSessions.find((s) => s.sessionId === "ws-p");
const base = (p, b) => session(p)?.bases.find((x) => x.base === b) ?? { needed: 0, prepared: 0, done: 0, remaining: 0, surplus: 0 };
const row = (p, b) => p.sections.find((s) => s.base === b)?.rows.find((r) => r.category === "bento_round") ?? { ordered: 0, done: 0, needed: 0, stock: 0, toMake: 0 };
const stock = async (b) => Number((await one("select quantity from public.production_stock where sponge_base=$1 and product_category='bento_round'", [b]))?.quantity ?? 0);
const wp = (body, who = MEL) => call("workshop-production", { ...body, ...(who === MEL ? S : {}) }, { token: who });

// ═══ 1. Réservation → Production par session ═════════════════════════════
const A = await book(["vanilla", "vanilla", "vanilla", "vanilla", "chocolate", "chocolate"]);
let p = await prod();
let s = session(p);
check("Session listée : Peinture, 30.12, 18:00, 6 places, 1 Bento rond par participant",
  !!s && s.type === "paint" && s.date === DAY && s.time === "18:00" && s.seats === 6 && s.cakesPerParticipant === 1 && s.category === "bento_round", s);
check("Par génoise : 4 vanille, 2 chocolat à préparer", base(p, "vanilla").needed === 4 && base(p, "chocolate").needed === 2 && base(p, "vanilla").remaining === 4);
check("Planning de production : Bento rond vanille 4, chocolat 2 (une ligne par session et génoise, pas par commande)",
  row(p, "vanilla").ordered === 4 && row(p, "chocolate").ordered === 2
  && row(p, "vanilla").lines.every((l) => l.sessionId === "ws-p" && l.source === "workshop") && row(p, "vanilla").lines.length === 1, row(p, "vanilla"));
check("Caractéristiques de production : génoise, catégorie, date et heure sur la ligne",
  (({ flavourId, shape, date, slot, customerName }) => flavourId === "vanilla" && shape === "round" && date === DAY && slot === "18:00" && customerName === "Workshop Peinture")(row(p, "vanilla").lines[0]));
let pn = await prod(NAHYA);
check("Nahya voit la session et les quantités (aucun montant)", session(pn)?.bases.find((b) => b.base === "vanilla")?.needed === 4);

// ═══ 2. Réglage « gâteaux par participant » ══════════════════════════════
let r = await call("manage-workshop-sessions", { action: "save_production_setting", type: "paint", cakesPerParticipant: 2, category: "bento_round", ...S });
p = await prod();
check("Réglage Peinture = 2 gâteaux par participant : 8 vanille, 4 chocolat", r.status === 200 && base(p, "vanilla").needed === 8 && base(p, "chocolate").needed === 4, r.body);
await call("manage-workshop-sessions", { action: "save_production_setting", type: "paint", cakesPerParticipant: 1, category: "bento_round", ...S });
check("Réglage historisé (qui, avant, après)", (await one("select count(*)::int n from public.workshop_session_audit where session_id='production:paint'")).n === 2);

// ═══ 3. Préparation partielle et stock ═══════════════════════════════════
await call("update-production-stock", { sponge_base: "vanilla", product_category: "bento_round", quantity: 3, ...S });
r = await wp({ action: "prepare", sessionId: "ws-p", base: "vanilla", units: 2, mode: "stock" });
p = await prod();
check("Lot 1 : 2 vanille « Pris dans le stock » → stock 3 → 1, reste 2 à préparer",
  r.status === 200 && r.body.data.taken_units === 2 && (await stock("vanilla")) === 1 && base(p, "vanilla").remaining === 2 && row(p, "vanilla").done === 2, r.body);
r = await wp({ action: "prepare", sessionId: "ws-p", base: "vanilla", units: 3, mode: "stock" });
check("Lot de 3 alors qu'il en reste 2 : refusé, rien retiré", r.status === 409 && /Au plus 2/.test(r.body.error) && (await stock("vanilla")) === 1, r.body);
r = await wp({ action: "prepare", sessionId: "ws-p", base: "vanilla", units: 2, mode: "stock" }, NAHYA);
check("Lot 2 (Nahya) : 2 vanille « stock » avec 1 seul en stock → 1 retiré + 1 préparé frais, stock 0, jamais négatif",
  r.status === 200 && r.body.data.taken_units === 1 && r.body.data.fresh_units === 1 && (await stock("vanilla")) === 0, r.body);
r = await wp({ action: "prepare", sessionId: "ws-p", base: "chocolate", units: 2, mode: "fresh" });
p = await prod();
check("Chocolat 2 « Préparé frais » : aucun stock retiré, session terminée (0 à préparer)",
  r.status === 200 && r.body.data.taken_units === 0 && (await stock("chocolate")) === 0 && base(p, "chocolate").remaining === 0 && base(p, "vanilla").remaining === 0
  && row(p, "vanilla").needed === 0 && row(p, "chocolate").needed === 0, { r: r.body, s: session(p) });
const moves = await q("select delta, kind, workshop_session_id from public.production_stock_movements where workshop_session_id='ws-p' order by created_at");
check("Journal du stock : 2 retraits « order_use » liés à la session (−2, −1)", moves.length === 2 && moves[0].delta === -2 && moves[1].delta === -1 && moves.every((m) => m.kind === "order_use"), moves);

// ═══ 4. Nouvelle réservation après préparation : seulement la différence ══
const B = await book(["chocolate"]);
p = await prod();
check("Nouvelle place chocolat : besoin 3, déjà préparé 2 → 1 seul à préparer (pas de double comptage)",
  base(p, "chocolate").needed === 3 && base(p, "chocolate").prepared === 2 && base(p, "chocolate").remaining === 1 && row(p, "chocolate").needed === 1 && session(p).seats === 7);

// ═══ 5. Annulation de places (génoise notée) ═════════════════════════════
const mails0 = (await q("select 1 from public.workshop_cancellation_log")).length;
r = await call("cancel-workshop-seats", { reservation_id: A.resId, seats_to_cancel: 2, idempotency_key: "t-a-1", ...S });
check("Réservation mixte sans génoise : refus clair AVANT toute annulation", r.status === 400 && r.body.reason === "sponges_required"
  && (await one("select cancelled_seats from public.workshop_reservations where id=$1", [A.resId])).cancelled_seats === 0
  && (await q("select 1 from public.workshop_cancellation_log")).length === mails0, r.body);
r = await call("cancel-workshop-seats", { reservation_id: A.resId, seats_to_cancel: 2, idempotency_key: "t-a-1", sponges: { vanilla: 3, chocolate: 0 }, ...S });
check("Génoises incohérentes (3 pour 2 places) : refusé, rien annulé", r.status === 400 && r.body.reason === "sponges_invalid");
r = await call("cancel-workshop-seats", { reservation_id: A.resId, seats_to_cancel: 2, idempotency_key: "t-a-1", sponges: { vanilla: 1, chocolate: 1 }, ...S });
p = await prod();
check("2 places annulées (1 vanille, 1 chocolat) : génoises notées", r.status === 200
  && JSON.stringify(await one("select vanilla, chocolate from public.workshop_sponge_cancellations where reservation_id=$1", [A.resId])) === JSON.stringify({ vanilla: 1, chocolate: 1 }), r.body);
check("Vanille : besoin 3, préparé 4 → 1 gâteau en trop à décider, rien à préparer", base(p, "vanilla").needed === 3 && base(p, "vanilla").surplus === 1 && base(p, "vanilla").remaining === 0 && row(p, "vanilla").needed === 0);
check("Chocolat : besoin 2 (1 + 1 nouvelle), préparé 2 → plus rien à préparer", base(p, "chocolate").needed === 2 && base(p, "chocolate").remaining === 0 && base(p, "chocolate").surplus === 0);
check("Aucune place « à confirmer » (génoises connues)", !p.toConfirm.some((l) => l.sessionId === "ws-p"));
r = await call("cancel-workshop-seats", { reservation_id: A.resId, seats_to_cancel: 2, idempotency_key: "t-a-1", sponges: { vanilla: 1, chocolate: 1 }, ...S });
check("Même annulation rejouée : génoises pas comptées deux fois", (await q("select 1 from public.workshop_sponge_cancellations where reservation_id=$1", [A.resId])).length === 1 && base(await prod(), "vanilla").needed === 3);

// ═══ 6. Gâteau en trop : réutilisable / perdu ════════════════════════════
r = await wp({ action: "surplus", sessionId: "ws-p", base: "vanilla", units: 1, reusable: true }, NAHYA);
check("Nahya ne décide pas du surplus (réservé aux administratrices)", r.status === 403);
r = await wp({ action: "surplus", sessionId: "ws-p", base: "vanilla", units: 2, reusable: true });
check("Surplus de 2 alors qu'il y en a 1 : refusé", r.status === 409 && /Au plus 1/.test(r.body.error), r.body);
r = await wp({ action: "surplus", sessionId: "ws-p", base: "vanilla", units: 1, reusable: true });
p = await prod();
check("1 vanille « réutilisable » : remis en stock (0 → 1), plus de surplus, toujours 0 à préparer",
  r.status === 200 && (await stock("vanilla")) === 1 && base(p, "vanilla").surplus === 0 && base(p, "vanilla").remaining === 0 && base(p, "vanilla").prepared === 3, session(p));

// ═══ 7. Annuler un lot ═══════════════════════════════════════════════════
const choco = (await q("select id from public.workshop_preparations where session_id='ws-p' and sponge_base='chocolate' and undone_at is null"))[0];
r = await wp({ action: "unprepare", preparationId: choco.id, returnUnits: 1 });
check("Lot « préparé frais » : rien à remettre en stock (refusé)", r.status === 409, r.body);
r = await wp({ action: "unprepare", preparationId: choco.id, returnUnits: 0 }, NAHYA);
p = await prod();
check("Lot chocolat annulé : 2 à nouveau à préparer, stock inchangé", r.status === 200 && base(p, "chocolate").remaining === 2 && (await stock("chocolate")) === 0);
r = await wp({ action: "unprepare", preparationId: choco.id, returnUnits: 0 });
check("Annuler deux fois le même lot : refusé", r.status === 409);

// ═══ 8. Dernière place d'une réservation (une seule génoise : déduite) ════
r = await call("cancel-workshop-seats", { reservation_id: B.resId, seats_to_cancel: 1, idempotency_key: "t-b-1", ...S });
p = await prod();
check("Place chocolat de B annulée sans rien préciser (génoise unique, déduite) : chocolat 1 à préparer",
  r.status === 200 && base(p, "chocolate").needed === 1 && base(p, "chocolate").remaining === 1, { r: r.body, s: session(p) });

// ═══ 9. Sans génoise notée (ancienne annulation) : jamais deviné ═════════
const C = await book(["vanilla", "chocolate"]);
await q("update public.workshop_reservations set cancelled_seats = 1, status='partially_cancelled' where id=$1", [C.resId]);
p = await prod();
check("Place annulée sans génoise notée dans une réservation mixte : 1 « à confirmer », jamais devinée",
  p.toConfirm.some((l) => l.sessionId === "ws-p" && l.units === 1 && l.reason === "workshop_sponge_after_cancellation"), p.toConfirm);

// ═══ 10. Sécurité et cohérence ═══════════════════════════════════════════
check("Stock jamais négatif", (await q("select 1 from public.production_stock where quantity < 0")).length === 0);
check("Tables F28 fermées à anon / authenticated", (await one(`select has_table_privilege('anon','public.workshop_preparations','select') a,
  has_function_privilege('authenticated','public.workshop_mark_prepared(text,text,text,integer,integer,text,text)','execute') b`)).a === false);
r = await call("workshop-production", { action: "prepare", sessionId: "ws-p", base: "vanilla", units: 1 }, { token: null });
check("Sans connexion : refusé (401)", r.status === 401);
const F28 = migrations.find((f) => f.includes("_f28_"));
const before = JSON.stringify(await q("select * from public.workshop_preparations order by id"));
await db.exec(fs.readFileSync(F28, "utf8"));
check("Relance de F28 : rien de modifié, réglages gardés", JSON.stringify(await q("select * from public.workshop_preparations order by id")) === before
  && (await one("select cakes_per_participant from public.workshop_production_settings where workshop_type='paint'")).cakes_per_participant === 1);

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
