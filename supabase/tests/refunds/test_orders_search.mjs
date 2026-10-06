// Liste des commandes — recherche par référence de paiement PostFinance
// (06.10.2026). VRAIE fonction list-orders sur le schéma de production
// (PGlite). Administratrices : n° de commande, référence PAY-… et n° de
// transaction ; employée : n° de commande seulement (aucune donnée de
// paiement). Ne se connecte jamais à Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_orders_search.mjs
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
const F23 = migrations.find((f) => f.includes("_f23_"));
const db = await freshDb({ migrations });
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

// ── supabase-js minimal → SQL ────────────────────────────────────────────
const fmt = (v, type) => (v instanceof Date ? (type === 1082 ? v.toISOString().slice(0, 10) : v.toISOString()) : v);
function from(table) {
  let cols = "*", orderBy = "", lim = "", op = "select", values = null, single = null, returning = false, conflict = null; const where = []; const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const b = {
    select(c) { if (op !== "select") returning = true; cols = (c ?? "*").split(",").map((s) => s.trim()).filter(Boolean).join(", "); return b; },
    update(v) { op = "update"; values = v; return b; },
    insert(v) { op = "insert"; values = v; return b; },
    upsert(v, o = {}) { op = "upsert"; values = v; conflict = o.onConflict; return b; },
    eq(c, v) { where.push(`${c}::text = ${p(String(v))}`); return b; },
    neq(c, v) { where.push(`${c}::text is distinct from ${p(String(v))}`); return b; },
    gte(c, v) { where.push(`${c} >= ${p(v)}`); return b; },
    lte(c, v) { where.push(`${c} <= ${p(v)}`); return b; },
    in(c, v) { where.push(`${c}::text = any(${p(v.map(String))}::text[])`); return b; },
    is(c, v) { where.push(v === null ? `${c} is null` : `${c} is ${v}`); return b; },
    ilike(c, v) { where.push(`${c} ilike ${p(v)}`); return b; },
    // « col.ilike.%x%,col2.ilike.%x% » (forme utilisée par list-orders)
    or(expr) { where.push(`(${expr.split(",").map((t) => { const [c, o, ...v] = t.split("."); if (o !== "ilike") throw new Error("or: " + t); return `${c}::text ilike ${p(v.join("."))}`; }).join(" or ")})`); return b; },
    order(c, o = {}) { orderBy += `${orderBy ? "," : " order by"} ${c} ${o.ascending === false ? "desc" : "asc"}`; return b; },
    limit(n) { lim = ` limit ${Number(n)}`; return b; },
    range(a, z) { lim = ` limit ${Number(z) - Number(a) + 1} offset ${Number(a)}`; return b; },
    maybeSingle() { single = "maybe"; return b; },
    single() { single = "one"; return b; },
    then(res, rej) {
      const w = where.length ? ` where ${where.join(" and ")}` : "";
      let sql;
      if (op === "update") sql = `update public.${table} set ${Object.entries(values).map(([k, v]) => `${k} = ${p(v)}`).join(", ")}${w} returning ${returning ? cols : "id"}`;
      else if (op === "insert") { const ks = Object.keys(values); sql = `insert into public.${table} (${ks.join(", ")}) values (${ks.map((k) => p(values[k])).join(", ")}) returning ${returning ? cols : "id"}`; }
      else if (op === "upsert") {
        const ks = Object.keys(values);
        sql = `insert into public.${table} (${ks.join(", ")}) values (${ks.map((k) => p(values[k])).join(", ")}) on conflict (${conflict}) do update set ${ks.map((k) => `${k} = excluded.${k}`).join(", ")} returning ${returning ? cols : "*"}`;
      } else sql = `select ${cols} from public.${table}${w}${orderBy}${lim}`;
      db.query(sql, params)
        .then((r) => {
          const rows = r.rows.map((row) => Object.fromEntries(r.fields.map((f) => [f.name, fmt(row[f.name], f.dataTypeID)])));
          if (single) return res({ data: rows[0] ?? null, error: single === "one" && !rows[0] ? { message: "no rows" } : null });
          res({ data: op === "update" && !returning ? null : rows, error: null });
        })
        .catch((e) => res({ data: null, error: { message: e.message, code: e.code } }))
        .catch(rej);
    },
  };
  return b;
}
const rpc = async (fn, args = {}) => {
  const ks = Object.keys(args);
  try {
    const res = await db.query(`select * from public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(", ")})`,
      ks.map((k) => (k === "p_items" || k === "p_permissions" ? args[k] : args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k])));
    const cols = res.fields.map((f) => f.name);
    return { data: cols.length === 1 && cols[0] === fn ? (res.rows[0]?.[fn] ?? null) : res.rows, error: null };
  } catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
};

// ── Comptes simulés (aucun e-mail) ───────────────────────────────────────
const users = {};
async function addUser(key, email) {
  const id = (await one("select gen_random_uuid() id")).id;
  await q("insert into auth.users (id, email) values ($1,$2)", [id, email]);
  users[key] = { id, email };
  return users[key];
}
await addUser("mel", "naglemelodie@gmail.com");
await addUser("eli", "e.potapushina@gmail.com");
await addUser("nahya", "nahya.test@example.com");
await addUser("client", "client.test@example.com");
const invites = [];
const authAdmin = { inviteUserByEmail: async (email, opts) => { invites.push({ email, opts }); return { data: { user: { id: "x" } }, error: null }; } };
globalThis.__supa = {
  from, rpc,
  auth: { getUser: async (jwt) => ({ data: { user: Object.values(users).find((u) => `jwt-${u.email}` === jwt) ?? null }, error: null }), admin: authAdmin },
  storage: { from: () => ({ createSignedUrl: async (p) => ({ data: { signedUrl: `https://signed.test/${p}` }, error: null }) }) },
};
globalThis.fetch = async () => { throw new Error("réseau interdit dans ce test"); };
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x", ADMIN_ORDER_PIN: "1234", SITE_BASE_URL: "https://site.test", TEAM_PLANNING_TEST_TODAY: "2026-10-12" })[k] } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "staff-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), "export function createClient() { return globalThis.__supa; }");
fs.writeFileSync(path.join(tmp, "pdf.mjs"), "export const PDFDocument = { create: async () => { throw new Error('pdf'); } }; export const StandardFonts = {}; export const rgb = () => null;");
const fns = {};
for (const name of ["list-orders", "staff-access"]) {
  try {
    await build({ entryPoints: [path.join(ROOT, `functions/${name}/index.ts`)], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, `${name}.mjs`), logLevel: "silent",
      plugins: [{ name: "m", setup(b) {
        b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
        b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
        b.onResolve({ filter: /^npm:pdf-lib/ }, () => ({ path: path.join(tmp, "pdf.mjs") }));
      } }] });
    await import(path.join(tmp, `${name}.mjs`));
    fns[name] = globalThis.__handler;
  } catch (e) { console.log(`(bundle ${name} impossible : ${String(e.message).slice(0, 120)})`); }
}
const call = async (name, body, who) => {
  const jwt = who ? `jwt-${users[who].email}` : null;
  const r = await fns[name](new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) }));
  let j = null; try { j = await r.json(); } catch { /* vide */ }
  return { status: r.status, body: j };
};


const mk = async (num, ref, tx) => {
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, order_validation, physical_validation, order_source, fulfillment_type, payment_reference, postfinance_transaction_id)
    values ('fr','Claire','Dupont','c@example.com','+41',50,'paid','approved','approved','website','cake_only',$1,$2) returning id`, [ref, tx]);
  await q("update public.orders set order_number=$2 where id=$1", [o.id, num]);
  return o.id;
};
const A = await mk("ORD-26100601", "PAY-26100601", "601111111");
const B = await mk("ORD-26100602", "PAY-26100602", "602222222");
const C = await mk("ORD-26100603", "PAY-26100603", "REWARD_ONLY");
const nahyaMember = (await one("select id from public.team_members where slug='nahya'")).id;
await call("staff-access", { action: "invite", memberId: nahyaMember, email: "nahya.test@example.com", pin: "1234" }, "mel");
const find = async (who, search) => {
  const r = await call("list-orders", { search }, who);
  return { status: r.status, ids: (r.body?.orders ?? []).map((o) => o.id), body: r.body };
};
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

let r = await find("mel", "ORD-26100602");
check("Admin : n° de commande (comme avant)", r.status === 200 && same(r.ids, [B]), r);
r = await find("mel", "PAY-26100601");
check("Admin : référence de paiement PAY-… complète", same(r.ids, [A]), r);
r = await find("mel", "pay-2610060");
check("Admin : référence partielle, sans tenir compte des majuscules", same(r.ids, [A, B, C]), r);
r = await find("eli", "602222222");
check("Admin (Eli) : n° de transaction PostFinance", same(r.ids, [B]), r);
r = await find("mel", "  601111111 ");
check("Admin : espaces autour ignorés", same(r.ids, [A]), r);
r = await find("mel", "%");
check("Caractère spécial seul (« % ») : aucune commande, jamais toute la liste", r.status === 200 && r.ids.length === 0, r);
r = await find("mel", "PAY-26100601),order_number.ilike.%");
check("Tentative d'injection dans le filtre : neutralisée (seuls lettres, chiffres, tirets gardés)", r.status === 200 && r.ids.length === 0, r);
r = await find("mel", "");
check("Sans recherche : toutes les commandes (comme avant)", same(r.ids, [A, B, C]), r);
r = await find("nahya", "ORD-26100601");
check("Employée : n° de commande (comme avant)", r.status === 200 && same(r.ids, [A]), r);
r = await find("nahya", "PAY-26100601");
check("Employée : la référence de paiement ne trouve rien (aucune donnée de paiement)", r.status === 200 && r.ids.length === 0, r);
r = await find("nahya", "601111111");
check("Employée : le n° de transaction ne trouve rien", r.status === 200 && r.ids.length === 0, r);
r = await find("client", "PAY-26100601");
check("Client ordinaire : refusé (401)", r.status === 401);

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
