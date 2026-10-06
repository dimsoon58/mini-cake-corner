// Commandes manuelles — couleurs des options (rubans, papillon, paillettes,
// cerises pailletées, intérieur Gender Reveal), 05.10.2026. Vérifie que
// l'éditeur propose EXACTEMENT les couleurs du site (listes lues dans
// src/pages/Catalog.tsx), les mêmes règles « quelle option demande quelle
// couleur », et le même format enregistré que le checkout. Aucun réseau.
//
//   cd supabase/tests/refunds
//   npm install --no-save esbuild
//   node test_manual_colours.mjs
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

const REPO = path.resolve(import.meta.dirname, "../../..");
let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ""); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-"));
const entry = path.join(tmp, "entry.ts");
fs.writeFileSync(entry, `export * from "@/lib/manualOrders";`);
const empty = Object.fromEntries([".jpg", ".jpeg", ".png", ".webp", ".svg", ".mp4", ".mov", ".gif"].map((e) => [e, "empty"]));
await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "m.mjs"), logLevel: "error",
  alias: { "@": path.join(REPO, "src") }, loader: empty, define: { "import.meta.env": "{}" } });
const M = await import(path.join(tmp, "m.mjs"));

// ── 1. Mêmes listes que la page du site ─────────────────────────────────
const catalog = fs.readFileSync(path.join(REPO, "src/pages/Catalog.tsx"), "utf8");
const siteList = (name) => {
  const m = catalog.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  return m ? [...m[1].matchAll(/\{ id: "([^"]+)", name: "([^"]+)", color: "([^"]+)" \}/g)].map((x) => `${x[1]}|${x[2]}|${x[3]}`) : null;
};
const mine = (list) => list.map((c) => `${c.id}|${c.name}|${c.color}`);
for (const [site, own] of [["ribbonColors", "RIBBON_COLOURS"], ["butterflyColors", "BUTTERFLY_COLOURS"], ["glitterColors", "GLITTER_COLOURS"], ["glitterCherriesColors", "GLITTER_CHERRIES_COLOURS"], ["baseColors", "COLOURS"]]) {
  const s = siteList(site);
  check(`${own} = ${site} du site (mêmes couleurs, même ordre)`, s && s.length > 0 && JSON.stringify(s) === JSON.stringify(mine(M[own])), { site: s, admin: mine(M[own]) });
}
const gender = [...(catalog.match(/const genderColors = \[([\s\S]*?)\];/)?.[1] ?? "").matchAll(/name: "([^"]+)", color: "([^"]+)"/g)].map((x) => `${x[1]}|${x[2]}`);
check("Intérieur Gender Reveal : Pink / Blue, mêmes teintes que le site", JSON.stringify(gender) === JSON.stringify(M.INSIDE_COLOURS.map((c) => `${c.name}|${c.color}`)), { gender });

// ── 2. Règles : quelle option / quel design demande quelle couleur ──────
const item = (o = {}) => ({ ...M.emptyItem("bento_cake"), size: "medium", ...o });
const n = (o) => M.colourNeeds(item(o));
check("Aucune option : aucune couleur demandée", Object.values(n({})).every((v) => v === false));
check("Rubans (extra) → couleur des rubans", n({ extras: ["ribbons"] }).ribbon && !n({ extras: ["ribbons"] }).glitter);
check("Papillon (extra) → couleur du papillon", n({ extras: ["butterfly"] }).butterfly);
for (const g of ["glitter", "glitter-base", "glitter-in-the-air"]) check(`${g} → couleur des paillettes`, n({ extras: [g] }).glitter);
check("Paillettes « in the air » : rose uniquement (comme le site)", JSON.stringify(M.glitterChoices(n({ extras: ["glitter-in-the-air"] })).map((c) => c.id)) === '["pink"]'
  && M.glitterChoices(n({ extras: ["glitter"] })).length === 5);
check("Cerises pailletées → couleur proposée, facultative", n({ extras: ["glitter-cherries"] }).glitterCherries && M.missingColours(item({ extras: ["glitter-cherries"] }), "fr").length === 0);
check("Design Retro × Ribbons → rubans ; Retro Glitter → paillettes ; Butterfly Garden → papillon",
  n({ design: "retro-ribbons" }).ribbon && n({ design: "retro-glitter-cake" }).glitter && n({ design: "butterfly-garden" }).butterfly);
check("Design Retro × Ribbons Glitter in the Air → rubans + paillettes roses", n({ design: "retro-ribbons-glitter" }).ribbon && n({ design: "retro-ribbons-glitter" }).glitterPinkOnly);
check("Design Glitter Cherries × Retro → cerises ; Gender Reveal → intérieur", n({ design: "glitter-cherries-retro" }).glitterCherries && n({ design: "gender-reveal" }).inside);
check("Dot cakes / kit : jamais de couleur d'option", Object.values(M.colourNeeds({ ...M.emptyItem("diy_kit"), extras: ["ribbons"] })).every((v) => !v));

// ── 3. Obligatoire pour confirmer (comme le « * » du site) ──────────────
check("Rubans + papillon + paillettes sans couleur : 3 manques", JSON.stringify(M.missingColours(item({ extras: ["ribbons", "butterfly", "glitter"] }), "fr")) === JSON.stringify(["couleur des rubans", "couleur du papillon", "couleur des paillettes"]));
check("Paillettes « in the air » avec « Gold » : refusé (rose seulement)", M.missingColours(item({ extras: ["glitter-in-the-air"], glitter_color: "Gold" }), "fr").includes("couleur des paillettes"));
check("Gender Reveal sans intérieur : manque", M.missingColours(item({ design: "gender-reveal" }), "fr").includes("couleur intérieure"));
check("Tout choisi : rien ne manque", M.missingColours(item({ extras: ["ribbons", "butterfly", "glitter"], ribbon_color: "Baby Pink", butterfly_color: "Gold", glitter_color: "White" }), "fr").length === 0);

// ── 4. Même format enregistré que le checkout ───────────────────────────
let f = M.extraFields(item({ extras: ["ribbons", "glitter", "glitter-cherries", "butterfly"], ribbon_color: "Baby Pink", glitter_color: "Gold", glitter_cherries_color: "Pink", butterfly_color: "Blue" }));
check("extra : noms + « Ribbon: … », « Butterfly: … », « Glitter: … », « Glitter Cherries: … » (ordre du checkout)",
  /Ribbon: Baby Pink, Butterfly: Blue, Glitter: Gold, Glitter Cherries: Pink$/.test(f.extra), f.extra);
check("extra_color = couleurs seules ; ribbon_color / butterfly_color dans leurs colonnes",
  f.extra_color === "Baby Pink, Blue, Gold, Pink" && f.ribbon_color === "Baby Pink" && f.butterfly_color === "Blue" && f.inside_color === null, f);
f = M.extraFields(item({ extras: ["gold-leaves"], ribbon_color: "Black", glitter_color: "Gold", butterfly_color: "Pink" }));
check("Option décochée : sa couleur n'est plus envoyée", f.ribbon_color === null && f.butterfly_color === null && f.extra_color === null && !/Ribbon|Glitter|Butterfly/.test(f.extra ?? ""), f);
f = M.extraFields(item({ design: "gender-reveal", inside_color: "Rose" }));
check("Gender Reveal : inside_color « Rose » (comme le checkout)", f.inside_color === "Rose");
check("Relecture d'une commande : paillettes retrouvées depuis extra", JSON.stringify(M.coloursFromExtra("Glitter, Glitter Cherries, Glitter: Gold, Glitter Cherries: Pink")) === JSON.stringify({ glitter_color: "Gold", glitter_cherries_color: "Pink" })
  && JSON.stringify(M.coloursFromExtra(null)) === JSON.stringify({ glitter_color: "", glitter_cherries_color: "" }));

// ── 5. Dates : rien à choisir pour une commande de workshops seuls ──────
const editor = fs.readFileSync(path.join(REPO, "src/pages/AdminManualOrderEditor.tsx"), "utf8");
check("Éditeur : section Dates masquée tant qu'il n'y a que des workshops, rouverte dès un produit physique",
  /const hasPhysicalItem = items\.some\(\(it\) => it\.product !== "workshop"\)/.test(editor)
  && /\{!hasPhysicalItem \? \(\s*<p[^>]*data-testid="dates-workshop-only"/.test(editor));
check("Éditeur : la date n'est exigée pour confirmer que s'il y a un produit physique",
  /if \(physical && groups\.some\(\(g\) => !g\.date\)\)/.test(editor));
check("Éditeur : seules les dates qui portent un produit physique sont envoyées au serveur",
  /itemIndexes: items\.map\(\(it, i\) => \(it\.product !== "workshop"/.test(editor) && /\.filter\(\(f\) => f\.itemIndexes\.length > 0\)/.test(editor));

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
