// Étiquettes de production — vraie fonction get-orders-for-labels sur le
// schéma de production (PGlite, F1–F14), puis vrai code de contenu et de
// mise en page du site (src/lib/productionLabels.ts). Ne se connecte jamais
// à Supabase ; aucun écran, aucune imprimante.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_labels.mjs
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
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 3000) : ""); } };

const db = await freshDb({ migrations: fs.readdirSync(MIG).filter((f) => /^20261002(09|10|11|12|13|14|16|17|18|19)/.test(f)).sort().map((f) => path.join(MIG, f)) });
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

// ── supabase-js minimal → SQL (lecture seule, colonnes simples) ──────────
const fmt = (v, type) => (v instanceof Date ? (type === 1082 ? v.toISOString().slice(0, 10) : v.toISOString()) : v);
let writes = 0;
function from(table) {
  let cols = "*"; const where = []; const params = [];
  const b = {
    select(c) { cols = c.split(",").map((s) => s.trim()).filter(Boolean).join(", "); return b; },
    eq(c, v) { params.push(v); where.push(`${c} = $${params.length}`); return b; },
    neq(c, v) { params.push(v); where.push(`${c}::text <> $${params.length}`); return b; },
    gte(c, v) { params.push(v); where.push(`${c} >= $${params.length}`); return b; },
    lte(c, v) { params.push(v); where.push(`${c} <= $${params.length}`); return b; },
    in(c, v) { params.push(v); where.push(`${c}::text = any($${params.length}::text[])`); return b; },
    insert() { writes++; return b; }, update() { writes++; return b; }, upsert() { writes++; return b; }, delete() { writes++; return b; },
    then(res, rej) {
      db.query(`select ${cols} from public.${table}${where.length ? ` where ${where.join(" and ")}` : ""}`, params)
        .then((r) => res({ data: r.rows.map((row) => Object.fromEntries(r.fields.map((f) => [f.name, fmt(row[f.name], f.dataTypeID)]))), error: null }))
        .catch((e) => res({ data: null, error: { message: e.message } }))
        .catch(rej);
    },
  };
  return b;
}
globalThis.__supa = {
  from,
  rpc: async () => { writes++; return { data: null, error: null }; },
  auth: { getUser: async (j) => ({ data: { user: j === "admin-jwt" ? { email: "naglemelodie@gmail.com" } : j === "client-jwt" ? { email: "x@y.ch" } : null }, error: null }) },
};
globalThis.fetch = async () => { throw new Error("réseau interdit dans ce test"); };
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x" })[k] } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lb-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), "export function createClient() { return globalThis.__supa; }");
await build({ entryPoints: [path.join(ROOT, "functions/get-orders-for-labels/index.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "fn.mjs"), logLevel: "error",
  plugins: [{ name: "m", setup(b) {
    b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
    b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
  } }] });
await import(path.join(tmp, "fn.mjs"));
const handler = globalThis.__handler;
// Code du site : alias « @ » → src, images du catalogue remplacées par un nom.
await build({ entryPoints: [path.join(REPO, "src/lib/productionLabels.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "labels.mjs"), logLevel: "error",
  plugins: [{ name: "alias", setup(b) {
    b.onResolve({ filter: /^@\// }, (a) => {
      const base = path.join(REPO, "src", a.path.slice(2));
      for (const ext of ["", ".ts", ".tsx", "/index.ts"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return { path: base + ext };
      return { path: base };
    });
    b.onLoad({ filter: /\.(png|jpe?g|webp|svg|gif)$/ }, (a) => ({ contents: `export default ${JSON.stringify(path.basename(a.path))};`, loader: "js" }));
  } }] });
const L = await import(path.join(tmp, "labels.mjs"));
await build({ entryPoints: [path.join(REPO, "src/data/inspirationReference.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "ref.mjs"), logLevel: "error" });
const R = await import(path.join(tmp, "ref.mjs"));

const call = async (body, jwt = "admin-jwt") => {
  const r = await handler(new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
};

// ── Données ─────────────────────────────────────────────────────────────
const D1 = "2026-10-12", D2 = "2026-10-13", D3 = "2026-10-20";
let n = 0;
async function order({ num, first = "Claire", last = "Dupont", date = D1, pay = "paid", manual = false, validation = "approved", draft = false, physical = null, test = false }) {
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, paid_at, order_validation, physical_validation,
      pickup_delivery_date, pickup_delivery_slot, order_source, created_via, is_draft, is_test, order_comment)
    values ('fr',$1,$2,$3,'+41790000000',100,$4,$5,$6,$7,$8,'14:00 – 15:00',$9,$10,$11,$12,'Note client à ne pas imprimer') returning id`,
    [first, last, `c${++n}@test.ch`, pay, pay === "paid" ? "2026-10-01T10:00:00Z" : null, validation, physical ?? "approved", date, manual ? "manual order" : "website", manual ? "admin" : null, draft, test]);
  await q("update public.orders set order_number=$2 where id=$1", [o.id, num]);
  return o.id;
}
async function item(orderId, f = {}) {
  const r = await one(`insert into public.order_items (order_id, product, size, shape, flavors, design, base_color, decoration_color, inside_color, ribbon_color, butterfly_color,
      extra, cake_text, text_color, text_style, item_comment, candles, total, quantity, fulfillment_id, created_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20, now() + ($21 || ' seconds')::interval) returning id`,
    [orderId, f.product ?? "bento_cake", "size" in f ? f.size : "bento", "shape" in f ? f.shape : "round", f.flavors ?? ["Vanilla"], f.design ?? null, f.base ?? null, f.deco ?? null, f.inside ?? null,
     f.ribbon ?? null, f.butterfly ?? null, f.extra ?? null, f.text ?? null, f.textColor ?? null, f.textStyle ?? null, f.comment ?? null, JSON.stringify(f.candles ?? []),
     f.total ?? 45, f.qty ?? 1, f.fulfillment ?? null, String(f.seq ?? 0)]);
  return r.id;
}
const fulfil = async (orderId, date) => (await one("insert into public.order_fulfillments (order_id, pickup_delivery_date, delivery_method) values ($1,$2,'pickup') returning id", [orderId, date])).id;

// 1. Gâteau simple (site, payé)
const oSimple = await order({ num: "ORD-261012-0001", first: "Élodie", last: "Müller" });
const iSimple = await item(oSimple, { design: "heart-bomb", base: "pastel-pink", deco: "white, gold", text: "Joyeux anniversaire Zoé !", textColor: "dark-red", textStyle: "cursive",
  extra: "Cherries, Ribbon: Baby Pink, Glitter: Gold", ribbon: "Baby Pink", comment: "[Preferred design: Option 2] Merci beaucoup", candles: [{ id: "gold-spiral", quantity: 2 }] });
// 2. Commande manuelle (en attente de paiement, pas brouillon), saisie par ids
const oManual = await order({ num: "ORDM-261012-0001", first: "Marc", last: "Rossi", manual: true, pay: "pending" });
const iManual = await item(oManual, { size: "medium", shape: "heart", flavors: ["red-velvet"], design: "roses-please", base: "cream", deco: "pink, roses-burgundy" });
// 3. Plusieurs gâteaux différents + 4. quantité 2
const oMulti = await order({ num: "ORD-261013-0002", first: "Ana", last: "Silva", date: D2 });
const iMultiA = await item(oMulti, { flavors: ["Chocolate"], design: "glitter-base", base: "black", extra: "Glitter: Pink", seq: 1 });
const iMultiB = await item(oMulti, { product: "dot_cakes", size: "dot-cakes-12", shape: null, flavors: ["Red Velvet (Standard Flavours)", "Red Velvet (Standard Flavours)", "Vanilla (Standard Flavours)"], seq: 2 });
const iQty = await item(oMulti, { flavors: ["Lemon Curd"], design: "normal-with-border", base: "white", qty: 2, seq: 3 });
const iCandles = await item(oMulti, { product: "candles", size: null, shape: null, flavors: [], seq: 4 });
// 5. Plusieurs dates (fulfillments)
const oDates = await order({ num: "ORD-261012-0003", first: "Léa", last: "Bernard", date: D1 });
const fA = await fulfil(oDates, D1), fB = await fulfil(oDates, D3);
const iDateA = await item(oDates, { flavors: ["Vanilla"], fulfillment: fA, base: "lavender", seq: 1 });
const iDateB = await item(oDates, { flavors: ["Tiramisu"], fulfillment: fB, base: "mint-green", seq: 2 });
// 6. Texte et décoration longs
const longText = "Félicitations pour ton diplôme, Anaïs ! Bravo pour ces cinq années d'efforts, de nuits blanches et de café — toute la famille est fière de toi. Rendez-vous à Genève, le 12 octobre, pour fêter ça comme il se doit !!! Avec tout notre amour : Papa, Maman, Hugo, Inès & Mamie Françoise.";
const oLong = await order({ num: "ORD-261012-0004", first: "Anne-Sophie", last: "de La Tour-Montgomery-Vallée", date: D1 });
const iLong = await item(oLong, { size: "large", design: "rainbow-cake", base: "baby-blue", deco: "pink, lavender, pastel-yellow, mint-green, sky-blue, white, gold, roses-dark-pink",
  text: longText, textColor: "midnight-blue", textStyle: "uppercase", inside: "Rose", butterfly: "Gold", extra: "Glitter Cherries: Red, Glitter: White" });
// 7. Champs facultatifs vides
const oEmpty = await order({ num: "ORD-261012-0005", first: "Tom", last: "Weber" });
const iEmpty = await item(oEmpty, { design: null, base: null, deco: null, text: null });
// 8. Gâteau annulé (remboursement « annule l'article ») dans une commande qui garde un autre gâteau
const oCancel = await order({ num: "ORD-261012-0006", first: "Nina", last: "Keller" });
const iCancelled = await item(oCancel, { flavors: ["Chocolate"], seq: 1 });
const iKept = await item(oCancel, { flavors: ["Vanilla"], seq: 2 });
await q("insert into public.order_manual_refunds (order_id, amount, note, created_by, order_item_id, cancels_item, status, refunded_at) values ($1, 45, 'annulation', 'test', $2, true, 'counted', now())", [oCancel, iCancelled]);
// Exclus par l'agenda : commande annulée, commande du site non payée, brouillon, refus du gâteau, workshop
const oCancelledOrder = await order({ num: "ORD-261012-0007", validation: "cancelled" }); await item(oCancelledOrder);
const oUnpaid = await order({ num: "ORD-261012-0008", pay: "pending" }); await item(oUnpaid);
const oDraft = await order({ num: "ORDM-261012-0002", manual: true, pay: "pending", draft: true }); await item(oDraft);
const oRefused = await order({ num: "ORD-261012-0009", physical: "rejected" }); await item(oRefused);
const oWorkshop = await order({ num: "ORD-261012-0010" });
await q("insert into public.order_items (order_id, product, total, workshop_date) values ($1,'workshop',80,$2)", [oWorkshop, D1]);
// Hors période
const oLater = await order({ num: "ORD-261025-0001", date: "2026-10-25" }); await item(oLater);

// Alertes : commentaire de commande, photo personnelle (+ photo d'inspiration recopiée par le catalogue).
// (le jeu de données donne une note à toutes les commandes : on ne la garde que sur la commande simple)
await q("update public.orders set order_comment = null where id <> $1", [oSimple]);
await q("update public.orders set order_comment = 'Merci de mettre un petit cœur' where id = $1", [oEmpty]);
await q("update public.order_items set reference_images = $2, design_image_url = $3 where id = $1",
  [iMultiA, ["https://site.test/assets/inspiration-22-AbC123.jpg", "https://cdn.test/order-uploads/photo-cliente.jpg"], "https://site.test/assets/inspiration-22-AbC123.jpg"]);
await q("update public.order_items set reference_images = $2, design_image_url = $3 where id = $1",
  [iQty, ["https://site.test/assets/style-heart-bomb.jpg"], "https://site.test/assets/style-heart-bomb.jpg"]);

const snapshot = async () => JSON.stringify(await q("select to_jsonb(o) as o, (select json_agg(i order by i.id) from public.order_items i where i.order_id = o.id) as items from public.orders o order by o.id"));
const before = await snapshot();

// ═══ Fonction ═══════════════════════════════════════════════════════════
check("Accès : sans connexion → 401", (await call({ from: D1, to: D2 }, null)).status === 401);
check("Accès : compte non admin → 401", (await call({ from: D1, to: D2 }, "client-jwt")).status === 401);
check("Période invalide → 400", (await call({ from: D2, to: D1 })).status === 400 && (await call({ from: "x", to: D1 })).status === 400);
check("Période de plus de 31 jours → 400", (await call({ from: "2026-10-01", to: "2026-12-01" })).status === 400);

let r = await call({ from: D1, to: D2 });
check("Période : réponse 200", r.status === 200, r.body);
const got = r.body.items ?? [];
const ids = new Set(got.map((i) => i.id));
check("Gâteau simple inclus", ids.has(iSimple));
check("Commande manuelle (ORDM, en attente de paiement) incluse, badge « en attente de paiement »", ids.has(iManual) && got.find((i) => i.id === iManual).badge === "awaiting_payment");
check("Plusieurs gâteaux d'une commande : chacun présent (2 gâteaux + ligne quantité 2)", ids.has(iMultiA) && ids.has(iMultiB) && ids.has(iQty));
check("Bougies : pas d'étiquette", !ids.has(iCandles));
check("Plusieurs dates : seul le gâteau daté dans la période (par son fulfillment)", ids.has(iDateA) && !ids.has(iDateB) && got.find((i) => i.id === iDateA).date === D1);
check("Texte long et champs vides inclus", ids.has(iLong) && ids.has(iEmpty));
check("Gâteau annulé exclu, l'autre gâteau de la commande gardé", !ids.has(iCancelled) && ids.has(iKept));
check("Commande annulée, non payée (site), brouillon, gâteau refusé, workshop : exclus", !got.some((i) => [oCancelledOrder, oUnpaid, oDraft, oRefused, oWorkshop].includes(i.order_id)));
check("Hors période exclu", !got.some((i) => i.order_id === oLater));
const keys = new Set(got.flatMap((i) => Object.keys(i)).concat(got.flatMap((i) => Object.keys(i.order))));
check("Données client limitées (ni e-mail, ni téléphone, ni adresse, ni prix, ni créneau, ni note de commande)",
  !["email", "phone", "delivery_address", "total", "total_amount", "pickup_delivery_slot", "order_comment", "candles"].some((k) => keys.has(k)), [...keys]);

r = await call({ orderId: oDates });
check("Fiche commande : les deux gâteaux, chacun avec sa propre date", r.body.items?.length === 2 && r.body.items.find((i) => i.id === iDateB)?.date === D3 && r.body.items.find((i) => i.id === iDateA)?.date === D1);
r = await call({ orderId: oMulti });
check("Fiche commande : les bougies reviennent avec la raison « pas un gâteau »", r.body.items?.find((i) => i.id === iCandles)?.excluded === "not_a_cake");
r = await call({ orderId: oCancel });
check("Fiche commande : le gâteau annulé revient avec la raison « annulé »", r.body.items?.find((i) => i.id === iCancelled)?.excluded === "item_cancelled" && r.body.items?.find((i) => i.id === iKept)?.excluded === null);
r = await call({ orderId: oCancelledOrder });
check("Fiche commande annulée : gâteau marqué hors agenda", r.body.items?.[0]?.excluded === "order_not_eligible");
check("Commande inconnue → 404", (await call({ orderId: "00000000-0000-4000-8000-000000000000" })).status === 404);
check("Aucune écriture : commandes et articles inchangés, aucun appel d'écriture", (await snapshot()) === before && writes === 0);

// ═══ Contenu et mise en page ════════════════════════════════════════════
// Mesure approchée d'Arial (le site utilise la vraie mesure du navigateur).
const measure = (t, f) => [...t].reduce((s, ch) => s + f.size * (ch === " " ? 0.28 : /[A-ZÀ-Ý0-9]/.test(ch) ? (f.bold ? 0.7 : 0.66) : /[il.,:;'!|]/.test(ch) ? 0.25 : (f.bold ? 0.58 : 0.54)), 0);
const items = (await call({ from: D1, to: D2 })).body.items;
const cakes = L.buildCakeLabels(items);
const pages = L.layoutAll(cakes, measure);
const textOf = (c) => L.layoutCake(c, measure).flatMap(L.pageText);
const cake = (itemId, i = 0) => cakes.find((c) => c.key === `${itemId}-${i}`);

const s = cake(iSimple);
check("Simple : date, client, commande", s.dateText === "12.10.2026" && s.customer === "Élodie Müller" && s.orderNumber === "ORD-261012-0001");
check("Simple : produit · taille · forme sur une ligne", s.productLine === "Bento Cake · Bento · Rond", s.productLine);
check("Simple : goût, base en français, design lisible avec la photo choisie", s.flavour === "Vanilla" && s.base === "Rose Pastel" && s.design === "Heart Bomb — photo 2", s);
const nb = (t) => t?.replace(/\u00a0/g, " ");
check("Simple : couleurs du design et des décorations (déco, rubans, paillettes)", nb(s.colours) === "Blanc, Or · Rubans : Rose Bébé · Paillettes : Or", s.colours);
check("« Paillettes : Or » jamais coupé avant les deux-points", !L.layoutCake(s, measure).flatMap(L.pageText).some((l) => l.trim().startsWith(":")));
check("Simple : texte exact (accents, majuscules, ponctuation), couleur et écriture", s.cakeText === "Joyeux anniversaire Zoé !" && s.textColour === "Rouge" && s.textStyle === "Cursive");
const st = textOf(s).join(" | ");
check("Simple : commentaire de la cliente → alerte, sans en imprimer le texte", s.alerts.join() === L.ALERT_COMMENT);
check("Simple : rien d'interdit (créneau, bougies, notes, prix, retrait)", !/14:00|bougie|spiral|Merci beaucoup|Note client|CHF|Retrait|Livraison|45/i.test(st), st);
check("Simple : type de déco (Cerises) et lignes « Déco », « Couleur déco », « Style texte »", s.decoType === "Cerises" && st.includes("Déco : ") && st.includes("Couleur déco : ") && st.includes("Style texte : "), st);
check("Simple : ordre date → client → commande en tête", st.indexOf("12.10.2026") < st.indexOf("Élodie Müller") && st.indexOf("Élodie Müller") < st.indexOf("ORD-261012-0001"));

const m = cake(iManual);
check("Manuelle : ids traduits (Red Velvet, Crème, Roses Please, roses bordeaux), taille et forme", m.orderNumber === "ORDM-261012-0001" && m.flavour === "Red Velvet" && m.base === "Crème"
  && m.design === "Roses Please" && nb(m.colours) === "Rose · Roses : Bordeaux" && m.productLine === "Bento Cake · Medium · Cœur", m);

const a = cake(iMultiA), dc = cake(iMultiB);
check("Plusieurs gâteaux : chaque étiquette garde ses propres détails", a.flavour === "Chocolate" && nb(a.colours) === "Paillettes : Rose" && dc.flavour === "Red Velvet ×2, Vanilla"
  && dc.productLine === "Dot Cakes 12 pièces" && !textOf(a).join(" ").includes("Red Velvet") && !textOf(dc).join(" ").includes("Chocolate"), { a, dc });
const q1 = cake(iQty, 0), q2 = cake(iQty, 1);
check("Quantité 2 : deux étiquettes « 1/2 » et « 2/2 », identiques sinon", q1.marker === "1/2" && q2.marker === "2/2" && q1.productLine === q2.productLine && textOf(q1).includes("1/2") && textOf(q2).includes("2/2"));
const order13 = cakes.filter((c) => c.orderId === oMulti).map((c) => c.key);
check("Tri : par date puis commande, gâteaux d'une même ligne côte à côte", order13.join() === [`${iMultiA}-0`, `${iMultiB}-0`, `${iQty}-0`, `${iQty}-1`].join()
  && cakes.findIndex((c) => c.date === D2) > cakes.findLastIndex((c) => c.date === D1), order13);
check("Tri : ORD avant ORDM le même jour (ordre du numéro)", cakes.findIndex((c) => c.orderNumber === "ORD-261012-0001") < cakes.findIndex((c) => c.orderNumber === "ORDM-261012-0001"));

const lg = cake(iLong);
const lp = L.layoutCake(lg, measure);
check("Texte long : plusieurs étiquettes (« Suite »), jamais coupé", lp.length >= 2, lp.length);
check("Suite : reprend date, client, commande et « SUITE 2/n »", lp.slice(1).every((p) => { const t = L.pageText(p).join(" "); return t.includes("12.10.2026") && t.includes("Anne-Sophie") && t.includes("ORD-261012-0004") && t.includes(`SUITE ${p.index}/${p.count}`); }));
check("Suite : un bloc coupé reprend son intitulé « … (suite) »", lp.slice(1).every((p) => { const t = L.pageText(p); return t.some((x) => /\(SUITE\)$/.test(x)) || t.includes("TEXTE À ÉCRIRE"); }), lp.slice(1).map(L.pageText));
check("1ʳᵉ étiquette : renvoi « → Suite sur l'étiquette 2/n »", L.pageText(lp[0]).some((t) => t.startsWith("→ Suite sur l'étiquette 2/")));
const words = (t) => t.split(/\s+/).filter(Boolean);
const printed = words(lp.flatMap((p) => L.pageText(p)).join(" "));
check("Texte long : chaque mot du texte imprimé, dans l'ordre, sans perte", (() => { let k = 0; for (const w of words(longText)) { k = printed.indexOf(w, k); if (k < 0) return false; k++; } return true; })());
check("Décoration longue : toutes les couleurs présentes", ["Rose", "Lavande", "Jaune Pastel", "Vert Pastel", "Bleu Ciel", "Blanc", "Or", "Roses : Rose Foncé", "Intérieur : Rose", "Papillons : Or", "Cerises pailletées : Rouge", "Paillettes : Blanc"]
  .every((w) => nb(lg.colours).includes(w)), lg.colours);
const inBounds = pages.every((p) => p.ops.every((o) => o.type !== "text" || (o.x >= 16 && o.y >= 0 && o.y + o.font.size * 1.2 <= L.LABEL_H - 18 + 0.5
  && (o.align === "right" ? o.x - measure(o.text, o.font) >= 16 - 0.5 : o.x + measure(o.text, o.font) <= L.LABEL_W - 16 + 0.5))));
check("Toutes les étiquettes : texte dans les marges (2 mm), rien hors format", inBounds);
const minFont = Math.min(...pages.flatMap((p) => p.ops.filter((o) => o.type === "text").map((o) => o.font.size)));
const nameLines = L.wrap("Anne-Sophie de La Tour-Montgomery-Vallée", { size: 32, bold: true }, 352, measure);
check("Nom long : coupé après un trait d'union, jamais au milieu d'un mot", nameLines.every((l) => /(^|[\s-])[A-Za-zÀ-ÿ]+-?$/.test(l)) && nameLines.join(" ").replace(/- /g, "-") === "Anne-Sophie de La Tour-Montgomery-Vallée", nameLines);
check("Police jamais réduite : 20 points minimum (≈ 2,5 mm) même pour un texte long", minFont >= 20, minFont);

const e = cake(iEmpty);
const et = textOf(e).join(" | ");
check("Champs vides : masqués (ni Base, ni Design, ni Couleurs, ni Texte)", !/Base :|Design :|Déco :|Couleur déco|TEXTE|Couleur texte|Style texte/.test(et) && e.missing.length === 0, et);
const noFlavour = L.cakeLabelsFor({ ...items.find((i) => i.id === iEmpty), flavors: [], cake_text: "Bravo", text_color: null, order: { ...items.find((i) => i.id === iEmpty).order, first_name: "", last_name: "" } })[0];
check("Informations essentielles manquantes signalées (goût, client, couleur du texte), rien d'inventé", ["goût", "nom du client", "couleur du texte"].every((x) => noFlavour.missing.includes(x)) && noFlavour.flavour === null && noFlavour.textColour === null);

// Type de déco : noms du site (minuscules, répétés), quantités des commandes manuelles, couleurs à part.
const base0 = items.find((i) => i.id === iEmpty);
const deco = (extra) => L.cakeLabelsFor({ ...base0, extra })[0].decoType;
check("Déco du site : noms en minuscules, répétitions comptées, couleurs ignorées", deco("Gold leaves, Pearl border (each), Pearl border (each), Ribbon: Pink, Glitter: Gold") === "Feuilles d'or, Bordure de perles (chacune) ×2", deco("Gold leaves, Pearl border (each), Pearl border (each), Ribbon: Pink, Glitter: Gold"));
check("Déco d'une commande manuelle : « Scattered Pearls × 3 » → Perles éparpillées ×3", deco("Scattered Pearls × 3, Sprinkles") === "Perles éparpillées ×3, Vermicelles");
check("Déco inconnue ou kit (poches à douille) : rien d'inventé", deco("3 Piping Bags: Sky Blue, Pink, Pastel Orange") === null && deco(null) === null);
check("Style « Normal » affiché quand il y a un texte", L.cakeLabelsFor({ ...base0, cake_text: "Bravo", text_style: "normal" })[0].textStyle === "Normal"
  && L.cakeLabelsFor({ ...base0, cake_text: "Bravo", text_style: null })[0].textStyle === "Normal" && L.cakeLabelsFor({ ...base0, cake_text: null, text_style: null })[0].textStyle === null);
check("Majuscules : « MAJUSCULES »", lg.textStyle === "MAJUSCULES", lg.textStyle);

// ═══ Alertes (données de la fonction) ═══════════════════════════════════
const itA = items.find((i) => i.id === iMultiA), itQ = items.find((i) => i.id === iQty), itE = items.find((i) => i.id === iEmpty);
check("Fonction : 1 photo personnelle (la photo d'inspiration recopiée ne compte pas), 0 quand seule la photo du design", itA.reference_photos === 1 && itQ.reference_photos === 0, { a: itA.reference_photos, q: itQ.reference_photos });
check("Fonction : commentaire de commande signalé (présence seulement, sans le texte)", itE.order.has_comment === true && !JSON.stringify(items).includes("petit cœur") && !JSON.stringify(items).includes("photo-cliente"));
check("Alerte photo de référence", L.cakeLabelsFor(itA)[0].alerts.join() === L.ALERT_PHOTO);
check("Pas d'alerte photo pour la seule photo du design choisi", L.cakeLabelsFor(itQ).every((c) => c.alerts.length === 0));
check("Alerte commentaire (commande) sur le gâteau de la commande", L.cakeLabelsFor(itE)[0].alerts.join() === L.ALERT_COMMENT);
check("Commentaire sur l'article → alerte ; seule mention « photo choisie » → pas d'alerte",
  L.cakeLabelsFor({ ...itQ, item_comment: "Écrire en doré svp" })[0].alerts.includes(L.ALERT_COMMENT) && L.cakeLabelsFor({ ...itQ, item_comment: "[Preferred design: Option 2]" })[0].alerts.length === 0);
const both = L.cakeLabelsFor({ ...itA, order: { ...itA.order, has_comment: true } });
check("Commentaire de commande : alerte sur chaque gâteau de la commande, et les deux alertes ensemble", both[0].alerts.join() === `${L.ALERT_COMMENT},${L.ALERT_PHOTO}`
  && L.cakeLabelsFor({ ...itQ, order: { ...itQ.order, has_comment: true } }).every((c) => c.alerts.includes(L.ALERT_COMMENT)));
const longBoth = L.cakeLabelsFor({ ...items.find((i) => i.id === iLong), reference_photos: 2, order: { ...items.find((i) => i.id === iLong).order, has_comment: true } })[0];
const lpA = L.layoutCake(longBoth, measure);
check("Alertes sur CHAQUE étiquette (suites comprises), triangle dessiné devant chaque alerte", lpA.length >= 2 && lpA.every((p) => { const t = L.pageText(p).join(" "); return t.includes(L.ALERT_COMMENT) && t.includes(L.ALERT_PHOTO) && p.ops.filter((o) => o.type === "warn").length === 2; }), lpA.map(L.pageText));
check("Alertes jamais coupées : bandeau dans la zone imprimable, triangle dessiné", lpA.every((p) => p.ops.filter((o) => o.type === "fill").every((o) => o.y + o.h <= L.LABEL_H - 18 + 0.5) && p.ops.some((o) => o.type === "warn")));
check("Texte long + alertes : aucun mot perdu", (() => { const printed = lpA.flatMap(L.pageText).join(" ").split(/\s+/); let k = 0; for (const w of longText.split(/\s+/)) { k = printed.indexOf(w, k); if (k < 0) return false; k++; } return true; })());
check("Excel : colonne Alertes et lignes « ATTENTION : … » dans Détails", L.niimbotRow(both[0]).Alertes === `ATTENTION : ${L.ALERT_COMMENT}\nATTENTION : ${L.ALERT_PHOTO}` && L.niimbotRow(both[0]).Détails.includes("ATTENTION : PHOTO"));

// ═══ Inspirations : caractéristiques de référence ═══════════════════════
const inspSrc = fs.readFileSync(path.join(REPO, "src/data/inspirations.ts"), "utf8");
const gallery = [...inspSrc.matchAll(/\{ id: "(inspiration-\d+)", src/g)].map((m) => m[1]);
const refs = Object.entries(R.INSPIRATION_REFERENCE);
check("Référence : 82 inspirations, une par photo de la galerie", refs.length === 82 && gallery.length === 82);
check("Référence : chaque n° de galerie pointe la bonne photo (aucun décalage)", gallery.every((id, k) => R.INSPIRATION_REFERENCE[id]?.position === k + 1), gallery.filter((id, k) => R.INSPIRATION_REFERENCE[id]?.position !== k + 1));
const custSrc = fs.readFileSync(path.join(REPO, "src/data/customization.ts"), "utf8");
const styleNames = [...custSrc.matchAll(/id: "[^"]+", name: "([^"]+)", price:/g)].map((m) => m[1].toLowerCase());
const usedNames = new Set(refs.flatMap(([, r]) => (r.design ?? "").split(" + ").map((x) => x.replace(/\s*\(.*\)$|,.*$/, "").trim())).filter(Boolean));
const unknown = [...usedNames].filter((n) => !styleNames.includes(n.toLowerCase()) && !/^(Rainbow|Chequered|Pearl Border|Normal without border, style|Normal without border \+ fleurs)$/.test(n) && n !== "fleurs");
check("Référence : noms de design = ceux du catalogue (sauf ceux signalés à vérifier)", unknown.length === 0, unknown);
const r1 = R.INSPIRATION_REFERENCE["inspiration-14"], r30 = R.INSPIRATION_REFERENCE["inspiration-29"], r82 = R.INSPIRATION_REFERENCE["inspiration-83"];
check("Dictée respectée : #1 Bordeaux / Bordeaux / cerises pailletées / écriture non précisée", r1.position === 1 && r1.base === "Bordeaux" && r1.decoration === "Bordeaux" && r1.extras.join() === "Cerises pailletées" && r1.writingColour === null);
check("Rien d'inventé : #82 base non répartie (null + à vérifier), #30 écart photo signalé", r82.base === null && r82.decoration === null && r82.toCheck.length === 1 && r30.base === "Rouge" && r30.toCheck.some((x) => /rose foncé/.test(x)));
const inspItem = { ...itE, design: "inspiration-22", base_color: null, decoration_color: null, extra: null, text_color: null, text_style: null, cake_text: "Bravo", item_comment: null, order: { ...itE.order, has_comment: false } };
const li = L.cakeLabelsFor(inspItem)[0];
check("Étiquette d'inspiration : n° de galerie (pas l'identifiant interne) et design de référence", li.design === "Inspiration n°3 — Pearl Border × Retro", li.design);
check("Champs vides de la commande remplis par la référence, marqués « (réf.) »", li.base === "Rose clair (réf.)" && li.colours === "Rose foncé (réf.)" && li.decoType === "Bordure de perles (réf.)" && li.textColour === "Rose foncé (réf.)", li);
const own = L.cakeLabelsFor({ ...inspItem, base_color: "black", decoration_color: "white", extra: "Cherries", text_color: "midnight-blue" })[0];
check("Les choix de la commande ne sont jamais écrasés par la référence", own.base === "Noir" && own.colours === "Blanc" && own.decoType === "Cerises" && own.textColour === "Bleu Nuit", own);
const st23 = (style) => L.cakeLabelsFor({ ...inspItem, design: "inspiration-21", text_style: style })[0].textStyle;
check("Style d'écriture de référence (« En perles ») si la commande n'a qu'un style normal ; choix explicite prioritaire", st23("normal") === "En perles (réf.)" && st23(null) === "En perles (réf.)" && st23("cursive") === "Cursive");
check("Gâteau hors inspiration : aucune valeur de référence", !Object.values(L.cakeLabelsFor(itE)[0]).some((v) => typeof v === "string" && v.includes("(réf.)")));

const rows = cakes.map(L.niimbotRow);
check("Excel NIIMBOT : une ligne par gâteau (quantité comprise), colonnes fixes", rows.length === cakes.length && Object.keys(rows[0]).join() === L.NIIMBOT_COLUMNS.join());
const rl = L.niimbotRow(lg);
check("Excel NIIMBOT : texte exact et « Détails » sans ligne vide", rl.Texte === longText && !rl.Détails.split("\n").some((x) => !x.trim()) && L.niimbotRow(e).Détails === "Bento Cake · Bento · Rond\nGoût : Vanilla\nATTENTION : COMMENTAIRE CLIENT À LIRE");

// ═══ Site ═══════════════════════════════════════════════════════════════
const src = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
check("Page : aucun bouton « Imprimer directement »", !/Imprimer directement|Print directly|window\.print/.test(src("src/pages/AdminLabels.tsx")));
check("Page : appelle seulement get-orders-for-labels (lecture), aucun e-mail", (src("src/pages/AdminLabels.tsx").match(/functions\.invoke\("([^"]+)"/g) ?? []).join() === 'functions.invoke("get-orders-for-labels"' && !/email|send-/.test(src("src/lib/productionLabelsExport.ts")));
check("Fiche commande : lien vers l'étiquette de ce gâteau", /\/admin\/labels\?order=\$\{order\?\.id \?\? ""\}&item=\$\{item\.id\}/.test(src("src/pages/AdminOrder.tsx")));
check("Agenda : lien « Étiquettes de production » conservé", src("src/pages/AdminCalendar.tsx").includes('to="/admin/labels"'));

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
