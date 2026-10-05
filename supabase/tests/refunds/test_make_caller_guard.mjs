// Authentification de Make (v2) des deux fonctions encore utilisées par le
// scénario 7425367 : cancel-order-item-make et cancel-workshop-seats-instant
// (code de production + authentification). Vraies fonctions, réseau SIMULÉ qui
// renvoie un article / une réservation VALIDES : une clé qui passerait la garde
// irait jusqu'à l'annulation et à l'e-mail (simulés). Aucun appel réel, aucun e-mail.
//
//   cd supabase/tests/refunds
//   npm install --no-save esbuild
//   node test_make_caller_guard.mjs
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

const ROOT = path.resolve(import.meta.dirname, "../..");
let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ""); } };

const SERVICE_KEY = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from('{"role":"service_role","ref":"proj"}').toString("base64url")}.signature-du-projet`;
const DEDICATED = "s".repeat(40);
const ITEM = "11111111-2222-3333-4444-555555555555";
let env = {};
const calls = [];
const valid = (url) => {
  if (url.includes("/order_items?id=eq.")) return [{ id: ITEM, order_id: "o1", order_number: "ORD-1", product: "bento_cake", size: "bento", total: 60, production_status: "confirmed", fulfillment_id: null }];
  if (url.includes("/orders?")) return [{ id: "o1", order_number: "ORD-1", email: "client@test.ch", first_name: "Claire", lang: "fr", pickup_delivery_date: "2026-10-20" }];
  if (url.includes("/order_items?order_id=eq.")) return [{ id: ITEM, production_status: "confirmed" }, { id: "x", production_status: "confirmed" }];
  if (url.includes("resend.com")) return { id: "email-simule" };
  if (url.includes("cancel-workshop-seats")) return { success: true };
  return [];
};
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { globalThis.__h = h; } };
globalThis.fetch = async (url) => { calls.push(String(url)); return new Response(JSON.stringify(valid(String(url))), { status: 200, headers: { "content-type": "application/json" } }); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guard-"));
fs.writeFileSync(path.join(tmp, "empty.mjs"), "export {};");
async function load(fn) {
  const out = path.join(tmp, `${fn}.mjs`);
  await build({ entryPoints: [path.join(ROOT, `functions/${fn}/index.ts`)], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error",
    plugins: [{ name: "m", setup(b) { b.onResolve({ filter: /^jsr:/ }, () => ({ path: path.join(tmp, "empty.mjs") })); } }] });
  await import(out);
  return globalThis.__h;
}
const jwt = (role) => `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ role, sub: "x" })).toString("base64url")}.sig`;

for (const [fn, body] of [["cancel-order-item-make", { orderItemId: ITEM }],
                          ["cancel-workshop-seats-instant", { workshop_reference: "WS-ABC234", seats_to_cancel: 1, idempotency_key: "k", admin_cancel_token: "t" }]]) {
  const h = await load(fn);
  env = { SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, RESEND_API_KEY: "re_simule", ADMIN_ORDER_PIN: "pin", MAKE_FUNCTIONS_SECRET: DEDICATED };
  const run = async (headers) => {
    calls.length = 0;
    const r = await h(new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }));
    return { status: r.status, calls: [...calls] };
  };
  const refused = async (label, headers) => {
    const r = await run(headers);
    check(`${fn} : ${label} → 403 avant tout appel (identifiant valide)`, r.status === 403 && r.calls.length === 0, r);
  };
  // Toute clé publique est refusée, même avec un identifiant d'article / de réservation valide.
  await refused("clé publique du site (sb_publishable_…)", { Authorization: "Bearer sb_publishable_abc", apikey: "sb_publishable_abc" });
  await refused("ancienne clé anon (JWT rôle anon)", { Authorization: `Bearer ${jwt("anon")}` });
  await refused("clé publique en apikey seule", { apikey: jwt("anon") });
  await refused("client ou admin connectés (rôle authenticated)", { Authorization: `Bearer ${jwt("authenticated")}` });
  await refused("sans aucune clé", {});
  await refused("clé « sb_secret_… » qui n'est pas celle du projet", { Authorization: "Bearer sb_secret_inconnue" });
  await refused("faux jeton « service_role » (rôle seul, pas la clé du projet)", { Authorization: `Bearer ${jwt("service_role")}` });
  await refused("mauvais secret dédié", { Authorization: `Bearer ${jwt("anon")}`, "x-make-function-secret": "x".repeat(40) });
  await refused("secret dédié tronqué", { "x-make-function-secret": DEDICATED.slice(0, 39) });
  // Preuves acceptées.
  let r = await run({ Authorization: `Bearer ${SERVICE_KEY}` });
  check(`${fn} : clé service_role EXACTE du projet → acceptée (traitement lancé)`, r.status !== 403 && r.calls.length > 0, r);
  if (fn === "cancel-order-item-make") check("Contrôle du jeu de données : avec une preuve valide, l'article valide irait jusqu'à l'annulation et l'e-mail (simulés) — les refus ci-dessus ne viennent donc pas d'un identifiant invalide",
    r.calls.some((u) => u.includes("resend.com")), r.calls);
  if (fn === "cancel-workshop-seats-instant") check("Contrôle du jeu de données : avec une preuve valide, la demande part vers cancel-workshop-seats (simulé)",
    r.calls.some((u) => u.includes("/functions/v1/cancel-workshop-seats")), r.calls);
  r = await run({ Authorization: `Bearer ${jwt("anon")}`, "x-make-function-secret": DEDICATED });
  check(`${fn} : secret dédié correct (connexion Make actuelle + en-tête) → accepté`, r.status !== 403 && r.calls.length > 0, r);
  // Secret dédié trop court côté serveur : la voie du secret est fermée.
  env.MAKE_FUNCTIONS_SECRET = "court";
  await refused("secret serveur de moins de 32 caractères (voie fermée)", { "x-make-function-secret": "court" });
  env.MAKE_FUNCTIONS_SECRET = DEDICATED;
  const opt = await h(new Request("http://x/", { method: "OPTIONS" }));
  check(`${fn} : OPTIONS inchangé`, opt.status === 200 || opt.status === 204);
  const src = fs.readFileSync(path.join(ROOT, `functions/${fn}/index.ts`), "utf8");
  check(`${fn} : l'authentification est vérifiée avant toute lecture du corps`, src.indexOf("makeCallerRefusal(req") < src.indexOf("req.json()"));
  check(`${fn} : aucune acceptation fondée sur un préfixe ou un rôle`, !/startsWith\("sb_secret_"\)|payload\?\.role/.test(src));
}
const cfg = fs.readFileSync(path.join(ROOT, "config.toml"), "utf8");
check("config.toml : Verify JWT inchangé (activé) pour les deux fonctions",
  /\[functions\.cancel-order-item-make\]\s*\nverify_jwt = true/.test(cfg) && /\[functions\.cancel-workshop-seats-instant\]\s*\nverify_jwt = true/.test(cfg));

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
