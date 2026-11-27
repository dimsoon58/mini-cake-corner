// Extra « Gender Reveal » (27.11.2026) — commandes manuelles de l'admin :
// intérieur Rose / Bleu sur n'importe quel design, prix du design Gender
// Reveal (Bento 5, Retro 7, Medium 10, Large 15, Rectangle 40) ; une fois ;
// pas sur le design Gender Reveal ; jamais la couleur dans les textes vus par
// la cliente ; jamais proposé au panier public.
// Aucun réseau.
//   node test_manual_gender_reveal.mjs   (esbuild installé, voir README)
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const FN = path.join(REPO, "supabase/functions");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gr-"));
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) { pass++; console.log("PASS", msg); } else { fail++; console.log("FAIL", msg, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ""); } };

// ── Serveur ─────────────────────────────────────────────────────────────
const sEntry = path.join(tmp, "server.ts");
fs.writeFileSync(sEntry, [
  `export { quoteManualOrder } from ${JSON.stringify(path.join(FN, "_shared/manual-order-quote.ts"))};`,
  `export { buildManualOrderCatalog } from ${JSON.stringify(path.join(FN, "_shared/manual-order-catalog.ts"))};`,
  `export { CAKE_EXTRAS } from ${JSON.stringify(path.join(FN, "_shared/pricing.ts"))};`,
  `export { extrasPrice, buildItemRow } from ${JSON.stringify(path.join(FN, "manage-manual-order/rows.ts"))};`,
].join("\n"));
await build({ entryPoints: [sEntry], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "s.mjs"), logLevel: "error" });
const S = await import(path.join(tmp, "s.mjs"));
const sb = { rpc: async () => ({ data: [], error: null }) };
const PRICES = { bento: 5, retro: 7, medium: 10, large: 15, rectangle: 40 };

const cat = await S.buildManualOrderCatalog(sb);
for (const size of Object.keys(PRICES)) ok(cat.cake.extras[size].includes("gender-reveal"), `Formulaire : Gender Reveal proposé en ${size}`);
ok(JSON.stringify(S.CAKE_EXTRAS["gender-reveal"]) === JSON.stringify(PRICES), "Prix serveur = design Gender Reveal", S.CAKE_EXTRAS["gender-reveal"]);

const cake = (size, extras, design = "heart-bomb") => ({
  product: size === "rectangle" ? "rectangle_cake" : "bento_cake", size, shape: size === "rectangle" ? null : "round",
  design: size === "rectangle" ? "rectangle-signature" : design, flavors: ["vanilla"], extras, candles: [],
});
const quote = (items) => S.quoteManualOrder(sb, { items, fulfillments: [{ date: "2026-12-02", deliveryMethod: "pickup", slot: "14:00 – 15:00", itemIndexes: items.map((_, i) => i) }] });
for (const [size, p] of Object.entries(PRICES)) {
  const d = size === "bento" ? "normal-without-border" : "heart-bomb";
  const without = (await quote([cake(size, [], d)])).items[0];
  const withGr = (await quote([cake(size, ["gender-reveal"], d)])).items[0];
  ok(!without.error && !withGr.error && withGr.total === without.total + p, `Devis : ${size} avec Gender Reveal = sans + ${p}`, { without, withGr });
  ok(S.extrasPrice(cake(size, ["gender-reveal"], d)) === p, `Enregistrement : prix des extras ${size} = ${p}`);
}
const twice = (await quote([cake("medium", ["gender-reveal", "gender-reveal"])])).items[0];
ok(!!twice.error, "Devis : Gender Reveal deux fois refusé", twice);
const onDesign = (await quote([cake("medium", ["gender-reveal"], "gender-reveal")])).items[0];
ok(!!onDesign.error, "Devis : extra Gender Reveal sur le design Gender Reveal refusé", onDesign);
const designOnly = (await quote([cake("medium", [], "gender-reveal")])).items[0];
ok(!designOnly.error, "Devis : design Gender Reveal seul toujours accepté", designOnly);

// ── Site (admin) ───────────────────────────────────────────────────────
const fEntry = path.join(tmp, "front.ts");
fs.writeFileSync(fEntry, `export * from "@/lib/manualOrders";\nexport { extraNameFr } from "@/data/catalogLabelsFr";\nexport { withoutInsideColour, ADMIN_ONLY_EXTRAS } from "@/data/customization";`);
const empty = Object.fromEntries([".jpg", ".jpeg", ".png", ".webp", ".svg", ".mp4", ".mov", ".gif"].map((e) => [e, "empty"]));
await build({ entryPoints: [fEntry], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "f.mjs"), logLevel: "error",
  alias: { "@": path.join(REPO, "src") }, loader: empty, define: { "import.meta.env": "{}" } });
const M = await import(path.join(tmp, "f.mjs"));
ok(M.labelExtra("gender-reveal") === "Gender Reveal", "Formulaire : nom « Gender Reveal »");
ok(M.extraNameFr["gender-reveal"] === "Gender Reveal", "Nom français « Gender Reveal »");
ok(M.INSIDE_COLOURS.map((c) => c.id).join(",") === "Rose,Bleu", "Les 2 couleurs : Rose et Bleu");
const ed = (extras, inside, design = "heart-bomb") => ({ ...cake("medium", extras, design), fruit_supplement: null, custom_extras: [], ribbon_color: "", butterfly_color: "", glitter_color: "", glitter_cherries_color: "", inside_color: inside });
ok(M.colourNeeds(ed(["gender-reveal"], "")).inside, "Extra coché → couleur intérieure demandée");
ok(!M.colourNeeds(ed([], "")).inside, "Sans l'extra → pas de couleur intérieure");
ok(M.missingColours(ed(["gender-reveal"], ""), "fr").includes("couleur intérieure"), "Sans couleur choisie → enregistrement bloqué");
ok(M.missingColours(ed(["gender-reveal"], "Bleu"), "fr").length === 0, "Avec Bleu → OK");
const ef = M.extraFields(ed(["gender-reveal"], "Rose"));
ok(ef.inside_color === "Rose", "inside_color = Rose (admin, étiquette)", ef);
ok(ef.extra === "Gender Reveal" && !/Rose|Bleu|Pink|Blue/i.test(`${ef.extra} ${ef.extra_color ?? ""}`), "Texte vu par la cliente : « Gender Reveal » sans couleur", ef);
const efOff = M.extraFields(ed([], "Rose"));
ok(efOff.inside_color === null, "Extra décoché → couleur intérieure pas envoyée", efOff);
const row = S.buildItemRow({ ...ed(["gender-reveal"], "Bleu"), extra: ef.extra, inside_color: "Bleu" }, { total: 1 }, "o1", "f1");
ok(row.inside_color === "Bleu" && row.extra === "Gender Reveal", "Ligne enregistrée : extra « Gender Reveal », inside_color Bleu", row);

// ── Site public ─────────────────────────────────────────────────────────
ok(M.ADMIN_ONLY_EXTRAS.includes("gender-reveal") && M.ADMIN_ONLY_EXTRAS.includes("gems"), "Panier public : Gender Reveal et Gems réservés à l'admin");
ok(M.withoutInsideColour("Border: Pink, Inside: Blue") === "Border: Pink", "Récap cliente : « Inside: … » retiré");
ok(M.withoutInsideColour("Inside: Pink") === "", "Récap cliente : rien si seulement la couleur intérieure");
const catalogPage = fs.readFileSync(path.join(REPO, "src/pages/Catalog.tsx"), "utf8");
ok(!/push\(`Inside:/.test(catalogPage), "Catalogue : la couleur intérieure n'est plus ajoutée au récap");

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
