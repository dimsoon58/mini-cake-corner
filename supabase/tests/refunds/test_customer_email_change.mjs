// Clients F21 — « Modifier l'adresse email » (fiche + compte + Brevo). Base
// locale PGlite = schéma de production + F1–F21 ; vraie fonction
// manage-customers ; Supabase Auth et Brevo SIMULÉS (aucun e-mail réel,
// aucun client réel : les appels sont seulement enregistrés). Ne se connecte
// jamais à Supabase ni à Brevo.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_customer_email_change.mjs
import { freshDb } from "./load.mjs";
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

process.on("unhandledRejection", (e) => { console.log("ERROR:", e?.stack ?? e); process.exit(2); });

const ROOT = path.resolve(import.meta.dirname, "../..");
const MIG = path.join(ROOT, "migrations");
const migrations = fs.readdirSync(MIG).filter((f) => /^202610(02(09|10|11|12|13|14|16|17|18|19)|03|04|05)/.test(f)).sort().map((f) => path.join(MIG, f));
const F21 = migrations.find((f) => f.includes("_f21_"));

let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 900) : ""); } };

const db = await freshDb({ migrations });
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

// ── Supabase Auth simulé ────────────────────────────────────────────────
const authUsers = new Map();
const authCalls = [];
let authFail = null;   // prochaine erreur de updateUserById
async function addAuthUser(email, meta = {}) {
  const id = (await one("select gen_random_uuid() id")).id;
  await q("insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3)", [id, email, meta]);   // → profil → fiche (F8)
  const u = { id, email, created_at: new Date().toISOString(), email_confirmed_at: new Date().toISOString() };
  authUsers.set(id, u);
  return u;
}
const SENT = ["inviteUserByEmail", "resend", "resetPasswordForEmail", "createUser", "generateLink"];
globalThis.__auth = {
  getUser: async (j) => ({ data: { user: j === "admin-jwt" ? { email: "naglemelodie@gmail.com" } : j === "eli-jwt" ? { email: "e.potapushina@gmail.com" } : j === "client-jwt" ? { email: "x@y.ch" } : null }, error: null }),
  admin: {
    getUserById: async (id) => { authCalls.push({ fn: "getUserById", id }); return { data: { user: authUsers.get(id) ?? null }, error: authUsers.has(id) ? null : { message: "User not found" } }; },
    updateUserById: async (id, attrs) => {
      authCalls.push({ fn: "updateUserById", id, attrs });
      if (authFail) { const e = authFail; authFail = null; return { data: null, error: e }; }
      if ([...authUsers.values()].some((u) => u.id !== id && u.email === attrs.email)) return { data: null, error: { message: "Email address already registered by another user" } };
      Object.assign(authUsers.get(id), { email: attrs.email });
      await q("update auth.users set email=$2 where id=$1", [id, attrs.email]);
      return { data: { user: authUsers.get(id) }, error: null };
    },
    inviteUserByEmail: async (...a) => { authCalls.push({ fn: "inviteUserByEmail", a }); return { data: null, error: { message: "not expected" } }; },
  },
  resend: async (p) => { authCalls.push({ fn: "resend", ...p }); return { data: {}, error: null }; },
  resetPasswordForEmail: async (email) => { authCalls.push({ fn: "resetPasswordForEmail", email }); return { data: {}, error: null }; },
};

// ── Brevo simulé : contacts par email ───────────────────────────────────
const brevo = new Map();         // email → { email, listIds, emailBlacklisted, attributes }
const brevoCalls = [];
let brevoDown = false;           // GET/PUT → 503
let brevoPutFail = 0;            // nombre de PUT à refuser (500)
globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? "GET";
  const u = new URL(String(url));
  const id = decodeURIComponent(u.pathname.split("/").pop());
  brevoCalls.push({ method, id, body: init.body ? JSON.parse(init.body) : null });
  if (!u.hostname.endsWith("brevo.com")) throw new Error("appel réseau inattendu " + url);
  if (brevoDown) return new Response("{}", { status: 503 });
  if (method === "GET") {
    const c = brevo.get(id);
    return c ? new Response(JSON.stringify(c), { status: 200 }) : new Response(JSON.stringify({ code: "document_not_found" }), { status: 404 });
  }
  if (method === "PUT") {
    if (brevoPutFail > 0) { brevoPutFail--; return new Response(JSON.stringify({ message: "boom" }), { status: 500 }); }
    const c = brevo.get(id);
    if (!c) return new Response("{}", { status: 404 });
    const body = JSON.parse(init.body);
    const ne = body.attributes?.EMAIL?.toLowerCase();
    if (ne && ne !== id) {
      if (brevo.has(ne)) return new Response(JSON.stringify({ code: "duplicate_parameter" }), { status: 400 });
      brevo.delete(id); c.email = ne; brevo.set(ne, c);
    }
    return new Response(null, { status: 204 });
  }
  return new Response("{}", { status: 405 });   // POST (création) / DELETE : jamais attendus
};
const brevoContact = (email, listIds = [7], emailBlacklisted = false) => brevo.set(email, { email, listIds, emailBlacklisted, attributes: { PRENOM: "x" } });

// ── Vraie fonction manage-customers ─────────────────────────────────────
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x", ADMIN_ORDER_PIN: "1234", BREVO_API_KEY: "brevo-test", BREVO_LIST_ID: "7", SITE_BASE_URL: "https://site.test" })[k] } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ec-"));
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
let k = 0;
const key = () => `test-key-${++k}`;
const change = (customerId, email, extra = {}) => call({ action: "email_change", customerId, email, idempotencyKey: key(), identityChecked: true, pin: PIN, ...extra });
const preview = (customerId, email) => call({ action: "email_change_preview", customerId, email });
const get = async (id) => (await call({ action: "get", customerId: id })).body.data;
const custOfProfile = async (p) => (await one("select id from public.customers where profile_id=$1", [p])).id;
const cust = async (id) => one("select id, email, profile_id, merged_into from public.customers where id=$1", [id]);
const ops = async (id) => q("select * from public.customer_email_changes where customer_id=$1 order by created_at", [id]);
const sentCount = () => authCalls.filter((c) => SENT.includes(c.fn)).length;
const brevoWrites = () => brevoCalls.filter((c) => c.method !== "GET");
let n = 0;
async function order(customerProfile, customerRef, email) {
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, paid_at, order_validation, physical_validation,
      order_source, customer_id, customer_ref_id, fulfillment_type) values ('fr','A','B',$1,'079',100,'paid',now(),'approved','approved','website',$2,$3,'cake_only') returning id`,
    [email, customerProfile, customerRef]);
  await q("update public.orders set order_number=$2 where id=$1", [o.id, `ORD-E${++n}`]);
  return o.id;
}

// ═══ 1. Client avec compte, inscrit à la newsletter ═════════════════════
const alice = await addAuthUser("alice@test.ch", { first_name: "Alice", last_name: "Martin" });
const cAlice = await custOfProfile(alice.id);
await q("update public.profiles set reward_balance = 12.5, newsletter_subscription = true where id=$1", [alice.id]);
brevoContact("alice@test.ch", [7, 3]);
const oAlice = await order(alice.id, cAlice, "alice@test.ch");
const eventsBefore = (await get(cAlice)).events.length;

let r = await preview(cAlice, "Alice.Nouvelle@Test.ch");
check("Aperçu : email de contact, email de connexion et nouvelle adresse", r.status === 200 && r.body.data.contactEmail === "alice@test.ch" && r.body.data.loginEmail === "alice@test.ch"
  && r.body.data.newEmail === "alice.nouvelle@test.ch" && r.body.data.hasAccount === true, r.body);
check("Aperçu : aucun conflit, contact Brevo actuel « inscrit », aucun contact sous la nouvelle adresse",
  !r.body.data.conflicts.otherCustomer && !r.body.data.conflicts.otherAccount && r.body.data.brevoOld[0]?.state === "inscrit à la newsletter" && r.body.data.brevoNew.status === 404, r.body.data);
check("Aperçu : lecture seule (aucune écriture Brevo, aucune opération)", brevoWrites().length === 0 && (await ops(cAlice)).length === 0);

r = await call({ action: "email_change", customerId: cAlice, email: "alice.nouvelle@test.ch", idempotencyKey: key(), pin: PIN });
check("Sans « identité vérifiée » : refusé, rien n'est fait", r.status === 400 && (await ops(cAlice)).length === 0 && authUsers.get(alice.id).email === "alice@test.ch");
r = await call({ action: "email_change", customerId: cAlice, email: "alice.nouvelle@test.ch", idempotencyKey: key(), identityChecked: true });
check("Sans PIN : refusé (403)", r.status === 403 && (await ops(cAlice)).length === 0);
r = await call({ action: "email_change", customerId: cAlice, email: "alice.nouvelle@test.ch", idempotencyKey: key(), identityChecked: true, pin: PIN }, "client-jwt");
check("Compte non admin : refusé (401)", r.status === 401 && (await ops(cAlice)).length === 0);

const sent0 = sentCount();
r = await change(cAlice, "Alice.Nouvelle@Test.ch");
check("Changement complet : succès", r.status === 200 && r.body.success === true && r.body.data.status === "completed", r.body);
check("Email de connexion (Auth) remplacé, adresse confirmée", authUsers.get(alice.id).email === "alice.nouvelle@test.ch"
  && authCalls.find((c) => c.fn === "updateUserById" && c.id === alice.id)?.attrs.email_confirm === true);
check("Email du profil et email de contact de la fiche remplacés", (await one("select email from public.profiles where id=$1", [alice.id])).email === "alice.nouvelle@test.ch"
  && (await cust(cAlice)).email === "alice.nouvelle@test.ch");
check("Même compte, même fiche, même cagnotte", (await cust(cAlice)).profile_id === alice.id && Number((await one("select reward_balance from public.profiles where id=$1", [alice.id])).reward_balance) === 12.5
  && (await one("select count(*)::int n from public.customers where profile_id=$1", [alice.id])).n === 1);
check("Brevo : même contact renommé, listes conservées, rien créé", brevo.has("alice.nouvelle@test.ch") && !brevo.has("alice@test.ch")
  && JSON.stringify(brevo.get("alice.nouvelle@test.ch").listIds) === "[7,3]" && brevoWrites().length === 1
  && JSON.stringify(brevoWrites()[0].body) === JSON.stringify({ attributes: { EMAIL: "alice.nouvelle@test.ch" } }), brevoWrites());
check("Aucun e-mail envoyé au client", sentCount() === sent0);
check("Commande déjà émise : coordonnées d'origine conservées", (await one("select email from public.orders where id=$1", [oAlice])).email === "alice@test.ch");
check("Aucune alerte « coordonnées du compte différentes »", (await q("select 1 from public.customer_alerts where customer_id=$1 and kind='profile_contact_diff' and resolved_at is null", [cAlice])).length === 0);
let d = await get(cAlice);
let ev = d.events.find((e) => e.kind === "email_change");
check("Historique : ancienne et nouvelle adresse, auteur, date, résultat de chaque étape", d.events.length === eventsBefore + 1 && ev.detail.from_contact === "alice@test.ch" && ev.detail.from_login === "alice@test.ch"
  && ev.detail.to === "alice.nouvelle@test.ch" && ev.by === "naglemelodie@gmail.com" && !!ev.at && ev.detail.status === "completed"
  && ev.detail.steps.auth === "ok" && ev.detail.steps.db === "ok" && ev.detail.steps.brevo === "ok" && /renommé/.test(ev.detail.steps.brevo_message), ev);
const op1 = (await ops(cAlice))[0];
check("Opération enregistrée : identité vérifiée, auteur, terminée, verrou libéré", op1.identity_checked === true && op1.created_by === "naglemelodie@gmail.com" && op1.status === "completed" && !!op1.finished_at && op1.locked_until === null);

// Double clic APRÈS la fin (même clé) : résultat renvoyé, rien n'est refait.
const writesBefore = brevoWrites().length, updBefore = authCalls.filter((c) => c.fn === "updateUserById").length;
r = await call({ action: "email_change", customerId: cAlice, email: "alice.nouvelle@test.ch", idempotencyKey: op1.idempotency_key, identityChecked: true, pin: PIN });
check("Même clé rejouée après la fin : même résultat, aucune nouvelle écriture", r.status === 200 && r.body.data.status === "completed" && r.body.data.resumed === true
  && brevoWrites().length === writesBefore && authCalls.filter((c) => c.fn === "updateUserById").length === updBefore && (await ops(cAlice)).length === 1, r.body);
r = await change(cAlice, "alice.nouvelle@test.ch");
check("Déjà l'adresse du client : refusé", r.status === 400 && /déjà l'adresse/.test(r.body.error), r.body);

// ═══ 2. Client avec compte, désinscrit (hors liste) et désinscrit de tout (bloqué) ═══
const bob = await addAuthUser("bob@test.ch", { first_name: "Bob" });
const cBob = await custOfProfile(bob.id);
brevoContact("bob@test.ch", [], false);
r = await change(cBob, "bob2@test.ch");
check("Désinscrit : contact renommé, TOUJOURS hors de la liste (jamais inscrit)", r.status === 200 && JSON.stringify(brevo.get("bob2@test.ch")?.listIds) === "[]"
  && /hors de la liste newsletter/.test(r.body.data.steps.brevo_message), r.body);
const zoe = await addAuthUser("zoe@test.ch", { first_name: "Zoé" });
const cZoe = await custOfProfile(zoe.id);
brevoContact("zoe@test.ch", [7], true);
r = await change(cZoe, "zoe2@test.ch");
check("Désinscription globale (blacklist) conservée", r.status === 200 && brevo.get("zoe2@test.ch")?.emailBlacklisted === true && /bloqué/.test(r.body.data.steps.brevo_message), r.body);
check("Brevo : jamais de création (POST) ni de suppression", brevoCalls.every((c) => c.method === "GET" || c.method === "PUT"));

// ═══ 3. Client SANS compte, sans contact Brevo ══════════════════════════
const cCarla = (await one(`insert into public.customers (first_name, last_name, email, source, created_by) values ('Carla','Rossi','carla@test.ch','admin','test') returning id`)).id;
const usersBefore = (await one("select count(*)::int n from auth.users")).n;
r = await preview(cCarla, "carla.r@test.ch");
check("Aperçu sans compte : « pas de compte »", r.body.data.hasAccount === false && r.body.data.loginEmail === null);
r = await change(cCarla, "carla.r@test.ch");
check("Sans compte : fiche mise à jour, compte « rien à faire », Brevo « rien à faire »", r.status === 200 && r.body.data.status === "completed"
  && r.body.data.steps.auth === "not_needed" && r.body.data.steps.brevo === "not_needed" && (await cust(cCarla)).email === "carla.r@test.ch", r.body);
check("Sans compte : AUCUN compte créé, aucune invitation", (await one("select count(*)::int n from auth.users")).n === usersBefore && (await cust(cCarla)).profile_id === null
  && !authCalls.some((c) => c.fn === "inviteUserByEmail"));
check("Sans contact Brevo : aucun contact créé", !brevo.has("carla.r@test.ch"));
// sans compte, inscrite à la newsletter (contact Brevo existant) → renommé
const cDina = (await one(`insert into public.customers (first_name, email, source, created_by) values ('Dina','dina@test.ch','admin','test') returning id`)).id;
brevoContact("dina@test.ch", [7]);
r = await change(cDina, "dina.b@test.ch");
check("Sans compte mais inscrite : contact Brevo renommé, toujours inscrite", r.status === 200 && JSON.stringify(brevo.get("dina.b@test.ch")?.listIds) === "[7]" && !brevo.has("dina@test.ch"), r.body);

// ═══ 4. Email de contact ≠ email de connexion ═══════════════════════════
const eva = await addAuthUser("eva.login@test.ch", { first_name: "Eva" });
const cEva = await custOfProfile(eva.id);
await q("update public.customers set email='eva.contact@test.ch' where id=$1", [cEva]);
brevoContact("eva.login@test.ch", [7]);
r = await preview(cEva, "eva@test.ch");
check("Aperçu : les deux adresses différentes sont renvoyées", r.body.data.contactEmail === "eva.contact@test.ch" && r.body.data.loginEmail === "eva.login@test.ch"
  && r.body.data.brevoOld.length === 2, r.body.data);
r = await change(cEva, "eva@test.ch");
check("Contact ≠ connexion : les deux remplacés, le contact Brevo (sous l'email de connexion) renommé", r.status === 200 && authUsers.get(eva.id).email === "eva@test.ch"
  && (await cust(cEva)).email === "eva@test.ch" && brevo.has("eva@test.ch") && !brevo.has("eva.login@test.ch"), r.body);
ev = (await get(cEva)).events.find((e) => e.kind === "email_change");
check("Historique : les deux anciennes adresses notées", ev.detail.from_contact === "eva.contact@test.ch" && ev.detail.from_login === "eva.login@test.ch");

// ═══ 5. Conflits : rien n'est modifié, aucune fusion ════════════════════
const fred = await addAuthUser("fred@test.ch", { first_name: "Fred" });
const cFred = await custOfProfile(fred.id);
brevoContact("fred@test.ch", [7]);
const snapshot = async () => JSON.stringify({ c: await cust(cFred), a: authUsers.get(fred.id).email, p: (await one("select email from public.profiles where id=$1", [fred.id])).email,
  b: [...brevo.keys()].sort(), ops: (await ops(cFred)).length, cust: (await one("select count(*)::int n from public.customers where merged_into is null")).n });
const s0 = await snapshot();
const w0 = brevoWrites().length;
r = await change(cFred, "carla.r@test.ch");
check("Adresse d'une autre fiche : bloqué, aucune fusion, rien modifié", r.status === 409 && /autre fiche/.test(r.body.error) && /Aucune fusion/.test(r.body.error) && (await snapshot()) === s0, r.body);
r = await preview(cFred, "carla.r@test.ch");
check("Aperçu : conflit de fiche signalé", !!r.body.data.conflicts.otherCustomer);
const gus = await addAuthUser("gus@test.ch");
await q("update public.customers set email='gus.contact@test.ch' where profile_id=$1", [gus.id]);   // fiche de Gus sous une autre adresse : seul le COMPTE porte gus@test.ch
const s1 = await snapshot();
r = await change(cFred, "gus@test.ch");
check("Adresse d'un autre compte : bloqué, rien modifié", r.status === 409 && /autre compte/.test(r.body.error) && (await snapshot()) === s1, r.body);
brevoContact("fred.b@test.ch", [7]);
r = await change(cFred, "fred.b@test.ch");
check("Contact Brevo déjà existant sous la nouvelle adresse : bloqué, rien modifié", r.status === 409 && /contact Brevo existe déjà/.test(r.body.error) && (await snapshot()) !== "" && (await ops(cFred)).length === 0
  && authUsers.get(fred.id).email === "fred@test.ch", r.body);
brevo.delete("fred.b@test.ch");
await q("update public.customers set email='fred.contact@test.ch' where id=$1", [cFred]);
brevoContact("fred.contact@test.ch", [7]);
r = await change(cFred, "fred.c@test.ch");
check("Deux contacts Brevo pour le client : bloqué, rien modifié", r.status === 409 && /Deux contacts Brevo/.test(r.body.error) && (await ops(cFred)).length === 0 && authUsers.get(fred.id).email === "fred@test.ch", r.body);
brevo.delete("fred.contact@test.ch");
brevoDown = true;
r = await change(cFred, "fred.c@test.ch");
check("Brevo indisponible au départ : bloqué, rien modifié", r.status === 409 && /Brevo ne répond pas/.test(r.body.error) && (await ops(cFred)).length === 0 && authUsers.get(fred.id).email === "fred@test.ch", r.body);
brevoDown = false;
check("Conflits : aucune écriture Brevo", brevoWrites().length === w0);
r = await change(cFred, "pas-une-adresse");
check("Adresse invalide : refusée", r.status === 400);

// ═══ 6. Double clic (deux demandes simultanées, même clé) ═══════════════
const hana = await addAuthUser("hana@test.ch");
const cHana = await custOfProfile(hana.id);
brevoContact("hana@test.ch", [7]);
const kk = key();
const body = { action: "email_change", customerId: cHana, email: "hana2@test.ch", idempotencyKey: kk, identityChecked: true, pin: PIN };
const [r1, r2] = await Promise.all([call(body), call(body)]);
const okOne = [r1, r2].filter((x) => x.status === 200).length;
check("Double clic : une seule exécution (l'autre « déjà en cours » ou même résultat)", okOne >= 1 && [r1, r2].every((x) => x.status === 200 || x.body.reason === "busy"), [r1.body, r2.body]);
check("Double clic : une seule opération, un seul changement Auth, un seul renommage Brevo", (await ops(cHana)).length === 1
  && authCalls.filter((c) => c.fn === "updateUserById" && c.id === hana.id).length === 1 && brevoWrites().filter((c) => c.id === "hana@test.ch").length === 1
  && (await get(cHana)).events.filter((e) => e.kind === "email_change").length === 1);
// deux clics avec deux clés différentes, même adresse (deux onglets) → reprise de la même opération
const ivy = await addAuthUser("ivy@test.ch");
const cIvy = await custOfProfile(ivy.id);
const [r3, r4] = await Promise.all([change(cIvy, "ivy2@test.ch"), change(cIvy, "ivy2@test.ch")]);
check("Deux onglets : une seule opération, pas de doublon", (await ops(cIvy)).length === 1 && [r3, r4].some((x) => x.status === 200)
  && authCalls.filter((c) => c.fn === "updateUserById" && c.id === ivy.id).length === 1, [r3.body, r4.body]);

// ═══ 7. Échec partiel : Brevo refuse le renommage ═══════════════════════
const jon = await addAuthUser("jon@test.ch");
const cJon = await custOfProfile(jon.id);
brevoContact("jon@test.ch", [7]);
brevoPutFail = 1;
const kj = key();
r = await call({ action: "email_change", customerId: cJon, email: "jon2@test.ch", idempotencyKey: kj, identityChecked: true, pin: PIN });
check("Brevo en échec : PAS de réussite complète", r.status === 409 && r.body.success === false && r.body.reason === "partial" && r.body.data.status === "partial", r.body);
check("Échec partiel : ce qui est fait et ce qui reste à faire, précisément", r.body.data.steps.auth === "ok" && r.body.data.steps.db === "ok" && r.body.data.steps.brevo === "error"
  && /Mis à jour : email de connexion \(compte\), email de contact \(fiche\) et profil du compte/.test(r.body.data.message) && /Reste à faire : contact Brevo/.test(r.body.data.message), r.body.data);
check("Échec partiel : fiche et compte à jour, contact Brevo encore sous l'ancienne adresse", (await cust(cJon)).email === "jon2@test.ch" && authUsers.get(jon.id).email === "jon2@test.ch" && brevo.has("jon@test.ch"));
d = await get(cJon);
check("Échec partiel journalisé (statut « partial », étape Brevo en échec)", d.events.find((e) => e.kind === "email_change").detail.status === "partial"
  && d.events.find((e) => e.kind === "email_change").detail.steps.brevo === "error");
r = await preview(cJon);
check("Aperçu : opération non terminée proposée à la reprise (avec sa clé)", r.body.data.latest?.status === "partial" && r.body.data.latest.key === kj);
r = await change(cJon, "jon3@test.ch");
check("Opération non terminée : une AUTRE adresse est refusée", r.status === 409 && /n'est pas terminée/.test(r.body.error) && (await cust(cJon)).email === "jon2@test.ch", r.body);
const updJon = authCalls.filter((c) => c.fn === "updateUserById" && c.id === jon.id).length;
r = await call({ action: "email_change", customerId: cJon, email: "jon2@test.ch", idempotencyKey: kj, identityChecked: true, pin: PIN });
check("Reprise : terminée, sans refaire le compte ni la fiche", r.status === 200 && r.body.data.status === "completed" && authCalls.filter((c) => c.fn === "updateUserById" && c.id === jon.id).length === updJon
  && brevo.has("jon2@test.ch") && !brevo.has("jon@test.ch") && (await ops(cJon)).length === 1, r.body);
d = await get(cJon);
check("Historique : la tentative en échec ET la reprise réussie sont gardées", d.events.filter((e) => e.kind === "email_change").map((e) => e.detail.status).join(",") === "completed,partial");

// Brevo tombe APRÈS les vérifications (pendant l'étape Brevo) : partiel, puis reprise
const kim = await addAuthUser("kim@test.ch");
const cKim = await custOfProfile(kim.id);
brevoContact("kim@test.ch", [7]);
const origFetch = globalThis.fetch;
let getCount = 0;
globalThis.fetch = async (url, init = {}) => { if ((init.method ?? "GET") === "GET" && ++getCount > 2) return new Response("{}", { status: 503 }); return origFetch(url, init); };
r = await change(cKim, "kim2@test.ch");
globalThis.fetch = origFetch;
check("Brevo indisponible pendant l'étape : partiel, message « Brevo ne répond pas »", r.status === 409 && r.body.data.status === "partial" && /Brevo ne répond pas/.test(r.body.data.steps.brevo_message), r.body);
r = await change(cKim, "kim2@test.ch");   // nouvelle clé, même adresse → reprise de la même opération
check("Reprise par la même adresse (nouvelle clé) : terminée, une seule opération", r.status === 200 && r.body.data.status === "completed" && (await ops(cKim)).length === 1 && brevo.has("kim2@test.ch"), r.body);

// ═══ 8. Échec du compte (Auth) : rien n'est modifié ═════════════════════
const leo = await addAuthUser("leo@test.ch");
const cLeo = await custOfProfile(leo.id);
brevoContact("leo@test.ch", [7]);
authFail = { message: "Database error updating user" };
r = await change(cLeo, "leo2@test.ch");
check("Auth en échec : « rien n'a été modifié », fiche et Brevo intacts", r.status === 409 && r.body.data.status === "blocked" && /Rien n'a été modifié/.test(r.body.data.message)
  && (await cust(cLeo)).email === "leo@test.ch" && brevo.has("leo@test.ch") && authUsers.get(leo.id).email === "leo@test.ch", r.body);
r = await change(cLeo, "leo2@test.ch");
check("Nouvel essai après échec Auth : réussi", r.status === 200 && r.body.data.status === "completed" && (await cust(cLeo)).email === "leo2@test.ch");

// Échec de la base (autre fiche créée entre-temps avec la nouvelle adresse) : partiel, précis
const mia = await addAuthUser("mia@test.ch");
const cMia = await custOfProfile(mia.id);
const realRpc = globalThis.__rpc;
globalThis.__rpc = async (fn, args) => {
  if (fn === "customer_email_change_apply_db") await q(`insert into public.customers (first_name, email, source, created_by) values ('Intrus','mia2@test.ch','admin','test')`);
  return realRpc(fn, args);
};
r = await change(cMia, "mia2@test.ch");
globalThis.__rpc = realRpc;
check("Fiche concurrente créée entre-temps : partiel (compte fait, fiche non), aucune fusion", r.status === 409 && r.body.data.status === "partial" && r.body.data.steps.auth === "ok" && r.body.data.steps.db === "error"
  && /autre fiche/.test(r.body.data.steps.db_message) && (await cust(cMia)).email === "mia@test.ch", r.body);

// ═══ 9. Champ email ordinaire et ancien changement isolé ═════════════════
r = await call({ action: "save", customerId: cFred, firstName: "Fred", email: "autre@test.ch", pin: PIN });
check("« Enregistrer » avec un email changé : refusé, orienté vers « Modifier l'adresse email »", r.status === 409 && r.body.reason === "use_email_change" && /Modifier l'adresse email/.test(r.body.error));
r = await call({ action: "save", customerId: cFred, firstName: "Frédéric", email: "fred.contact@test.ch", pin: PIN });
check("« Enregistrer » sans changer l'email : OK", r.status === 200 && (await one("select first_name from public.customers where id=$1", [cFred])).first_name === "Frédéric", r.body);
const cNoMail = (await one(`insert into public.customers (first_name, phone, source, created_by) values ('Nora','079 000 00 00','admin','test') returning id`)).id;
r = await call({ action: "save", customerId: cNoMail, firstName: "Nora", email: "nora@test.ch", phone: "079 000 00 00", pin: PIN });
check("Fiche sans email ni compte : premier email ajouté par « Enregistrer »", r.status === 200 && (await cust(cNoMail)).email === "nora@test.ch", r.body);
r = await call({ action: "login_email_change", customerId: cFred, email: "fred.z@test.ch", pin: PIN });
check("Ancien « changer l'email de connexion » seul : refusé", r.status === 409 && r.body.reason === "use_email_change" && authUsers.get(fred.id).email === "fred@test.ch");

// ═══ 10. Eli, fiche fusionnée, clé réutilisée ═══════════════════════════
const ola = await addAuthUser("ola@test.ch");
const cOla = await custOfProfile(ola.id);
r = await call({ action: "email_change", customerId: cOla, email: "ola2@test.ch", idempotencyKey: key(), identityChecked: true, pin: PIN }, "eli-jwt");
check("Eli peut faire la modification ; auteur = Eli", r.status === 200 && (await ops(cOla))[0].created_by === "e.potapushina@gmail.com", r.body);
const kOla = (await ops(cOla))[0].idempotency_key;
r = await call({ action: "email_change", customerId: cOla, email: "ola3@test.ch", idempotencyKey: kOla, identityChecked: true, pin: PIN });
check("Clé déjà utilisée pour une autre adresse : refusée", r.status === 409 && (await cust(cOla)).email === "ola2@test.ch", r.body);
await q("update public.customers set merged_into=$2 where id=$1", [cCarla, cDina]);
r = await change(cCarla, "carla.z@test.ch");
check("Fiche fusionnée : refusé", r.status === 404);

// ═══ 11. Relance de F21 ═════════════════════════════════════════════════
const snapOps = JSON.stringify(await q("select id, status, steps from public.customer_email_changes order by id"));
await db.exec(fs.readFileSync(F21, "utf8"));
check("Relance de F21 : sans erreur, rien ne change", JSON.stringify(await q("select id, status, steps from public.customer_email_changes order by id")) === snapOps);
check("Table des opérations fermée aux clients (anon / authenticated)", (await one("select has_table_privilege('anon','public.customer_email_changes','select') a, has_table_privilege('authenticated','public.customer_email_changes','select') b")).a === false
  && (await one("select has_function_privilege('authenticated','public.customer_email_change_begin(uuid,text,text,boolean,text,text)','execute') x")).x === false);
check("Aucun e-mail envoyé pendant tout le test", sentCount() === 0);

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
