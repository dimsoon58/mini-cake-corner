// Clients F20 — historique de la cagnotte, crédit manuel, newsletter, offre de
// bienvenue, actions sur le compte, source de la première commande. Base
// locale PGlite = schéma de production + F1–F20 ; vraie fonction
// manage-customers ; Supabase Auth SIMULÉ (aucun e-mail réel : les appels
// sont seulement enregistrés). Ne se connecte jamais à Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_customer_loyalty.mjs
import { freshDb } from "./load.mjs";
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

process.on("unhandledRejection", (e) => { console.log("ERROR:", e?.stack ?? e); process.exit(2); });

const ROOT = path.resolve(import.meta.dirname, "../..");
const REPO = path.resolve(ROOT, "..");
const MIG = path.join(ROOT, "migrations");
const migrations = fs.readdirSync(MIG).filter((f) => /^202610(02(09|10|11|12|13|14|16|17|18|19)|03|04|05)/.test(f)).sort().map((f) => path.join(MIG, f));
const F20 = migrations.find((f) => f.includes("_f20_"));

let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 900) : ""); } };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

const db = await freshDb({ migrations });
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

// ── Supabase Auth simulé ────────────────────────────────────────────────
const authUsers = new Map();   // id → user
const authCalls = [];          // tous les appels (aucun e-mail réel)
let authFail = null;           // prochaine erreur à renvoyer
async function addAuthUser(email, extra = {}, meta = {}) {
  const id = (await one("select gen_random_uuid() id")).id;
  await q("insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3)", [id, email, meta]);   // → profil (handle_new_user) → fiche (F8)
  const u = { id, email, created_at: new Date().toISOString(), email_confirmed_at: null, invited_at: null, last_sign_in_at: null, ...extra };
  authUsers.set(id, u);
  return u;
}
globalThis.__auth = {
  getUser: async (j) => ({ data: { user: j === "admin-jwt" ? { email: "naglemelodie@gmail.com" } : j === "client-jwt" ? { email: "x@y.ch" } : null }, error: null }),
  admin: {
    getUserById: async (id) => { authCalls.push({ fn: "getUserById", id }); return { data: { user: authUsers.get(id) ?? null }, error: authUsers.has(id) ? null : { message: "User not found" } }; },
    inviteUserByEmail: async (email, opts) => {
      authCalls.push({ fn: "inviteUserByEmail", email, opts });
      if (authFail) { const e = authFail; authFail = null; return { data: null, error: e }; }
      const existing = [...authUsers.values()].find((u) => u.email === email);
      if (existing && existing.email_confirmed_at) return { data: null, error: { message: "A user with this email address has already been registered" } };
      if (existing) { existing.invited_at = new Date().toISOString(); return { data: { user: existing }, error: null }; }
      const u = await addAuthUser(email, { invited_at: new Date().toISOString() }, opts?.data ?? {});
      return { data: { user: u }, error: null };
    },
    updateUserById: async (id, attrs) => {
      authCalls.push({ fn: "updateUserById", id, attrs });
      if ([...authUsers.values()].some((u) => u.id !== id && u.email === attrs.email)) return { data: null, error: { message: "Email address already registered by another user" } };
      Object.assign(authUsers.get(id), { email: attrs.email });
      return { data: { user: authUsers.get(id) }, error: null };
    },
  },
  resend: async (p) => { authCalls.push({ fn: "resend", ...p }); return { data: {}, error: null }; },
  resetPasswordForEmail: async (email, opts) => { authCalls.push({ fn: "resetPasswordForEmail", email, opts }); return { data: {}, error: null }; },
};
const brevoCalls = [];
globalThis.fetch = async (url, init) => {
  brevoCalls.push(String(url));
  if (String(url).includes("brevo.test.missing")) return new Response("{}", { status: 404 });
  return new Response(JSON.stringify({ email: "x", createdAt: "2025-03-14T10:00:00.000+01:00", listIds: [7] }), { status: 200 });
};

// ── Vraie fonction manage-customers ─────────────────────────────────────
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x", ADMIN_ORDER_PIN: "1234", BREVO_API_KEY: "brevo-test", BREVO_LIST_ID: "7", SITE_BASE_URL: "https://site.test" })[k] } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cl-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), "export function createClient() { return { auth: globalThis.__auth, rpc: (fn, args) => globalThis.__rpc(fn, args) }; }");
await build({ entryPoints: [path.join(ROOT, "functions/manage-customers/index.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "fn.mjs"), logLevel: "warning",
  plugins: [{ name: "m", setup(b) {
    b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
    b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
  } }] });
await import(path.join(tmp, "fn.mjs"));
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
const PIN = "1234";
const get = async (id) => (await call({ action: "get", customerId: id })).body.data;

// ── Code du site (état de l'offre de bienvenue) ─────────────────────────
fs.writeFileSync(path.join(tmp, "client.mjs"), "export const supabase = {};");
await build({ entryPoints: [path.join(REPO, "src/lib/customers.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "cu.mjs"), logLevel: "warning",
  plugins: [{ name: "a", setup(b) {
    b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: path.join(tmp, "client.mjs") }));
  } }] });
const CU = await import(path.join(tmp, "cu.mjs"));

// ── Données ─────────────────────────────────────────────────────────────
let n = 0;
async function order({ customer, items = [100], status = "paid", manual = false, channel = null, test = false, draft = false, created = null, email = "alice@test.ch" }) {
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, paid_at, order_validation, physical_validation,
      order_source, created_via, order_channel, is_test, is_draft, customer_id, fulfillment_type, created_at)
    values ('fr','Alice','Martin',$1,'079',$2,$3,$4,'approved','approved',$5,$6,$7,$8,$9,$10,'cake_only',coalesce($11::timestamptz, now())) returning id`,
    [email, items.reduce((s, x) => s + x, 0), status, status === "paid" ? new Date().toISOString() : null, manual ? "manual order" : "website", manual ? "admin" : null,
     channel, test, draft, customer, created]);
  await q("update public.orders set order_number = $2 where id = $1", [o.id, `${manual ? "ORDM" : "ORD"}-L${++n}`]);
  for (const t of items) await q("insert into public.order_items (order_id, product, total, size) values ($1,'bento_cake',$2,'10cm')", [o.id, t]);
  return o.id;
}
const custOfProfile = async (p) => (await one("select id from public.customers where profile_id=$1", [p])).id;
const makeCalls = async () => (await one("select count(*)::int n from net._calls")).n;

const alice = await addAuthUser("alice@test.ch", { email_confirmed_at: new Date().toISOString() }, { first_name: "Alice", last_name: "Martin" });
const cAlice = await custOfProfile(alice.id);

// ═══ 1. Historique de la cagnotte (registres existants) ═════════════════
// a) commande de 100 → 3.50 gagnés ; b) remboursement partiel de 40 → 1.40 retirés une fois.
const o1 = await order({ customer: alice.id, items: [60, 40], created: "2026-09-01T10:00:00Z" });
await q("select * from public.finalize_reward_for_order($1)", [o1]);
await q(`select * from public.ingest_refund(p_order_id=>$1, p_amount=>40, p_refunded_at=>'2026-09-10 12:00 Europe/Zurich', p_source=>'admin',
  p_method=>'twint', p_allow_gesture=>true, p_idempotency_key=>'r1')`, [o1]);
// c) utilisation de 1.00 sur une commande suivante.
const o2 = await order({ customer: alice.id, items: [50] });
await q("select * from public.reserve_reward($1,$2,1.00,1.00)", [alice.id, o2]);
await q("update public.orders set reward_amount_used = 1.00 where id=$1", [o2]);
await q("select * from public.finalize_reward_for_order($1)", [o2]);
// d) commande remboursée en entier : cashback restant annulé, cagnotte utilisée rendue.
const o3 = await order({ customer: alice.id, items: [80] });
await q("select * from public.finalize_reward_for_order($1)", [o3]);
await q("update public.orders set payment_status = 'refunded' where id=$1", [o3]);
await q("select * from public.refund_reward_for_order($1)", [o3]);

let d = await get(cAlice);
let h = d.account.rewards;
const kinds = h.events.map((e) => e.kind);
check("Historique : gains des commandes (3.50, 1.71, 2.80)", h.events.filter((e) => e.kind === "earned").map((e) => Number(e.amount)).sort().join(",") === "1.71,2.8,3.5", h.events);
check("Historique : remboursement partiel de 40 → 1.40 retirés UNE fois, avec la commande", h.events.filter((e) => e.kind === "refund_adjustment").length === 1 && near(h.events.find((e) => e.kind === "refund_adjustment").amount, -1.40)
  && h.events.find((e) => e.kind === "refund_adjustment").orderNumber === "ORD-L1");
check("Historique : 1.00 utilisé sur ORD-L2", near(h.events.find((e) => e.kind === "spent").amount, -1) && h.events.find((e) => e.kind === "spent").orderNumber === "ORD-L2");
check("Historique : commande remboursée en entier → cashback restant (2.80) retiré", near(h.events.find((e) => e.kind === "refund_cancelled")?.amount, -2.80), h.events);
check("Solde affiché = somme des lots valides (aucun écart)", near(h.balance, h.computedBalance) && near(d.account.rewardBalance, h.computedBalance));
check("Somme des mouvements = solde", near(h.events.reduce((s, e) => s + Number(e.amount), 0), h.computedBalance), { sum: h.events.reduce((s, e) => s + Number(e.amount), 0), bal: h.computedBalance });
check("Historique : dates présentes ; seul le retrait d'une commande remboursée sans remboursement daté reste « date inconnue » (jamais inventée)",
  h.events.every((e) => e.at || e.kind === "refund_cancelled"));
// e) un solde déjà faux n'est jamais recalculé par la lecture : il est signalé.
await q("update public.profiles set reward_balance = 99 where id=$1", [alice.id]);
d = await get(cAlice);
check("Écart solde / lots : signalé, PAS corrigé", near(d.account.rewards.balance, 99) && !near(d.account.rewards.computedBalance, 99) && near((await one("select reward_balance from public.profiles where id=$1", [alice.id])).reward_balance, 99));
await q("select public.recompute_reward_balance($1)", [alice.id]);

// ═══ 2. Crédit manuel ═════════════════════════════════════════════════════
const before = Number((await one("select reward_balance from public.profiles where id=$1", [alice.id])).reward_balance);
const mk0 = await makeCalls();
let r = await call({ action: "reward_credit", customerId: cAlice, amount: "5", reason: "Geste fidélité", idempotencyKey: "k-credit-1", pin: PIN });
check("Crédit manuel : 5.00 ajoutés à la cagnotte existante", r.status === 200 && near(r.body.data.balance, before + 5) && r.body.data.replayed === false, r.body);
const r2 = await call({ action: "reward_credit", customerId: cAlice, amount: "5", reason: "Geste fidélité", idempotencyKey: "k-credit-1", pin: PIN });
check("Double clic (même clé) : aucun second crédit", r2.status === 200 && r2.body.data.replayed === true && (await one("select count(*)::int n from public.reward_manual_credits")).n === 1
  && near((await one("select reward_balance from public.profiles where id=$1", [alice.id])).reward_balance, before + 5));
check("Le crédit change le solde → UN envoi à Make (Notion), comme tout changement de solde", (await makeCalls()) - mk0 === 1);
d = await get(cAlice);
const mc = d.account.rewards.events.find((e) => e.kind === "manual_credit");
check("Historique : crédit manuel avec motif, auteur et expiration à 1 an", mc && near(mc.amount, 5) && mc.reason === "Geste fidélité" && mc.by === "naglemelodie@gmail.com" && !!mc.expiresAt);
check("Journal de la fiche : « cagnotte créditée »", d.events.some((e) => e.kind === "reward_credit" && e.by === "naglemelodie@gmail.com"));
check("Motif obligatoire", (await call({ action: "reward_credit", customerId: cAlice, amount: "5", reason: " ", idempotencyKey: "k2", pin: PIN })).status === 400);
check("Montant invalide / trop élevé refusés", (await call({ action: "reward_credit", customerId: cAlice, amount: "-3", reason: "x", idempotencyKey: "k3", pin: PIN })).status === 400
  && (await call({ action: "reward_credit", customerId: cAlice, amount: "600", reason: "x", idempotencyKey: "k4", pin: PIN })).status === 409);
const guest = (await one(`insert into public.customers (first_name, last_name, email, source, created_by) values ('Bob','Keller','bob@test.ch','admin','test') returning id`)).id;
check("Client sans compte : crédit refusé", (await call({ action: "reward_credit", customerId: guest, amount: "5", reason: "x", idempotencyKey: "k5", pin: PIN })).status === 409);

// ═══ Droits d'accès ═══════════════════════════════════════════════════════
check("Sans connexion : refusé", (await call({ action: "get", customerId: cAlice }, null)).status === 401);
check("Client connecté non admin : refusé", (await call({ action: "reward_credit", customerId: cAlice, amount: "5", reason: "x", idempotencyKey: "k6", pin: PIN }, "client-jwt")).status === 401);
check("Admin sans PIN (ni session ni PIN saisi) : crédit refusé", (await call({ action: "reward_credit", customerId: cAlice, amount: "5", reason: "x", idempotencyKey: "k7" })).status === 403);
check("Admin, PIN faux : refusé, rien écrit", (await call({ action: "password_reset", customerId: cAlice, pin: "0000" })).status === 403 && !authCalls.some((c) => c.fn === "resetPasswordForEmail"));
check("Fonctions SQL fermées à anon / authenticated", (await one(`select count(*)::int n from information_schema.routine_privileges
  where routine_name in ('admin_reward_credit','admin_reward_history','customer_account_action_begin','customer_attach_profile','admin_profile_set_email')
    and grantee in ('anon','authenticated','PUBLIC')`)).n === 0);

// ═══ 3. Newsletter ════════════════════════════════════════════════════════
check("Newsletter : ancien abonné sans date → aucune date inventée", (await get(cAlice)).account.newsletterSubscribedAt === null);
await q("update public.profiles set newsletter_subscription = true where id=$1", [alice.id]);
let p = await one("select newsletter_subscribed_at, newsletter_unsubscribed_at from public.profiles where id=$1", [alice.id]);
check("Inscription → date d'inscription", !!p.newsletter_subscribed_at && !p.newsletter_unsubscribed_at);
await q("update public.profiles set first_name = 'Alicia', newsletter_subscribed_at = '2020-01-01' where id=$1", [alice.id]);
check("Autre modification (même forcée sur la date) : dates inchangées", (await one("select newsletter_subscribed_at from public.profiles where id=$1", [alice.id])).newsletter_subscribed_at.getTime() === p.newsletter_subscribed_at.getTime());
await q("update public.profiles set newsletter_subscription = false where id=$1", [alice.id]);
p = await one("select newsletter_subscription, newsletter_subscribed_at, newsletter_unsubscribed_at from public.profiles where id=$1", [alice.id]);
check("Désinscription → date de désinscription (inscription conservée)", !!p.newsletter_unsubscribed_at && !!p.newsletter_subscribed_at && !p.newsletter_subscription);
r = await call({ action: "newsletter_brevo", customerId: cAlice });
check("Brevo : lecture seule de la date du contact (aucune inscription)", r.status === 200 && r.body.data.found && r.body.data.createdAt.startsWith("2025-03-14") && r.body.data.inList === true
  && brevoCalls.length === 1 && !brevoCalls.some((u) => /contacts$/.test(u)));
check("Rien n'inscrit le client automatiquement", !(await one("select newsletter_subscription from public.profiles where id=$1", [alice.id])).newsletter_subscription);

// ═══ 4. Offre de bienvenue ════════════════════════════════════════════════
const A = (o) => ({ welcomeAvailable: false, welcomeUsedAt: null, welcomeExpiresAt: null, welcomeReservedAt: null, ...o });
const future = new Date(Date.now() + 86400e3).toISOString(), past = new Date(Date.now() - 86400e3).toISOString();
check("Bienvenue : Disponible", CU.welcomeState(A({ welcomeAvailable: true, welcomeExpiresAt: future })) === "available");
check("Bienvenue : Utilisée (même si encore marquée disponible)", CU.welcomeState(A({ welcomeAvailable: true, welcomeUsedAt: past, welcomeExpiresAt: future })) === "used");
check("Bienvenue : Expirée (date passée, même si le drapeau n'a pas été remis à jour)", CU.welcomeState(A({ welcomeAvailable: true, welcomeExpiresAt: past })) === "expired");
check("Bienvenue : non activée sans newsletter", CU.welcomeState(A({})) === "inactive");
await q("update public.profiles set welcome_discount_used_at = now(), welcome_discount_available = false where id=$1", [alice.id]);
await q("update public.orders set welcome_discount_amount = 10 where id=$1", [o2]);
d = await get(cAlice);
check("Bienvenue : date d'utilisation et commande", !!d.account.welcomeUsedAt && d.account.welcomeUsedOrder === "ORD-L2");

// ═══ 5. Actions sur le compte (Auth simulé, aucun e-mail réel) ════════════
r = await call({ action: "account_status", customerId: cAlice });
check("Statut : compte actif, email de connexion distinct de l'email de contact", r.body.data.state === "active" && r.body.data.loginEmail === "alice@test.ch" && "contactEmail" in r.body.data);
r = await call({ action: "password_reset", customerId: cAlice, pin: PIN });
check("Réinitialisation : e-mail existant demandé à Auth une fois, vers /reset-password", r.status === 200 && authCalls.filter((c) => c.fn === "resetPasswordForEmail").length === 1
  && authCalls.find((c) => c.fn === "resetPasswordForEmail").opts.redirectTo === "https://site.test/reset-password");
r = await call({ action: "password_reset", customerId: cAlice, pin: PIN });
check("Double clic (< 60 s) : refusé, pas de second e-mail", r.status === 409 && authCalls.filter((c) => c.fn === "resetPasswordForEmail").length === 1);
check("Activation renvoyée refusée pour un compte actif", (await call({ action: "account_resend", customerId: cAlice, pin: PIN })).status === 400);

// Changer l'email de connexion : Auth + profil, l'email de contact ne change pas, aucun e-mail.
const contactBefore = (await one("select email from public.customers where id=$1", [cAlice])).email;
const sentBefore = authCalls.filter((c) => ["resetPasswordForEmail", "resend", "inviteUserByEmail"].includes(c.fn)).length;
r = await call({ action: "login_email_change", customerId: cAlice, email: "alice.new@test.ch", pin: PIN });
check("Email de connexion changé (Auth + compte), contact inchangé, aucun e-mail", r.status === 200 && authUsers.get(alice.id).email === "alice.new@test.ch"
  && (await one("select email from public.profiles where id=$1", [alice.id])).email === "alice.new@test.ch"
  && (await one("select email from public.customers where id=$1", [cAlice])).email === contactBefore
  && authCalls.filter((c) => ["resetPasswordForEmail", "resend", "inviteUserByEmail"].includes(c.fn)).length === sentBefore, r.body);
const other = await addAuthUser("taken@test.ch", { email_confirmed_at: new Date().toISOString() });
r = await call({ action: "login_email_change", customerId: cAlice, email: "taken@test.ch", pin: PIN });
check("Email déjà utilisé par un autre compte : refusé, résultat journalisé", r.status === 409 && /autre compte/.test(r.body.error)
  && (await get(cAlice)).events.some((e) => e.kind === "login_email_change" && e.detail.result === "error"));

// Inviter un client sans compte (noms différents du compte créé : la fiche reste la bonne).
const cGuest = (await one(`insert into public.customers (first_name, last_name, email, phone, source, created_by) values ('Carla','Rossi','carla@test.ch','079','admin','test') returning id`)).id;
const ordGuest = await order({ customer: null, email: "carla@test.ch", manual: true, channel: "instagram", created: "2026-08-01T10:00:00Z" });
await q("update public.orders set customer_ref_id = $2 where id=$1", [ordGuest, cGuest]);
r = await call({ action: "account_status", customerId: cGuest });
check("Statut sans compte : « none »", r.body.data.state === "none");
r = await call({ action: "account_invite", customerId: cGuest, email: "carla@test.ch", pin: PIN });
const invited = [...authUsers.values()].find((u) => u.email === "carla@test.ch");
check("Invitation : un appel Auth (e-mail d'invitation existant), compte rattaché à CETTE fiche", r.status === 200 && authCalls.filter((c) => c.fn === "inviteUserByEmail").length === 1
  && (await one("select profile_id from public.customers where id=$1", [cGuest])).profile_id === invited.id
  && (await one("select count(*)::int n from public.customers where profile_id=$1 and merged_into is null", [invited.id])).n === 1, r.body);
check("Invitation : redirection vers /reset-password, nom de la fiche transmis", authCalls.find((c) => c.fn === "inviteUserByEmail").opts.redirectTo === "https://site.test/reset-password"
  && authCalls.find((c) => c.fn === "inviteUserByEmail").opts.data.first_name === "Carla");
r = await call({ action: "account_status", customerId: cGuest });
check("Statut après invitation : « invité »", r.body.data.state === "invited");
check("Nouvelle invitation refusée (déjà un compte)", (await call({ action: "account_invite", customerId: cGuest, pin: PIN })).status === 400);
r = await call({ action: "account_resend", customerId: cGuest, pin: PIN });
check("Renvoyer l'activation d'un invité : nouvelle invitation", r.status === 200 && authCalls.filter((c) => c.fn === "inviteUserByEmail").length === 2);
check("Renvoyer à nouveau tout de suite : refusé (pas de second e-mail)", (await call({ action: "account_resend", customerId: cGuest, pin: PIN })).status === 409
  && authCalls.filter((c) => c.fn === "inviteUserByEmail").length === 2);
check("Mot de passe pour un compte non activé : refusé", (await call({ action: "password_reset", customerId: cGuest, pin: PIN })).status === 400);
// Compte créé sur le site mais non confirmé : renvoi de l'e-mail d'inscription.
const dan = await addAuthUser("dan@test.ch", {}, { first_name: "Dan", last_name: "Muller" });
const cDan = await custOfProfile(dan.id);
r = await call({ action: "account_resend", customerId: cDan, pin: PIN });
check("Compte non confirmé : e-mail d'inscription renvoyé (type signup)", r.status === 200 && authCalls.some((c) => c.fn === "resend" && c.type === "signup" && c.email === "dan@test.ch"));
// Erreur Auth : journalisée, message clair.
const cEve = (await one(`insert into public.customers (first_name, email, source, created_by) values ('Eve','eve@test.ch','admin','test') returning id`)).id;
authFail = { message: "Email rate limit exceeded" };
r = await call({ action: "account_invite", customerId: cEve, pin: PIN });
check("Erreur Auth : message lisible, résultat « échec » dans l'historique", r.status === 409 && /réessayez/.test(r.body.error)
  && (await get(cEve)).events.some((e) => e.kind === "account_invite" && e.detail.result === "error"));
d = await get(cGuest);
check("Historique des actions du compte conservé sur la fiche", d.events.filter((e) => ["account_invite", "account_resend"].includes(e.kind)).length === 2
  && d.events.every((e) => !["account_invite", "account_resend"].includes(e.kind) || e.detail.result === "ok"));

// ═══ 6. Source de la première commande ═══════════════════════════════════
check("Source : commande manuelle Instagram", d.firstOrder?.source === "instagram");
check("Source : commande du site → « website »", (await get(cAlice)).firstOrder?.source === "website");
const cMarc = (await one(`insert into public.customers (first_name, email, source, created_by) values ('Marc','marc@test.ch','admin','test') returning id`)).id;
const oMarcTest = await order({ customer: null, email: "marc@test.ch", test: true, created: "2026-01-01T10:00:00Z" });
const oMarc = await order({ customer: null, email: "marc@test.ch", manual: true, channel: null, created: "2026-02-01T10:00:00Z" });
await q("update public.orders set customer_ref_id = $2 where id = any($1::uuid[])", [[oMarcTest, oMarc], cMarc]);
check("Source inconnue (manuelle sans canal) : rien d'inventé ; commande de test ignorée", (await get(cMarc)).firstOrder?.source === null && (await get(cMarc)).firstOrder?.orderNumber !== "ORD-L" + 0);
check("Sans commande : pas de source", (await get(guest)).firstOrder === null);

// ═══ Relance de F20 ═══════════════════════════════════════════════════════
const snap = JSON.stringify((await get(cAlice)).account.rewards);
await db.exec(fs.readFileSync(F20, "utf8"));
check("Relance de F20 : rien ne change", JSON.stringify((await get(cAlice)).account.rewards) === snap && (await one("select count(*)::int n from public.reward_manual_credits")).n === 1);

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
