// Compta, lot K4 — migration F13 (décompte Mel / Eli) + vraie fonction
// manage-expenses + module de calcul _shared/settlement.ts + vrai export
// Excel du site. Base locale PGlite = schéma de production + F1–F13.
// Ne se connecte jamais à Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_compta_k4.mjs
import { freshDb } from "./load.mjs";
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

process.on("unhandledRejection", (e) => { console.log("ERROR:", e?.message, e?.where ?? ""); process.exit(2); });

const ROOT = path.resolve(import.meta.dirname, "../..");
const REPO = path.resolve(ROOT, "..");
const MIG = path.join(ROOT, "migrations");
const migrations = fs.readdirSync(MIG).filter((f) => /^(20261002(09|10|11|12|13|14|16|17|18)|20261004)/.test(f)).sort().map((f) => path.join(MIG, f));
const F13 = migrations.find((f) => f.includes("_f13_"));

let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra) : ""); } };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

const db = await freshDb({ migrations });
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

// ── Vraies fonctions (esbuild) ───────────────────────────────────────────
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x", ADMIN_ORDER_PIN: "1234" })[k] } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "k4-"));
globalThis.__storage = [];
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), `export function createClient() { return {
  auth: { getUser: async (j) => ({ data: { user: j === "admin-jwt" ? { email: "naglemelodie@gmail.com" } : j === "client-jwt" ? { email: "x@y.ch" } : null }, error: null }) },
  rpc: (fn, args) => globalThis.__rpc(fn, args),
  storage: { from: (bucket) => ({
    createSignedUploadUrl: async (p) => { globalThis.__storage.push({ op: "upload", bucket, path: p }); return { data: { token: "tok", path: p }, error: null }; },
    createSignedUrl: async (p, s) => { globalThis.__storage.push({ op: "sign", bucket, path: p, seconds: s }); return { data: { signedUrl: "https://signed.test/" + bucket + "/" + p + "?exp=" + s }, error: null }; },
  }) } }; }`);
const plugins = [{ name: "m", setup(b) {
  b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
  b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
} }];
globalThis.__rpc = async (fn, args) => {
  const ks = Object.keys(args ?? {});
  try {
    const res = await db.query(`select * from public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(", ")})`, ks.map((k) => args[k]));
    const cols = res.fields.map((f) => f.name);
    return { data: cols.length === 1 && cols[0] === fn ? (res.rows[0]?.[fn] ?? null) : res.rows, error: null };
  } catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
};
const handlers = {};
for (const name of ["manage-expenses", "finance-month"]) {
  await build({ entryPoints: [path.join(ROOT, `functions/${name}/index.ts`)], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, `${name}.mjs`), logLevel: "warning", plugins });
  await import(path.join(tmp, `${name}.mjs`));
  handlers[name] = globalThis.__handler;
}
const invoke = async (name, body, jwt = "admin-jwt") => {
  const r = await handlers[name](new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
};
const call = (body, jwt) => invoke("manage-expenses", body, jwt);

// ── Export Excel / ZIP : vrai code du site, assemblé pour Node ───────────
fs.writeFileSync(path.join(tmp, "client.mjs"), "export const supabase = {};");
await build({
  entryPoints: [path.join(REPO, "src/lib/comptaExport.ts")], bundle: true, format: "esm", platform: "node",
  outfile: path.join(tmp, "cx.mjs"), logLevel: "warning", external: ["exceljs"],
  loader: { ".png": "empty", ".jpg": "empty", ".jpeg": "empty", ".webp": "empty", ".svg": "empty", ".gif": "empty" },
  nodePaths: [path.join(REPO, "node_modules")],
  plugins: [{ name: "alias", setup(b) {
    b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: path.join(tmp, "client.mjs") }));
    b.onResolve({ filter: /^@\// }, async (a) => {
      const base = path.join(REPO, "src", a.path.slice(2));
      for (const ext of ["", ".ts", ".tsx", "/index.ts"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return { path: base + ext };
      return { path: base };
    });
  } }],
});
const CX = await import(path.join(tmp, "cx.mjs"));
const ExcelJS = (await import(path.join(REPO, "node_modules/exceljs/excel.js"))).default;
const JSZip = (await import(path.join(REPO, "node_modules/jszip/lib/index.js"))).default;

// ── Calcul pur (module partagé) ──────────────────────────────────────────
await build({ entryPoints: [path.join(ROOT, "functions/_shared/settlement.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "st.mjs"), logLevel: "warning" });
const ST = await import(path.join(tmp, "st.mjs"));

// ── Données ─────────────────────────────────────────────────────────────
const settings = (await call({ action: "settings" })).body.data;
const cat = (name) => settings.categories.find((c) => c.name === name).id;
const payer = (slug) => settings.payers.find((p) => p.slug === slug).id;
const MEL = payer("mel"), ELI = payer("elie"), BENTO = payer("bento");
let keyN = 0;
const saveExpense = (fields) => call({ action: "save", idempotencyKey: `e-${++keyN}`, status: "paid", receiptMissingReason: "test", categoryId: cat("Matériel"), currency: "CHF", payerId: BENTO, ...fields });
let orderN = 0, orderCalls = 0;
async function revenue(amount, paidAt) {
  const before = (await one("select count(*)::int n from net._calls")).n;
  await revenueInsert(amount, paidAt);
  orderCalls += (await one("select count(*)::int n from net._calls")).n - before;
}
async function revenueInsert(amount, paidAt) {
  const c = (await one("select gen_random_uuid() id")).id;
  await q("insert into auth.users (id, email) values ($1, $2)", [c, `c${++orderN}@t.ch`]);
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, paid_at, order_validation, customer_id, order_source,
      physical_validation, pickup_delivery_date)
    values ('fr','Claire','Dupont','c@t.ch','000',$1,'paid',$2,'approved',$3,'website','approved',($2::timestamptz at time zone 'Europe/Zurich')::date) returning id`, [amount, paidAt, c]);
  await q("update public.orders set order_number=$2 where id=$1", [o.id, `ORD-K4-${orderN}`]);
  await q("insert into public.order_items (order_id, product, total, size) values ($1,'bento_cake',$2,'10cm')", [o.id, amount]);
}
const sal = async () => (await call({ action: "salary_overview", month: "2026-10" })).body.data.members[0];
const salMonth = async (m) => (await sal()).months.find((x) => x.salary_month === `${m}-01`);
async function paySalary(m, net, paidAt) {
  const sm = await salMonth(m);
  await call({ action: "salary_confirm", id: sm.id, net: String(net) });
  await call({ action: "salary_add_payment", idempotencyKey: `sal-${m}`, monthId: sm.id, paidAt, amount: String(net) });
}
const get = async (m, extra = {}) => (await call({ action: "settlement_get", month: m, ...extra })).body.data;
const PIN = "1234"; // ADMIN_ORDER_PIN du banc de test
const validate = (m, extra = {}) => call({ action: "settlement_validate", pin: PIN, month: m, ...extra });
// Le scénario se déroule dans le futur (oct. 2026 → mai 2027) : la saisie d'un solde futur
// est refusée par bank_balance_save (testé plus bas), on insère donc ces soldes directement.
const balance = (d, amount) => q("insert into public.bank_balances (balance_date, amount, created_by) values ($1, $2, 'test')", [d, amount]);
let r, g;

// ═══ Accès ═══
check("Accès : sans connexion → 401", (await call({ action: "settlement_get", month: "2026-10" }, null)).status === 401);
check("Accès : non admin → 401", (await call({ action: "settlement_validate", month: "2026-10" }, "client-jwt")).status === 401);
check("Tables fermées à anon / authenticated", (await one("select count(*)::int n from information_schema.role_table_grants where table_schema='public' and (table_name like 'settlement%' or table_name = 'bank_balances') and grantee in ('anon','authenticated')")).n === 0);
const rules = await one("select * from public.settlement_rules");
check("Règles confirmées : dès 10.2026, base 4'000, +300/mois, Mel 60 %", rules.effective_month.toISOString().slice(0, 10) === "2026-10-01" && Number(rules.base_target) === 4000 && Number(rules.monthly_extra) === 300 && Number(rules.mel_pct) === 60 && rules.mel_payer_id === MEL && rules.eli_payer_id === ELI);

// ═══ PIN admin (K4) : contrôlé par le serveur ═══
const pinCases = [
  ["settlement_validate", { month: "2026-10" }],
  ["settlement_payout", { settlementId: "00000000-0000-0000-0000-000000000000", payerId: MEL, paidAt: "2026-11-01", share: "1" }],
  ["settlement_void_payout", { id: "00000000-0000-0000-0000-000000000000", reason: "x" }],
  ["settlement_adjust", { sourceMonth: "2026-10", amount: "-1", reason: "x" }],
  ["settlement_void_adjustment", { id: "00000000-0000-0000-0000-000000000000", reason: "x" }],
];
for (const [action, body] of pinCases) {
  const none = await call({ action, ...body });
  const wrong = await call({ action, ...body, pin: "0000" });
  check(`${action} : PIN absent → 403, PIN incorrect → 403`, none.status === 403 && none.body.reason === "pin" && wrong.status === 403 && wrong.body.reason === "pin", [none.status, wrong.status]);
}
check("Lecture et soldes sans PIN (session admin)", (await call({ action: "settlement_get", month: "2026-10" })).status === 200);
check("Aucune écriture faite par les tentatives sans PIN", (await one("select (select count(*) from public.settlements) + (select count(*) from public.settlement_payouts) + (select count(*) from public.settlement_adjustments) n")).n === 0);

// ═══ Septembre : avant le début ═══
g = await get("2026-09");
check("Septembre 2026 : aucun décompte (avant le début des règles)", g.draft.blocked && /octobre 2026/.test(g.draft.blockText));

// ═══ Octobre : blocages, puis résultat 1'500 conservé ═══
await revenue(3200, "2026-10-10T10:00:00Z");
g = await get("2026-10");
check("Octobre bloqué tant que le salaire net est « à saisir »", g.draft.blocked && /Salaire net à confirmer/.test(g.draft.blockText));
r = await saveExpense({ purchaseDate: "2026-10-12", supplier: "Amazon", currency: "EUR", originalAmount: "40", chfAmount: "", paidAt: "2026-10-12" });
const eurId = r.body.data.id;
await paySalary("2026-10", 1700, "2026-10-25");
g = await get("2026-10");
check("Octobre bloqué tant qu'un montant CHF est inconnu", g.draft.blocked && /Montant CHF à saisir/.test(g.draft.blockText));
r = await validate("2026-10");
check("Validation refusée si bloqué", r.status === 409 && r.body.reason === "blocked");
await call({ action: "delete", id: eurId, reason: "test" });
// Avance de Mel remboursée en octobre, AVANT la base (autorisé, hors partage).
r = await saveExpense({ purchaseDate: "2026-10-05", supplier: "Manor", originalAmount: "250", paidAt: "2026-10-05", payerId: MEL, personalAdvance: true });
const melAdv = r.body.data.id;
await revenue(250, "2026-10-11T10:00:00Z");
r = await call({ action: "advance_repay", idempotencyKey: "adv-oct", payerId: MEL, paidAt: "2026-10-20", allocations: [{ expenseId: melAdv, amount: "250" }] });
check("Avance de Mel remboursée avant la constitution de la base (registre K3)", r.status === 200);
g = await get("2026-10");
check("Octobre : résultat = 3'450 − 250 (avance comptée une fois) − 1'700 = 1'500 ; remboursement d'avance non déduit", !g.draft.blocked && g.draft.result === 1500 && g.draft.expenses === 250 && g.draft.salary === 1700, g.draft);
check("Octobre : tout est conservé (base pas encore atteinte), rien à partager, aucun solde exigé", g.draft.retainedMonth === 1500 && g.draft.toShare === 0 && !g.draft.needsBankBalance);
r = await validate("2026-10");
check("Octobre validé avec le bon PIN, sans solde bancaire (aucun partage)", r.status === 200, r.body);
r = await validate("2026-10");
check("Valider deux fois → refus", r.status === 409);
check("Décompte validé figé (modification directe refusée)", await db.query("update public.settlements set result = 0").then(() => false, (e) => /figé/.test(e.message)));

// ═══ Correction après validation : ajustement explicite ═══
await saveExpense({ purchaseDate: "2026-10-15", supplier: "Oubli", originalAmount: "100", paidAt: "2026-10-15" });
g = await get("2026-11");
check("Dépense d'octobre ajoutée après validation : écart de −100 détecté, octobre inchangé", g.detectedDeltas.length === 1 && Number(g.detectedDeltas[0].delta) === -100 && Number(g.history[0].result) === 1500);
check("… rien n'est appliqué tant que l'ajustement n'est pas créé", g.adjustments.length === 0);
r = await call({ action: "settlement_adjust", pin: PIN, sourceMonth: "2026-10", amount: "-100", reason: "" });
check("Ajustement sans raison → refus", r.status === 409);
r = await call({ action: "settlement_adjust", pin: PIN, sourceMonth: "2026-10", amount: "-100", reason: "Facture Oubli du 15.10 saisie après validation" });
g = await get("2026-11");
check("Ajustement créé : plus d'écart détecté, en attente pour novembre", r.status === 200 && g.detectedDeltas.length === 0 && g.adjustments.length === 1);
r = await call({ action: "settlement_adjust", pin: PIN, sourceMonth: "2026-10", amount: "-5", reason: "Erreur de saisie" });
const extraAdj = r.body.data.id;
r = await call({ action: "settlement_void_adjustment", id: extraAdj, reason: "doublon", pin: "0000" });
check("Annuler un ajustement avec un PIN incorrect → 403, rien ne change", r.status === 403 && (await get("2026-11")).adjustments.length === 2);
r = await call({ action: "settlement_void_adjustment", id: extraAdj, reason: "doublon", pin: PIN });
check("Annuler un ajustement avec le bon PIN → accepté", r.status === 200 && (await get("2026-11")).adjustments.length === 1);

// ═══ Novembre : 1'800 − 100 d'ajustement ═══
await revenue(3500, "2026-11-10T10:00:00Z");
await paySalary("2026-11", 1700, "2026-11-25");
r = await validate("2026-12");
check("Valider décembre avant novembre → refus", r.status === 409, r.body);
g = await get("2026-11");
check("Novembre : résultat 1'800, ajustement −100, conservé 1'700, cumul 3'200", g.draft.result === 1800 && g.draft.adjustmentsTotal === -100 && g.draft.retainedMonth === 1700 && g.draft.retainedCum === 3200, g.draft);
r = await validate("2026-11");
g = await get("2026-12");
check("Novembre validé : l'ajustement est appliqué une seule fois", r.status === 200 && g.adjustments.length === 0 && g.detectedDeltas.length === 0 && (await one("select count(*)::int n from public.settlement_adjustments where applied_settlement_id is not null")).n === 1);

// ═══ Décembre : la base comptable est atteinte, mais la banque ne la prouve pas ═══
await revenue(3700, "2026-12-10T10:00:00Z");
await paySalary("2026-12", 1700, "2026-12-23");
g = await get("2026-12");
check("Décembre sans solde : base non confirmable, tout conservé", g.draft.result === 2000 && !g.draft.baseConstituted && g.draft.retainedMonth === 2000 && g.draft.toShare === 0 && /Solde bancaire au 31.12.2026 manquant/.test(g.draft.warnings.join(" ")));
await balance("2026-12-15", 9000);
g = await get("2026-12");
check("Un solde du 15.12 ne vaut pas solde de fin de mois", g.bankBalance === null && !g.draft.baseConstituted);
await balance("2026-12-31", 3800);
g = await get("2026-12");
check("Solde au 31.12 : disponible 3'800 < 4'000 → base non constituée (il manque 200), tout conservé", g.treasury.available === 3800 && !g.draft.baseConstituted && g.draft.baseMissingInBank === 200 && g.draft.retainedMonth === 2000 && g.draft.toShare === 0, g.draft);
r = await validate("2026-12");
check("Décembre validé : bénéfice conservé cumulé 5'200, base non constituée, épargne suppl. 0", r.status === 200 && Number((await get("2027-01")).prev.retainedCum) === 5200 && (await get("2027-01")).prev.baseConstituted === false);

// ═══ Janvier : la banque confirme la base ; 300 dès ce mois ; partage 60/40 ═══
await revenue(1200, "2027-01-10T10:00:00Z");
g = await get("2027-01");
check("Janvier sans solde de fin de mois : base non confirmée, partage impossible", !g.draft.baseConstituted && g.draft.toShare === 0);
await balance("2027-01-31", 5400);
g = await get("2027-01");
check("Janvier : base constituée ce mois (solde 31.01 : 5'400), 4'000 non déduits une 2e fois",
  g.draft.baseConfirmedNow && g.draft.toBase === 0 && g.draft.extraKept === 300 && g.draft.toShare === 900 && g.draft.melShare === 540 && g.draft.eliShare === 360, g.draft);
check("Bénéfice conservé (5'500) ≠ base (4'000) + épargne (300) ; bénéfice libre 1'200", g.draft.retainedCum === 5500 && g.draft.extraCum === 300 && g.draft.freeRetained === 1200);
check("Trésorerie : 5'400 − 4'000 − 300 = 1'100 disponibles pour 900 → suffisant", g.draft.freeForShares === 1100 && !g.draft.flags.cashShort && !g.draft.flags.baseBreach);
g = await get("2027-01", { explicitKeep: "200" });
check("Conserver 200 de plus (choix explicite avant validation) : partage 700 → Mel 420 / Eli 280", g.draft.toShare === 700 && g.draft.melShare === 420 && g.draft.eliShare === 280 && g.draft.retainedMonth === 500);
g = await get("2027-01", { release: "300" });
check("Libérer du bénéfice conservé sans raison → bloqué", g.draft.blocked && /raison/.test(g.draft.blockText));
g = await get("2027-01", { release: "2000", releaseReason: "test" });
check("Libérer plus que le bénéfice libre (1'200) → bloqué (base et épargne préservées)", g.draft.blocked && /1200/.test(g.draft.blockText));
r = await validate("2027-01", { note: "Premier partage" });
const jan = (await get("2027-01")).validated;
check("Janvier validé : Mel 540.00 / Eli 360.00", r.status === 200 && Number(jan.mel_share) === 540 && Number(jan.eli_share) === 360 && jan.base_confirmed_now === true);

// ═══ Versements réels (aucun automatique) ═══
r = await call({ action: "settlement_payout", pin: PIN, idempotencyKey: "p1", settlementId: jan.id, payerId: MEL, paidAt: "2027-02-03", share: "540" });
check("Versement d'une part sans solde de vérification → refus", r.status === 400, r.body);
await balance("2027-01-20", 9999);
const balJan20 = (await one("select id from public.bank_balances where balance_date='2027-01-20'")).id;
r = await call({ action: "settlement_payout", pin: PIN, idempotencyKey: "p1", settlementId: jan.id, payerId: MEL, paidAt: "2027-02-03", share: "540", balanceId: balJan20 });
check("Solde antérieur à la fin du mois du décompte → refus (pas de mélange de dates)", r.status === 400, r.body);
await balance("2027-02-02", 5300);
const balFeb2 = (await one("select id from public.bank_balances where balance_date='2027-02-02'")).id;
const t = (await call({ action: "treasury_check", balanceId: balFeb2 })).body.data;
check("Vérification au 02.02 : solde 5'300 − parts non versées 900 = 4'400 disponibles (dettes du même jour)", t.sharesUnpaid === 900 && t.available === 4400, t);
r = await call({ action: "settlement_payout", pin: PIN, idempotencyKey: "p1", settlementId: jan.id, payerId: MEL, paidAt: "2027-02-03", share: "540", balanceId: balFeb2 });
check("Versement de 540 à Mel enregistré", r.status === 200 && r.body.data.code.startsWith("VERS-"), r.body);
r = await call({ action: "settlement_payout", pin: PIN, idempotencyKey: "p1", settlementId: jan.id, payerId: MEL, paidAt: "2027-02-03", share: "540", balanceId: balFeb2 });
check("Double clic : un seul versement", r.body.data.replayed === true);
r = await call({ action: "settlement_payout", pin: PIN, idempotencyKey: "p2", settlementId: jan.id, payerId: MEL, paidAt: "2027-02-04", share: "1", balanceId: balFeb2 });
check("Part déjà entièrement versée → refus", r.status === 409);
r = await call({ action: "settlement_payout", pin: PIN, idempotencyKey: "p3", settlementId: jan.id, payerId: ELI, paidAt: "2027-02-03", share: "200", balanceId: balFeb2 });
g = await get("2027-02");
const h = g.history.find((x) => x.month.startsWith("2027-01"));
check("Eli payée 200 sur 360 : reste à verser 160 (jamais transformé en épargne)", r.status === 200 && Number(h.eliPaid) === 200 && Number(h.melPaid) === 540 && Number(g.prev.retainedCum) === 5500);
check("Les versements ne sont jamais des dépenses", (await call({ action: "period", from: "2027-02-01", to: "2027-02-28" })).body.data.totals.engaged.known === 0);

// ═══ Février : perte reportée ═══
await saveExpense({ purchaseDate: "2027-02-10", supplier: "Four", originalAmount: "500", paidAt: "2027-02-10", investment: true });
g = await get("2027-02");
check("Février : −500 → perte reportée 500, rien conservé ni partagé, aucun solde exigé", g.draft.result === -500 && g.draft.lossOut === 500 && g.draft.retainedMonth === 0 && g.draft.toShare === 0 && !g.draft.needsBankBalance);
check("Investissement signalé (information), compté normalement, sans amortissement", g.figures.investments.length === 1 && g.draft.expenses === 500);
r = await validate("2027-02");
check("Février validé", r.status === 200, r.body);

// ═══ Mars : la perte est compensée une seule fois ═══
await revenue(1100, "2027-03-10T10:00:00Z");
await balance("2027-03-31", 5100);
g = await get("2027-03");
check("Mars : 1'100 − perte 500 = 600 ; 300 conservés ; 300 partagés (Mel 180 / Eli 120)", g.draft.lossCompensated === 500 && g.draft.lossOut === 0 && g.draft.available === 600 && g.draft.extraKept === 300 && g.draft.toShare === 300 && g.draft.melShare === 180 && g.draft.eliShare === 120, g.draft);
check("Trésorerie au 31.03 : 5'100 − part d'Eli non versée 160 = 4'940 ; libre 4'940 − 4'000 − 600 = 340 ≥ 300", g.treasury.sharesUnpaid === 160 && g.treasury.available === 4940 && g.draft.freeForShares === 340 && !g.draft.flags.cashShort);
r = await validate("2027-03");
g = await get("2027-04");
check("Mars validé ; avril démarre sans perte (jamais compensée deux fois)", r.status === 200 && Number(g.prev.lossOut) === 0 && Number(g.prev.extraCum) === 600);

// ═══ Avril : base entamée → à confirmer avant tout partage ═══
await revenue(1000, "2027-04-10T10:00:00Z");
await balance("2027-04-30", 3900);
g = await get("2027-04");
check("Avril : disponible 3'740 < 4'000 → base entamée signalée, partage bloqué sans confirmation", g.draft.flags.baseBreach && g.draft.toShare === 700 && g.draft.blocked && /entamée/.test(g.draft.blockText), g.draft);
g = await get("2027-04", { explicitKeep: "700" });
check("Conserver tout le surplus : plus de partage, plus de blocage", !g.draft.blocked && g.draft.toShare === 0);
g = await get("2027-04", { ackBaseBreach: true });
check("Avec confirmation de la base entamée, reste la trésorerie insuffisante à confirmer", g.draft.blocked && /insuffisante/.test(g.draft.blockText));
r = await validate("2027-04", { ackBaseBreach: true, ackCashShort: true });
const apr = (await get("2027-04")).validated;
check("Avril validé avec confirmations explicites (historisées)", r.status === 200 && apr.flags.ackBaseBreach === true && apr.flags.ackCashShort === true);
await balance("2027-05-02", 3000);
const balMay = (await one("select id from public.bank_balances where balance_date='2027-05-02'")).id;
r = await call({ action: "settlement_payout", pin: PIN, idempotencyKey: "p4", settlementId: apr.id, payerId: ELI, paidAt: "2027-05-03", share: "280", balanceId: balMay });
check("Versement avec trésorerie insuffisante → à confirmer (409)", r.status === 409 && r.body.reason === "cash_short");
r = await call({ action: "settlement_payout", pin: PIN, idempotencyKey: "p4", settlementId: apr.id, payerId: ELI, paidAt: "2027-05-03", share: "280", balanceId: balMay, ackCashShort: true });
check("… puis enregistré avec la vérification conservée", r.status === 200 && (await one("select check_snapshot from public.settlement_payouts where code=$1", [r.body.data.code])).check_snapshot.acknowledged === true);

// ═══ Versement groupé : part + avance ═══
r = await saveExpense({ purchaseDate: "2027-04-20", supplier: "Landi", originalAmount: "150", paidAt: "2027-04-20", payerId: MEL, personalAdvance: true });
const melAdv2 = r.body.data.id;
const engagedApr = (await call({ action: "period", from: "2027-04-01", to: "2027-04-30" })).body.data.totals.engaged.known;
r = await call({ action: "settlement_payout", pin: PIN, idempotencyKey: "p5", settlementId: apr.id, payerId: MEL, paidAt: "2027-05-03", share: "420", allocations: [{ expenseId: melAdv2, amount: "150" }], balanceId: balMay, ackCashShort: true });
const pay5 = r.body.data;
check("Versement groupé à Mel : part 420 + avance 150, deux composantes", r.status === 200 && Number(pay5.share) === 420 && Number(pay5.advance) === 150);
check("… la partie avance passe par le registre K3, jamais une dépense", (await one("select count(*)::int n from public.advance_repayment_allocations where expense_id=$1", [melAdv2])).n === 1 && (await call({ action: "period", from: "2027-04-01", to: "2027-04-30" })).body.data.totals.engaged.known === engagedApr);
r = await call({ action: "settlement_void_payout", pin: PIN, id: pay5.id, reason: "virement refusé" });
check("Annuler le versement groupé annule aussi la partie avance (tracé)", r.status === 200 && (await one("select voided_at is not null v from public.advance_repayments where id=(select advance_repayment_id from public.settlement_payouts where id=$1)", [pay5.id])).v);

// ═══ Soldes bancaires ═══
r = await call({ action: "bank_balance_delete", id: balFeb2 });
check("Un solde utilisé par un versement est conservé (suppression refusée)", r.status === 409);
r = await call({ action: "bank_balance_save", date: "2099-01-01", amount: "1" });
check("Solde daté dans le futur → refus", r.status === 409);
r = await call({ action: "bank_balance_save", date: "2026-09-30", amount: "1234.50" });
check("Solde passé saisi par la page", r.status === 200);

// ═══ Validation : les chiffres doivent être ceux du calcul ═══
check("Validation SQL avec un brouillon périmé → refus", await db.query("select public.settlement_validate('2027-05-01', $1::jsonb, 't')", [JSON.stringify({ draft: { blocked: false, revenueNet: 999, expenses: 0, salary: 0, toShare: 0, melShare: 0, eliShare: 0, released: 0, flags: {} }, prevId: (await get("2027-05")).prev.id, adjustmentIds: [] })]).then(() => false, (e) => /changé/.test(e.message)));

// ═══ Calculs purs : arrondi, libération ═══
const base = { month: "2027-06-01", monthEnd: "2027-06-30", startMonth: "2026-10-01", rules: { id: "r", base_target: 4000, monthly_extra: 300, mel_pct: 60, mel_payer_id: "m", eli_payer_id: "e" },
  melName: "Mel", eliName: "Eli", validated: null, prev: { id: "p", month: "2027-05-01", retainedCum: 5600, baseConstituted: true, extraCum: 600, lossOut: 0 }, prevMonthValidated: true,
  figures: { revenueNet: 633.35, collected: 633.35, refunded: 0, refundsUndatedCount: 0, refundsToReviewCount: 0, expensesKnown: 0, expensesCount: 0, expensesUnknown: [], expensesUndated: [], investments: [], salaryTotal: 0, salaryLines: [], salaryToConfirm: [] },
  adjustments: [], bankBalance: { id: "b", date: "2027-06-30", amount: 10000 }, treasury: { available: 10000, balance: 10000, invoicesToPay: 0, invoicesUnknownCount: 0, salaryRemaining: 0, advancesToRepay: 0, advancesUnknownCount: 0, sharesUnpaid: 0 } };
let d = ST.computeSettlement(base);
check("Arrondi : 333.35 à partager → Mel 200.01 (60 % au centime), Eli le reste exact 133.34", d.toShare === 333.35 && d.melShare === 200.01 && d.eliShare === 133.34 && d.melShare + d.eliShare === 333.35);
d = ST.computeSettlement({ ...base, figures: { ...base.figures, revenueNet: 250 } });
check("Surplus 250 < 300 : 250 conservés, aucune épargne fictive, rien à partager", d.extraKept === 250 && d.toShare === 0);
d = ST.computeSettlement(base, { release: 500, releaseReason: "Décision du 30.06 : distribuer une partie du bénéfice conservé" });
check("Libération explicite de 500 (bénéfice libre 1'000 = 5'600 − 4'000 − 600) : partagée en plus", d.freeRetained === 1000 && d.released === 500 && d.toShare === 833.35 && d.retainedMonth === -200 && !d.blocked);

// ═══ Excel ═══
const finance = (await invoke("finance-month", { month: "2027-01" })).body.data;
const salesJan = (await call({ action: "sales_month", month: "2027-01" })).body.data;
const periodJan = (await call({ action: "period", from: "2027-01-01", to: "2027-01-31" })).body.data;
const wb = CX.buildComptaWorkbook(ExcelJS, salesJan, finance, periodJan, (await call({ action: "salary_overview", month: "2027-01" })).body.data,
  (await call({ action: "advances_overview", month: "2027-01" })).body.data, await get("2027-01"));
const file = path.join(tmp, "k4.xlsx");
await wb.xlsx.writeFile(file);
const rb = new ExcelJS.Workbook(); await rb.xlsx.readFile(file);
check("Excel : 9 feuilles, « Décompte Mel-Eli et versements » en dernier (31 caractères max, « / » interdit)", rb.worksheets.length === 9 && rb.worksheets.at(-1).name === "Décompte Mel-Eli et versements", rb.worksheets.map((w) => w.name));
const W = rb.worksheets.at(-1);
const findRow = (ws, label) => { let row = null; ws.eachRow((y) => { if (String(y.getCell(1).value ?? "").startsWith(label)) row = y; }); return row; };
const val = (c) => (c.value && typeof c.value === "object" && "result" in c.value ? c.value.result : c.value);
check("Feuille décompte : résultat à partager 900, Mel 540, Eli 360 (Eli = reste en formule)", val(findRow(W, "Résultat à partager").getCell(2)) === 900 && val(findRow(W, "Mel").getCell(2)) === 540 && val(findRow(W, "Eli").getCell(2)) === 360 && String(findRow(W, "Eli").getCell(2).value.formula).includes("-"));
check("Feuille décompte : base, épargne supplémentaire et bénéfice conservé distincts", val(findRow(W, "Trésorerie de base").getCell(2)) === 4000 && val(findRow(W, "Épargne supplémentaire cumulée").getCell(2)) === 300 && val(findRow(W, "Bénéfice conservé cumulé").getCell(2)) === 5500);
check("Feuille décompte : versements avec reste à verser (Eli 160)", val(findRow(W, "Reste à verser — Eli").getCell(2)) === 160);
const S = rb.getWorksheet("Synthèse");
const stateTxt = String(findRow(S, "INCOMPLET")?.getCell(1).value ?? "");
check("Dossier INCOMPLET tant qu'il reste un manque réel (salaire de septembre à confirmer, avance d'avril saisie après validation)", /SAL-2026-09-NAHYA : net à confirmer/.test(stateTxt) && /ajustement à créer/.test(stateTxt), stateTxt);
check("Synthèse : parts du mois et statut du décompte", /validé/.test(String(findRow(S, "Décompte Mel / Eli").getCell(1).value)));

// ═══ Dossier COMPLET une fois tout réglé ═══
await call({ action: "salary_confirm", id: (await salMonth("2026-09")).id, net: "113.30" });
const dl = (await get("2027-05")).detectedDeltas;
await call({ action: "settlement_adjust", pin: PIN, sourceMonth: dl[0].month.slice(0, 7), amount: String(dl[0].delta), reason: "Avance Landi saisie après validation d'avril" });
const wb2 = CX.buildComptaWorkbook(ExcelJS, salesJan, finance, periodJan, (await call({ action: "salary_overview", month: "2027-01" })).body.data,
  (await call({ action: "advances_overview", month: "2027-01" })).body.data, await get("2027-01"));
let complete = null; wb2.getWorksheet("Synthèse").eachRow((y) => { if (String(y.getCell(1).value ?? "").startsWith("COMPLET")) complete = y; });
check("Plus aucun manque et décompte validé : dossier « COMPLET »", !!complete);

// ═══ Compatibilité, garde-fous ═══
check("Actions K1/K2/K3 toujours disponibles", (await call({ action: "settings" })).status === 200 && (await call({ action: "advances_overview", month: "2027-01" })).status === 200);
check("Aucun appel externe (Make, e-mail) par la compta (seuls les déclencheurs des commandes de test)", (await one("select count(*)::int n from net._calls")).n === orderCalls);
const before = await one("select (select count(*) from public.settlements) s, (select count(*) from public.settlement_rules) r, (select count(*) from public.settlement_payouts) p, (select count(*) from public.bank_balances) b");
await db.exec(fs.readFileSync(F13, "utf8"));
const after = await one("select (select count(*) from public.settlements) s, (select count(*) from public.settlement_rules) r, (select count(*) from public.settlement_payouts) p, (select count(*) from public.bank_balances) b");
check("Relance de F13 : rien n'est modifié", JSON.stringify(before) === JSON.stringify(after), { before, after });

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
