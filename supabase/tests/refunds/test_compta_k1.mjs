// Compta, lot K1 — migration F10 (dépenses, catégories, payeurs,
// justificatifs) + vraie fonction manage-expenses + vraie fonction
// finance-month (lot 3) + vrai export Excel / ZIP du site. Base locale
// PGlite = schéma de production + F1–F10. Ne se connecte jamais à Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_compta_k1.mjs
import { freshDb } from "./load.mjs";
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

process.on("unhandledRejection", (e) => { console.log("ERROR:", e?.message, e?.where ?? ""); process.exit(2); });

const ROOT = path.resolve(import.meta.dirname, "../..");
const REPO = path.resolve(ROOT, "..");
const MIG = path.join(ROOT, "migrations");
const migrations = fs.readdirSync(MIG).filter((f) => /^20261002(09|10|11|12|13|14)/.test(f)).sort().map((f) => path.join(MIG, f));
const F10 = migrations.find((f) => f.includes("_f10_"));

let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra) : ""); } };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

const db = await freshDb({ migrations });
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

// ── Vraies fonctions (esbuild) ───────────────────────────────────────────
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x", ADMIN_ORDER_PIN: "1234" })[k] } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "k1-"));
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

// ── Données ─────────────────────────────────────────────────────────────
const settings = (await call({ action: "settings" })).body.data;
const cat = (name) => settings.categories.find((c) => c.name === name).id;
const payer = (slug) => settings.payers.find((p) => p.slug === slug).id;
let keyN = 0;
const save = (fields) => call({ action: "save", idempotencyKey: `key-${++keyN}`, status: "paid", ...fields });
const period = async (from, to) => (await call({ action: "period", from, to })).body.data;
const OCT = ["2026-10-01", "2026-10-31"], SEP = ["2026-09-01", "2026-09-30"];
const byCode = (p, code) => p.expenses.find((e) => e.code === code);
const attach = async (expenseId, fileName = "ticket.jpg", mimeType = "image/jpeg") => {
  const u = await call({ action: "upload_url", expenseId, fileName, mimeType, size: 1000 });
  if (u.status !== 200) return u;
  return call({ action: "attach", expenseId, path: u.body.data.path, fileName, mimeType, size: 1000 });
};

// ═══ Accès ═══
check("Accès : sans connexion → 401", (await call({ action: "settings" }, null)).status === 401);
check("Accès : non admin → 401", (await call({ action: "settings" }, "client-jwt")).status === 401);
check("Tables fermées à anon / authenticated", (await one("select count(*)::int n from information_schema.role_table_grants where table_schema='public' and (table_name like 'expense%' or table_name like 'compta_%') and grantee in ('anon','authenticated')")).n === 0);
check("Catégories Notion + Salaires + Charges sociales (14)", settings.categories.length === 14 && settings.categories.some((c) => c.name === "Rémunération de mandataire") && settings.categories.filter((c) => c.kind === "payroll").map((c) => c.name).join() === "Salaires,Charges sociales");
check("Payeurs : compte Bento, Mel, Élie, Nahya, Autre", settings.payers.map((p) => p.name).join() === "Compte Bento,Mel,Élie,Nahya,Autre");

// ═══ Dépense Bento ═══
let r = await save({ purchaseDate: "2026-10-02", supplier: "Migros", description: "Farine, beurre", categoryId: cat("Courses de production"), currency: "CHF", originalAmount: "45.20", paidAt: "2026-10-02", payerId: payer("bento") });
const migros = r.body.data;
check("Dépense Bento enregistrée avec un code DEP-AAAA-NNNN", r.status === 200 && /^DEP-\d{4}-0001$/.test(migros.code), r.body);
r = await attach(migros.id, "ticket migros.jpg");
check("Justificatif ajouté (URL d'envoi signée sur le bucket privé)", r.status === 200 && globalThis.__storage.at(-1).bucket === "expense-receipts" && globalThis.__storage.at(-1).path.startsWith(`${migros.id}/`), r.body);
let p = await period(...OCT);
check("Dépense Bento complète : rien à compléter", byCode(p, migros.code).missing.length === 0 && byCode(p, migros.code).attachments.length === 1, byCode(p, migros.code));
check("CHF : montant payé = montant d'origine", byCode(p, migros.code).chf_amount === 45.2 && byCode(p, migros.code).original_amount === 45.2);
r = await save({ purchaseDate: "2026-10-02", supplier: "Coop", currency: "CHF", originalAmount: "10", chfAmount: "99", categoryId: cat("Autre"), payerId: payer("bento"), paidAt: "2026-10-02", receiptMissingReason: "ticket perdu" });
check("CHF : un montant CHF différent est ignoré (aucune conversion)", byCode(await period(...OCT), r.body.data.code).chf_amount === 10);
const coop = r.body.data;

// ═══ Avance personnelle ═══
r = await save({ purchaseDate: "2026-10-03", supplier: "Manor", categoryId: cat("Emballages et décorations"), currency: "CHF", originalAmount: "30", paidAt: "2026-10-03", payerId: payer("mel"), personalAdvance: true });
const melAdv = r.body.data;
check("Avance personnelle de Mel enregistrée", r.status === 200);
r = await save({ purchaseDate: "2026-10-03", supplier: "X", currency: "CHF", originalAmount: "5", paidAt: "2026-10-03", payerId: payer("bento"), personalAdvance: true });
check("Avance « payée par le compte Bento » → refus", r.status === 409, r.body);
p = await period(...OCT);
check("L'avance compte une seule fois dans l'engagé, et apparaît dans « avances »", near(p.totals.engaged.known, 45.2 + 10 + 30) && near(p.totals.engaged.advances, 30) && p.totals.engaged.advancesCount === 1, p.totals.engaged);

// ═══ Achat en EUR ═══
r = await save({ purchaseDate: "2026-10-05", supplier: "Amazon.de", description: "Moules", categoryId: cat("Matériel"), currency: "EUR", originalAmount: "50", chfAmount: "48.35", paidAt: "2026-10-06", payerId: payer("bento") });
const eur = r.body.data;
p = await period(...OCT);
check("EUR : 50 EUR d'origine, 48.35 CHF réellement débités comptés", byCode(p, eur.code).original_currency === "EUR" && byCode(p, eur.code).original_amount === 50 && byCode(p, eur.code).chf_amount === 48.35 && near(p.totals.engaged.known, 85.2 + 48.35));

// ═══ Montant CHF inconnu + justificatif manquant ═══
r = await save({ purchaseDate: "2026-10-07", supplier: "AliExpress", categoryId: cat("Emballages et décorations"), currency: "USD", originalAmount: "20", chfAmount: "", paidAt: "2026-10-07", payerId: payer("elie"), personalAdvance: true });
const usd = r.body.data;
p = await period(...OCT);
const usdRow = byCode(p, usd.code);
check("USD sans montant CHF : chf_amount null (jamais 0)", usdRow.chf_amount === null, usdRow);
check("… badge « À compléter » : montant CHF et justificatif", usdRow.missing.includes("chf_amount") && usdRow.missing.includes("receipt"), usdRow.missing);
check("… non compté dans le total connu, compté à part", near(p.totals.engaged.known, 133.55) && p.totals.engaged.unknownCount === 1, p.totals.engaged);
check("… avance d'Élie au montant inconnu : avances connues inchangées", near(p.totals.engaged.advances, 30) && p.totals.engaged.advancesCount === 2);
r = await save({ supplier: "Inconnu" });
check("Saisie très incomplète acceptée (sans date ni montant)", r.status === 200);
const bare = r.body.data;
p = await period(...OCT);
check("… elle apparaît avec « À compléter » et dans les dépenses sans date", byCode(p, bare.code).missing.includes("purchase_date") && byCode(p, bare.code).missing.includes("chf_amount") && p.totals.undatedCount === 1);
check("… elle ne change aucun total", near(p.totals.engaged.known, 133.55) && near(p.totals.paid.known, 133.55));

// ═══ Achat en septembre payé en octobre ═══
r = await save({ purchaseDate: "2026-09-28", supplier: "Imprimerie", categoryId: cat("Marketing et impression"), currency: "CHF", originalAmount: "120", status: "to_pay", payerId: payer("bento") });
const print = r.body.data;
let sep = await period(...SEP);
check("Achat de septembre à payer : engagé en septembre, pas payé", near(sep.totals.engaged.known, 120) && near(sep.totals.paid.known, 0) && near(sep.totals.toPayBalance.known, 120), sep.totals);
r = await save({ id: print.id, purchaseDate: "2026-09-28", supplier: "Imprimerie", categoryId: cat("Marketing et impression"), currency: "CHF", originalAmount: "120", status: "paid", paidAt: "2026-10-04", payerId: payer("bento") });
sep = await period(...SEP);
p = await period(...OCT);
check("Payé le 04.10 : engagé en septembre, payé en octobre", near(sep.totals.engaged.known, 120) && near(sep.totals.paid.known, 0) && near(p.totals.paid.known, 133.55 + 120) && near(p.totals.engaged.known, 133.55), { sep: sep.totals.engaged, oct: p.totals.paid });
check("Reste à payer remis à 0", near(p.totals.toPayBalance.known, 0) && p.totals.toPayBalance.count === 0);
r = await one("select count(*)::int n from public.expenses");
check("Date de paiement interdite pour une dépense « À payer » (règle SQL)", await db.query("select public.compta_save_expense(null,'zz',date '2026-10-01','A',null,null,'CHF',1,null,'to_pay',date '2026-10-02',null,false,null,null,'t')").then(() => false, (e) => /date de paiement/.test(e.message)));

// ═══ Double clic ═══
const dbl = { purchaseDate: "2026-10-08", supplier: "Landi", currency: "CHF", originalAmount: "12", paidAt: "2026-10-08", payerId: payer("bento"), categoryId: cat("Cuisine"), idempotencyKey: "same-click" };
const [c1, c2] = await Promise.all([call({ action: "save", status: "paid", ...dbl }), call({ action: "save", status: "paid", ...dbl })]).catch(async () => [await call({ action: "save", status: "paid", ...dbl }), await call({ action: "save", status: "paid", ...dbl })]);
check("Double clic : une seule dépense, même code", c1.body.data.id === c2.body.data.id && (await one("select count(*)::int n from public.expenses where supplier='Landi'")).n === 1, [c1.body, c2.body]);

// ═══ Doublons possibles ═══
r = await save({ purchaseDate: "2026-10-03", supplier: "MIGROS ", description: "Farine", categoryId: cat("Courses de production"), currency: "CHF", originalAmount: "45.20", paidAt: "2026-10-03", payerId: payer("bento") });
const migros2 = r.body.data;
check("Deux dépenses identiques légitimes : la seconde est acceptée", r.status === 200 && migros2.id !== migros.id);
p = await period(...OCT);
check("… les deux sont signalées « doublon possible »", byCode(p, migros.code).duplicates.some((d) => d.id === migros2.id) && byCode(p, migros2.code).duplicates.some((d) => d.id === migros.id) && p.totals.duplicateCount === 2);
await call({ action: "ack_duplicate", a: migros2.id, b: migros.id });
p = await period(...OCT);
check("« Ce n'est pas un doublon » : plus signalées, toutes deux comptées", byCode(p, migros.code).duplicates.length === 0 && p.totals.duplicateCount === 0 && near(p.totals.engaged.known, 133.55 + 12 + 45.2));

// ═══ Correction, historique, suppression logique ═══
r = await save({ id: eur.id, purchaseDate: "2026-10-05", supplier: "Amazon.de", description: "Moules silicone", categoryId: cat("Matériel"), currency: "EUR", originalAmount: "50", chfAmount: "48.90", paidAt: "2026-10-06", payerId: payer("bento") });
let hist = (await call({ action: "history", id: eur.id })).body.data;
check("Correction : historique avant / après (48.35 → 48.90) avec l'auteur", hist[0].action === "update" && hist[0].before.chf_amount === 48.35 && hist[0].after.chf_amount === 48.9 && hist[0].actor === "naglemelodie@gmail.com", hist[0]);
r = await call({ action: "delete", id: coop.id, reason: "" });
check("Suppression sans raison → refus", r.status === 409);
r = await call({ action: "delete", id: coop.id, reason: "Saisie en double" });
p = await period(...OCT);
check("Suppression logique : retirée des totaux, conservée en base", r.status === 200 && !byCode(p, coop.code) && (await one("select deleted_at is not null d, delete_reason from public.expenses where id=$1", [coop.id])).d);
hist = (await call({ action: "history", id: coop.id })).body.data;
check("… historique de la suppression", hist[0].action === "delete" && hist[0].after.delete_reason === "Saisie en double");
r = await call({ action: "delete", id: coop.id, reason: "x" });
check("Supprimer deux fois → refus", r.status === 404);

// ═══ Catégories : désactiver sans perdre l'historique ═══
await call({ action: "save_category", id: cat("Cuisine"), name: "Cuisine", active: false });
const s2 = (await call({ action: "settings" })).body.data;
p = await period(...OCT);
check("Catégorie désactivée : toujours affichée sur la dépense existante", s2.categories.find((c) => c.name === "Cuisine").active === false && p.expenses.find((e) => e.supplier === "Landi").category_name === "Cuisine");
await call({ action: "save_category", id: cat("Matériel"), name: "Matériel et outillage" });
p = await period(...OCT);
check("Catégorie renommée : même identifiant, nouveau nom sur les dépenses", byCode(p, eur.code).category_name === "Matériel et outillage" && byCode(p, eur.code).category_id === cat("Matériel"));
r = await call({ action: "save_category", name: "courses de production" });
check("Catégorie en double → refus", r.status === 409);
r = await call({ action: "save_payer", name: "Maman", kind: "other" });
check("Payeur ajouté", r.status === 200 && (await call({ action: "settings" })).body.data.payers.some((x) => x.name === "Maman"));

// ═══ Justificatifs : permissions ═══
const bucket = await one("select public, allowed_mime_types from storage.buckets where id='expense-receipts'");
check("Bucket expense-receipts privé (PDF et photos seulement)", bucket.public === false && bucket.allowed_mime_types.includes("application/pdf"));
check("Aucune règle d'accès storage pour ce bucket (service seulement)", (await one("select count(*)::int n from pg_policies where schemaname='storage' and (qual ilike '%expense-receipts%' or with_check ilike '%expense-receipts%')")).n === 0);
r = await call({ action: "upload_url", expenseId: migros.id, fileName: "x.exe", mimeType: "application/x-msdownload", size: 10 });
check("Format non accepté → refus", r.status === 400);
r = await call({ action: "upload_url", expenseId: migros.id, fileName: "big.pdf", mimeType: "application/pdf", size: 20 * 1024 * 1024 });
check("Fichier > 15 Mo → refus", r.status === 400);
r = await call({ action: "attach", expenseId: migros.id, path: `${eur.id}/autre.jpg`, fileName: "autre.jpg", mimeType: "image/jpeg" });
check("Rattacher un fichier d'une autre dépense → refus", r.status === 409, r.body);
r = await call({ action: "upload_url", expenseId: migros.id, fileName: "x.pdf", mimeType: "application/pdf", size: 10 }, "client-jwt");
check("Envoi par un non-admin → 401", r.status === 401);
const att = byCode(await period(...OCT), migros.code).attachments[0];
r = await call({ action: "view_attachment", expenseId: migros.id, id: att.id });
check("Aperçu : lien signé de 5 minutes, généré à la demande", r.status === 200 && /exp=300$/.test(r.body.data.url));
r = await call({ action: "view_attachment", expenseId: eur.id, id: att.id });
check("Aperçu avec une autre dépense → introuvable", r.status === 404);
check("Aucun lien stocké en base (référence = identifiant)", !(await q("select to_jsonb(a)::text t from public.expense_attachments a")).some((x) => x.t.includes("http")));
await attach(melAdv.id, "facture manor.pdf", "application/pdf");
await attach(melAdv.id, "photo.png", "image/png");

check("Toutes les opérations de dépenses : aucun appel externe (Make, e-mail)", (await one("select count(*)::int n from net._calls")).n === 0);

// ═══ Commandes : finance-month (lot 3) ═══
let n = 0;
async function order({ num, total, paidAt, test = false }) {
  const c = (await one("select gen_random_uuid() id")).id;
  await q("insert into auth.users (id, email) values ($1, $2)", [c, `c${++n}@t.ch`]);
  await q("insert into public.profiles (id, email) values ($1, $2) on conflict (id) do nothing", [c, `c${n}@t.ch`]);
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, paid_at, order_validation, customer_id, order_source, is_test)
    values ('fr','Claire','Dupont','c@t.ch','000',$1,'paid',$2,'approved',$3,'website',$4) returning id`, [total, paidAt, c, test]);
  await q("update public.orders set order_number=$2 where id=$1", [o.id, num]);
  await q("insert into public.order_items (order_id, product, total, size) values ($1,'bento_cake',$2,'10cm'), ($1,'bento_cake',$3,'10cm')", [o.id, total - 20, 20]);
  return o.id;
}
const o1 = await order({ num: "ORD-1", total: 100, paidAt: "2026-10-04T10:00:00Z" });
await order({ num: "ORD-2", total: 60, paidAt: "2026-10-09T10:00:00Z" });
await order({ num: "ORD-T", total: 999, paidAt: "2026-10-09T10:00:00Z", test: true });
await q("select * from public.ingest_refund(p_order_id=>$1, p_amount=>25, p_refunded_at=>'2026-10-10 12:00 Europe/Zurich', p_source=>'admin', p_method=>'twint', p_allow_gesture=>true, p_idempotency_key=>'r1')", [o1]);
const callsBefore = (await one("select count(*)::int n from net._calls")).n;
const ordersBefore = await q("select to_jsonb(o) j from public.orders o order by id");
const finance = (await invoke("finance-month", { month: "2026-10" })).body.data;
check("Revenus via finance-month : encaissé 160, remboursé 25, net 135, test exclue", near(finance.cards.collected, 160) && near(finance.cards.refunded, 25) && near(finance.cards.net, 135), finance.cards);

// ═══ Excel du mois ═══
p = await period(...OCT);
const wb = CX.buildComptaWorkbook(ExcelJS, finance, p);
const file = path.join(tmp, "compta.xlsx");
await wb.xlsx.writeFile(file);
const rb = new ExcelJS.Workbook();
await rb.xlsx.readFile(file);
check("Feuilles : Synthèse, Commandes et articles, Encaissements, Remboursements, Dépenses", rb.worksheets.map((w) => w.name).join("|") === "Synthèse|Commandes et articles|Encaissements|Remboursements|Dépenses", rb.worksheets.map((w) => w.name));
const S = rb.getWorksheet("Synthèse");
const findRow = (ws, label) => { let row = null; ws.eachRow((r) => { if (String(r.getCell(1).value ?? "").startsWith(label)) row = r; }); return row; };
const val = (c) => (c.value && typeof c.value === "object" && "result" in c.value ? c.value.result : c.value);
check("Synthèse : revenus nets = tableau de bord (135)", near(val(findRow(S, "Net du mois").getCell(2)), 135));
const D = rb.getWorksheet("Dépenses");
const head = D.getRow(1).values.slice(1);
check("Dépenses : colonnes catégorie, fournisseur, dates, devise, CHF, payé par, statut, justificatifs", ["ID dépense", "Date d'achat", "Date de paiement", "Fournisseur", "Catégorie", "Devise d'origine", "Payé en CHF", "Payé par", "Statut", "Justificatifs (fichiers du ZIP)"].every((h) => head.includes(h)), head);
const rowsByCode = {};
D.eachRow((row, i) => { if (i > 1 && /^DEP-/.test(String(row.getCell(1).value))) rowsByCode[row.getCell(1).value] = row; });
check("Dépense USD : cellule CHF vide (pas 0), « montant payé en CHF » à compléter", rowsByCode[usd.code].getCell(9).value == null && String(rowsByCode[usd.code].getCell(16).value).includes("montant payé en CHF"));
check("Achat de septembre payé en octobre : « Achat dans le mois » Non, « Payée dans le mois » Oui", rowsByCode[print.code].getCell(14).value === "Non" && rowsByCode[print.code].getCell(15).value === "Oui");
const engagedRow = findRow(S, "Engagé (date d'achat");
check("Synthèse : engagé (formule → feuille Dépenses) = total serveur", near(val(engagedRow.getCell(2)), p.totals.engaged.known) && String(engagedRow.getCell(2).value.formula).includes("'Dépenses'!"), val(engagedRow.getCell(2)));
let sumifs = null; D.eachRow((row) => { if (String(row.getCell(8).value ?? "").startsWith("Engagé")) sumifs = row.getCell(9).value; });
check("Feuille Dépenses : total engagé en formule SUMIFS", sumifs && /^SUMIFS\(/.test(sumifs.formula) && near(sumifs.result, p.totals.engaged.known), sumifs);
const unknownRow = findRow(S, "Achats du mois au montant CHF inconnu");
check("Synthèse : 1 achat au montant CHF inconnu signalé (non compté)", val(unknownRow.getCell(2)) === 1);
const stateRow = findRow(S, "INCOMPLET");
check("Dossier marqué INCOMPLET (montants / pièces manquants, salaire à venir), jamais définitif", !!stateRow && /justificatif/.test(stateRow.getCell(1).value) && /K2/.test(stateRow.getCell(1).value));
check("Contrôle « Synthèse = feuille Dépenses » = OK", val(findRow(S, "Synthèse = feuille Dépenses").getCell(2)) === "OK");
check("Commande de test absente de l'Excel", !JSON.stringify(rb.getWorksheet("Encaissements").getSheetValues()).includes("ORD-T"));

// ═══ ZIP des justificatifs ═══
const rec = (await call({ action: "receipts_period", from: OCT[0], to: OCT[1] })).body.data;
check("Justificatifs du mois : 3 pièces, liens signés de 10 minutes (téléchargement seulement)", rec.length === 3 && rec.every((x) => /exp=600$/.test(x.url)), rec);
const { blob, failed } = await CX.buildReceiptsZip(rec, "2026-10", async (url) => new Blob([`contenu ${url}`]));
const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
const names = Object.keys(zip.files).sort();
check("ZIP : fichiers nommés avec l'ID de dépense + index", failed.length === 0 && names.includes(`${migros.code}_1_ticket_migros.jpg`) && names.includes(`${melAdv.code}_1_facture_manor.pdf`) && names.includes(`${melAdv.code}_2_photo.png`) && names.includes("index_justificatifs_2026-10.csv"), names);
check("Mêmes noms dans l'Excel que dans le ZIP", String(rowsByCode[melAdv.code].getCell(13).value).split("\n").every((x) => names.includes(x)));

// ═══ Aucun effet sur les commandes ═══
const ordersAfter = await q("select to_jsonb(o) j from public.orders o order by id");
check("Aucune commande modifiée par la compta", JSON.stringify(ordersBefore) === JSON.stringify(ordersAfter));
check("Aucun appel externe (Make, e-mail) pendant la compta", (await one("select count(*)::int n from net._calls")).n === callsBefore);

// ═══ Relance de F10 sans effet ═══
const before = await one("select (select count(*) from public.expenses) e, (select count(*) from public.expense_categories) c, (select count(*) from public.expense_payers) p, (select count(*) from public.expense_attachments) a, (select string_agg(name || active::text, ',' order by name) from public.expense_categories) n");
await db.exec(fs.readFileSync(F10, "utf8"));
const after = await one("select (select count(*) from public.expenses) e, (select count(*) from public.expense_categories) c, (select count(*) from public.expense_payers) p, (select count(*) from public.expense_attachments) a, (select string_agg(name || active::text, ',' order by name) from public.expense_categories) n");
check("Relance de F10 : rien n'est modifié (catégories renommées / désactivées conservées)", JSON.stringify(before) === JSON.stringify(after), { before, after });

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
