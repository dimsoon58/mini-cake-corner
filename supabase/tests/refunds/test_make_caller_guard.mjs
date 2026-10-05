// Garde d'appelant des deux fonctions encore utilisées par Make (7425367) :
// cancel-order-item-make et cancel-workshop-seats-instant (code de production
// + garde). Vraies fonctions, réseau simulé : aucun appel Supabase, Resend ou
// PostFinance réel, aucun e-mail.
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

let env = {};
const calls = [];
const allCalls = [];
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { globalThis.__h = h; } };
globalThis.fetch = async (url, init) => { calls.push(String(url)); allCalls.push(String(url)); return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } }); };
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
const req = (auth, body) => new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) });

for (const [fn, body] of [["cancel-order-item-make", { orderItemId: "00000000-0000-0000-0000-000000000001" }],
                          ["cancel-workshop-seats-instant", { workshop_reference: "WS-ABCDEF", seats_to_cancel: 1, idempotency_key: "k", admin_cancel_token: "t" }]]) {
  const h = await load(fn);
  env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "srk", RESEND_API_KEY: "re", ADMIN_ORDER_PIN: "pin" };
  const run = async (auth) => { calls.length = 0; const r = await h(req(auth, body)); return { status: r.status, calls: [...calls] }; };
  let r = await run(jwt("authenticated"));
  check(`${fn} : client ou admin connecté (authenticated) → 403, aucun appel`, r.status === 403 && r.calls.length === 0, r);
  r = await run(null);
  check(`${fn} : sans jeton → 403, aucun appel`, r.status === 403 && r.calls.length === 0, r);
  r = await run(jwt("service_role"));
  check(`${fn} : service_role (Make) → passe la garde`, r.status !== 403 && r.calls.length > 0, r);
  r = await run("sb_secret_abc");
  check(`${fn} : clé secrète sb_secret_ → passe la garde`, r.status !== 403 && r.calls.length > 0, r);
  r = await run(jwt("anon"));
  check(`${fn} : ancienne clé anon, mode normal → passe (Make n'est pas cassé)`, r.status !== 403 && r.calls.length > 0, r);
  env.MAKE_CALLER_STRICT = "true";
  r = await run(jwt("anon"));
  check(`${fn} : ancienne clé anon, MAKE_CALLER_STRICT=true → 403, aucun appel`, r.status === 403 && r.calls.length === 0, r);
  r = await run("sb_publishable_abc");
  check(`${fn} : clé publique du site, mode strict → 403`, r.status === 403 && r.calls.length === 0, r);
  r = await run(jwt("service_role"));
  check(`${fn} : service_role, mode strict → passe`, r.status !== 403 && r.calls.length > 0, r);
  const opt = await h(new Request("http://x/", { method: "OPTIONS" }));
  check(`${fn} : OPTIONS inchangé`, opt.status === 200 || opt.status === 204);
  const src = fs.readFileSync(path.join(ROOT, `functions/${fn}/index.ts`), "utf8");
  check(`${fn} : la garde est appelée avant toute lecture du corps`, src.indexOf("callerRefusal(req") < src.indexOf("req.json()"));
}
check("Aucun appel à Resend dans tout le test (aucun e-mail possible)", allCalls.length > 0 && !allCalls.some((u) => u.includes("resend.com")), allCalls.filter((u) => u.includes("resend")));
const cfg = fs.readFileSync(path.join(ROOT, "config.toml"), "utf8");
check("config.toml : Verify JWT activé pour les deux fonctions (la garde en dépend)",
  /\[functions\.cancel-order-item-make\]\s*\nverify_jwt = true/.test(cfg) && /\[functions\.cancel-workshop-seats-instant\]\s*\nverify_jwt = true/.test(cfg));

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
