// PIN admin demandé une seule fois par session (F16) — vraies fonctions
// admin-pin, manage-customers (écriture protégée) et get-today (lecture), avec
// le vrai _shared/admin-auth.ts, sur le schéma de production (PGlite, F1–F16,
// petite traduction supabase-js → SQL). Ne se connecte jamais à Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_admin_pin.mjs
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
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 700) : ""); } };

const migrations = fs.readdirSync(MIG).filter((f) => /^202610(02(09|10|11|12|13|14|16|17|18|19)|03)/.test(f)).sort().map((f) => path.join(MIG, f));
const F16 = migrations.find((f) => f.includes("_f16_"));
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
    upsert(v, o = {}) { op = "upsert"; values = v; conflict = o.onConflict; return b; },
    eq(c, v) { where.push(`${c}::text = ${p(String(v))}`); return b; },
    neq(c, v) { where.push(`${c}::text is distinct from ${p(String(v))}`); return b; },
    gte(c, v) { where.push(`${c} >= ${p(v)}`); return b; },
    lte(c, v) { where.push(`${c} <= ${p(v)}`); return b; },
    in(c, v) { where.push(`${c}::text = any(${p(v.map(String))}::text[])`); return b; },
    is(c, v) { where.push(v === null ? `${c} is null` : `${c} is ${v}`); return b; },
    order(c, o = {}) { orderBy = ` order by ${c} ${o.ascending === false ? "desc" : "asc"}`; return b; },
    limit(n) { lim = ` limit ${Number(n)}`; return b; },
    maybeSingle() { single = "maybe"; return b; },
    single() { single = "one"; return b; },
    then(res, rej) {
      const w = where.length ? ` where ${where.join(" and ")}` : "";
      let sql;
      if (op === "update") sql = `update public.${table} set ${Object.entries(values).map(([k, v]) => `${k} = ${p(v)}`).join(", ")}${w} returning ${returning ? cols : "id"}`;
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
      ks.map((k) => (k === "p_items" ? args[k] : args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k])));
    const cols = res.fields.map((f) => f.name);
    return { data: cols.length === 1 && cols[0] === fn ? (res.rows[0]?.[fn] ?? null) : res.rows, error: null };
  } catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
};
// JWT factices : en-tête.payload.signature ; getUser simulé par jeton entier.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (email, sid) => `${b64({ alg: "HS256" })}.${b64({ email, session_id: sid })}.sig`;
const MEL_S1 = jwt("naglemelodie@gmail.com", "s1"), MEL_S2 = jwt("naglemelodie@gmail.com", "s2"), ELI_S9 = jwt("e.potapushina@gmail.com", "s9"), CLIENT = jwt("x@y.ch", "s3");
const USERS = { [MEL_S1]: "naglemelodie@gmail.com", [MEL_S2]: "naglemelodie@gmail.com", [ELI_S9]: "e.potapushina@gmail.com", [CLIENT]: "x@y.ch" };
globalThis.__supa = { from, rpc, auth: { getUser: async (j) => ({ data: { user: USERS[j] ? { email: USERS[j] } : null }, error: null }) } };
globalThis.fetch = async () => { throw new Error("réseau interdit dans ce test"); };
const ENV = { SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x", ADMIN_ORDER_PIN: "4711" };
globalThis.Deno = { env: { get: (k) => ENV[k] } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ap-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), "export function createClient() { return globalThis.__supa; }");
const fns = {};
for (const name of ["admin-pin", "manage-customers", "get-today"]) {
  await build({ entryPoints: [path.join(ROOT, `functions/${name}/index.ts`)], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, `${name}.mjs`), logLevel: "error",
    plugins: [{ name: "m", setup(b) {
      b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
      b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
    } }] });
  await import(path.join(tmp, `${name}.mjs`));
  fns[name] = globalThis.__handler;
}
await build({ entryPoints: [path.join(ROOT, "functions/_shared/admin-auth.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "auth.mjs"), logLevel: "error" });
const A = await import(path.join(tmp, "auth.mjs"));
const call = async (name, body, token = MEL_S1) => {
  const r = await fns[name](new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
};
const unlock = (pin, token = MEL_S1) => call("admin-pin", { action: "unlock", pin }, token);
const saveCustomer = (extra, token = MEL_S1) => call("manage-customers", { action: "save", firstName: "Test", lastName: `Pin ${Math.random()}`, ...extra }, token);

// ═══ Comparaison sûre ═══════════════════════════════════════════════════
check("Comparaison du PIN en temps constant : égalité exacte seulement", A.safeEqual("4711", "4711") && !A.safeEqual("4711", "4712") && !A.safeEqual("4711", "47111") && !A.safeEqual("", "4711"));

// ═══ Déverrouiller ══════════════════════════════════════════════════════
let r = await call("admin-pin", { action: "unlock", pin: "4711" }, null);
check("Sans connexion : refusé (401)", r.status === 401);
r = await call("admin-pin", { action: "unlock", pin: "4711" }, CLIENT);
check("Compte non admin : refusé même avec le bon PIN (401)", r.status === 401);
r = await unlock("0000");
check("Mauvais PIN : refusé (403), essais restants indiqués", r.status === 403 && /4 essai/.test(r.body.error), r.body);
r = await unlock("4711");
const T1 = r.body.data?.token;
check("Bon PIN : autorisation délivrée (jeton + expiration)", r.status === 200 && typeof T1 === "string" && T1.length >= 40 && Date.parse(r.body.data.expiresAt) > Date.now(), r.body);
const exp = (Date.parse(r.body.data.expiresAt) - Date.now()) / 3600e3;
check("Expiration par défaut : 12 heures", exp > 11.9 && exp <= 12.01, exp);
const dump = JSON.stringify(await q("select * from public.admin_pin_sessions")) + JSON.stringify(await q("select * from public.admin_pin_attempts"));
check("Ni le PIN ni le jeton en clair en base (empreinte SHA-256 seulement)", !dump.includes("4711") && !dump.includes(T1) && dump.includes(await A.sha256Hex(T1)));
check("Autorisation liée à l'email et à la session de connexion", (await one("select admin_email, auth_session_id from public.admin_pin_sessions where revoked_at is null")).auth_session_id === "s1");

// ═══ Utilisation ════════════════════════════════════════════════════════
r = await call("admin-pin", { action: "status", _adminSession: T1 });
check("Statut avec le jeton : actif", r.body.data?.active === true);
r = await call("admin-pin", { action: "status" });
check("Statut sans jeton : inactif", r.body.data?.active === false);
r = await saveCustomer({ _adminSession: T1 });
check("Écriture protégée avec l'autorisation, sans ressaisir le PIN : acceptée", r.status === 200, r.body);
r = await saveCustomer({ _adminSession: T1, pin: "__session__" });
check("… même avec la valeur de remplacement envoyée par le site", r.status === 200);
r = await saveCustomer({});
check("Écriture protégée sans autorisation ni PIN : refusée (403)", r.status === 403 && r.body.reason === "pin");
r = await saveCustomer({ pin: "4711" });
check("Ancienne page (PIN saisi) : toujours acceptée", r.status === 200);
r = await saveCustomer({ pin: "__session__" });
check("Valeur de remplacement sans autorisation : refusée", r.status === 403);
r = await saveCustomer({ _adminSession: T1 }, MEL_S2);
check("Jeton réutilisé dans une autre session de connexion (reconnexion) : refusé", r.status === 403);
r = await saveCustomer({ _adminSession: T1 }, ELI_S9);
check("Jeton de Mel utilisé par un autre compte : refusé", r.status === 403);
r = await saveCustomer({ _adminSession: T1 }, CLIENT);
check("Compte non admin avec un jeton valide : refusé (401)", r.status === 401);

// ═══ Une autorisation par session ; expiration ; verrouillage ══════════
const T2 = (await unlock("4711")).body.data.token;
r = await saveCustomer({ _adminSession: T1 });
check("Nouveau déverrouillage dans la même session : l'ancien jeton ne vaut plus", r.status === 403 && (await saveCustomer({ _adminSession: T2 })).status === 200);
await q("update public.admin_pin_sessions set expires_at = now() - interval '1 minute' where token_hash = $1", [await A.sha256Hex(T2)]);
r = await saveCustomer({ _adminSession: T2 });
check("Autorisation expirée : refusée → PIN redemandé", r.status === 403 && (await call("admin-pin", { action: "status", _adminSession: T2 })).body.data.active === false);
const T3 = (await unlock("4711")).body.data.token;
r = await call("admin-pin", { action: "lock", _adminSession: T3 });
check("Déconnexion (verrouillage) : jeton révoqué", r.status === 200 && (await saveCustomer({ _adminSession: T3 })).status === 403
  && (await one("select revoked_reason from public.admin_pin_sessions where token_hash = $1", [await A.sha256Hex(T3)])).revoked_reason === "déconnexion");

// ═══ Tentatives limitées ════════════════════════════════════════════════
for (let i = 0; i < 5; i++) await unlock("1111", ELI_S9);
r = await unlock("4711", ELI_S9);
check("5 échecs en 15 minutes : PIN bloqué, même le bon (429)", r.status === 429, r.body);
await q("update public.admin_pin_attempts set at = at - interval '16 minutes' where admin_email = 'e.potapushina@gmail.com'");
r = await unlock("4711", ELI_S9);
check("Après 15 minutes : déverrouillage possible", r.status === 200);
check("Le blocage d'Eli n'a pas touché Mel", (await unlock("4711")).status === 200);

// ═══ Mode obligatoire (ADMIN_PIN_SESSION_REQUIRED = true) ════════════════
const T4 = (await unlock("4711")).body.data.token;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
check("Mode non obligatoire (par défaut) : lecture admin sans autorisation acceptée", (await call("get-today", { from: today, to: today })).status === 200);
ENV.ADMIN_PIN_SESSION_REQUIRED = "true";
check("Mode obligatoire : lecture admin sans autorisation refusée (401)", (await call("get-today", { from: today, to: today })).status === 401);
check("Mode obligatoire : lecture admin avec autorisation acceptée", (await call("get-today", { from: today, to: today, _adminSession: T4 })).status === 200);
check("Mode obligatoire : PIN saisi seul ne suffit plus (connexion + autorisation exigées)", (await saveCustomer({ pin: "4711" })).status === 401);
check("Mode obligatoire : admin-pin reste accessible pour déverrouiller", (await unlock("4711")).status === 200);
delete ENV.ADMIN_PIN_SESSION_REQUIRED;

// ═══ Site ═══════════════════════════════════════════════════════════════
const src = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
check("Dashboard derrière l'écran PIN (AdminLayout → AdminPinGate)", src("src/components/admin/AdminLayout.tsx").includes("<AdminPinGate>") && src("src/components/admin/AdminLayout.tsx").includes("installAdminSessionTransport()"));
check("Déconnexion : autorisation révoquée puis oubliée", /lockAdminSession\(\);\s*await supabase\.auth\.signOut\(\)/.test(src("src/context/AuthContext.tsx")));
const store = src("src/lib/adminSession.ts");
check("Navigateur : seul le jeton est conservé, jamais le PIN", /setItem\(KEY, JSON\.stringify\(\{ userId, token, expiresAt \}\)\)/.test(store) && !/setItem\([^)]*pin/i.test(store));
const invoked = new Set();
for (const f of fs.readdirSync(path.join(REPO, "src/pages")).filter((f) => f.startsWith("Admin")).map((f) => `src/pages/${f}`)
  .concat(fs.readdirSync(path.join(REPO, "src/components/admin"), { recursive: true }).filter((f) => f.endsWith(".tsx")).map((f) => `src/components/admin/${f}`))
  .concat(["src/lib/partners.ts", "src/lib/refunds.ts", "src/lib/customers.ts", "src/lib/compta.ts", "src/lib/finance.ts", "src/lib/team.ts"].filter((f) => fs.existsSync(path.join(REPO, f))))) {
  for (const m of src(f).matchAll(/functions\.invoke(?:<[^>]*>)?\("([a-z0-9-]+)"/g)) invoked.add(m[1]);
}
const listed = new Set([...store.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]));
const missing = [...invoked].filter((n) => !listed.has(n));
check("Toutes les fonctions appelées par le dashboard reçoivent l'autorisation", missing.length === 0, missing);
const raw = fs.readdirSync(path.join(ROOT, "functions")).filter((d) => fs.existsSync(path.join(ROOT, "functions", d, "index.ts")))
  .filter((d) => /Deno\.env\.get\("ADMIN_ORDER_PIN"\)/.test(fs.readFileSync(path.join(ROOT, "functions", d, "index.ts"), "utf8")) && !["admin-pin", "cancel-workshop-seats", "confirm-workshop-refund"].includes(d));
check("Fonctions du dashboard : plus de comparaison directe du PIN (toutes via adminPinOk)", raw.length === 0, raw);
check("Champs PIN masqués une fois déverrouillé (9 écrans)", ["src/components/admin/compta/SettlementTab.tsx", "src/components/admin/manual-order/ManualOrderPanel.tsx", "src/components/admin/partners/PartnerForm.tsx",
  "src/components/admin/refunds/OrderRefundsPanel.tsx", "src/pages/AdminCustomer.tsx", "src/pages/AdminCustomers.tsx", "src/pages/AdminOrder.tsx", "src/pages/AdminPartner.tsx", "src/pages/AdminRefunds.tsx"]
  .every((f) => /useSessionPin|useAdminSessionActive/.test(src(f))));
check("Actions sensibles : confirmation simple (accepter/refuser, payé, remboursement, paiement partenaire)",
  /window\.confirm/.test(src("src/pages/AdminOrder.tsx")) && /window\.confirm/.test(src("src/components/admin/manual-order/ManualOrderPanel.tsx"))
  && /window\.confirm/.test(src("src/components/admin/refunds/OrderRefundsPanel.tsx")) && /window\.confirm/.test(src("src/pages/AdminPartner.tsx")));

// ═══ Migration ══════════════════════════════════════════════════════════
check("Tables fermées à anon / authenticated", (await one("select count(*)::int n from information_schema.role_table_grants where table_schema='public' and table_name in ('admin_pin_sessions','admin_pin_attempts') and grantee in ('anon','authenticated')")).n === 0);
const n0 = (await one("select count(*)::int n from public.admin_pin_sessions")).n;
await db.exec(fs.readFileSync(F16, "utf8"));
check("Relance de F16 : rien ne change", (await one("select count(*)::int n from public.admin_pin_sessions")).n === n0);

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
