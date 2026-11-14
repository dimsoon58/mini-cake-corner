// Étiquettes de workshop (10.11.2026) : une par gâteau, au nom de la personne
// qui a réservé — vrai code du site (src/lib/productionLabels.ts).
//
//   cd supabase/tests/refunds
//   npm install --no-save esbuild
//   node test_workshop_labels.mjs
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

const REPO = path.resolve(import.meta.dirname, "../../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wsl-"));
await build({ entryPoints: [path.join(REPO, "src/lib/productionLabels.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "labels.mjs"), logLevel: "error",
  alias: { "@": path.join(REPO, "src") }, loader: { ".jpg": "file", ".png": "file", ".webp": "file" } });
const { workshopCakeLabels, mergeByDate, layoutCake, pageText, defaultSelectedKeys } = await import(path.join(tmp, "labels.mjs"));
let ok = 0, ko = 0; const check = (n, c, x) => { c ? ok++ : ko++; console.log(c ? "PASS" : "FAIL", n, c ? "" : JSON.stringify(x)); };
const base = { orderId: "o1", orderNumber: "ORDM-1", customerName: "Claire Dupont", type: "paint", date: "2026-11-14", time: "18:00:00", perParticipant: 1, badge: null, isTest: false };
const L = workshopCakeLabels([
  { ...base, itemId: "a", vanilla: 1, chocolate: 1, unknown: 0 },
  { ...base, itemId: "b", customerName: "Lea Martin", orderNumber: "ORD-9", type: "signature", vanilla: 0, chocolate: 0, unknown: 1, badge: "awaiting_payment" },
  { ...base, itemId: "c", vanilla: 1, chocolate: 0, unknown: 0, perParticipant: 2 },
]);
check("1 une étiquette par gâteau (2 + 1 + 2)", L.length === 5, L.length);
const a = L.filter((l) => l.itemId === "a");
check("2 réservation de 2 : 1/2 et 2/2, vanille puis chocolat", a[0].marker === "1/2" && a[1].marker === "2/2" && a[0].flavour === "Génoise vanille" && a[1].flavour === "Génoise chocolat", a);
check("3 en-tête : date et heure, nom, n° de commande", a[0].dateText === "14.11.2026 · 18:00" && a[0].customer === "Claire Dupont" && a[0].orderNumber === "ORDM-1", a[0]);
check("4 produit : Workshop Peinture · Bento", a[0].productLine === "Workshop Peinture · Bento", a[0].productLine);
const b = L.find((l) => l.itemId === "b");
check("5 Signature = Retro Box, place seule sans repère", b.productLine === "Workshop Signature · Retro Box" && b.marker === null, b);
check("6 génoise inconnue : « à confirmer » + manque signalé", b.flavour === "Génoise à confirmer" && b.missing.length === 1, b);
check("7 2 gâteaux par participant → 2 étiquettes", L.filter((l) => l.itemId === "c").length === 2);
check("8 marqué workshop, clés uniques", L.every((l) => l.workshop) && new Set(L.map((l) => l.key)).size === 5);
check("9 en attente de paiement gardé (badge)", b.badge === "awaiting_payment");
check("10 cochés par défaut (pas « à accepter »)", defaultSelectedKeys(L).length === 5);
const cake = { key: "x", itemId: "x", orderId: "x", date: "2026-11-14", dateText: "14.11.2026", customer: "Z", orderNumber: "ORD-1", marker: null, productLine: "Bento rond", flavour: "Vanilla", base: null, design: null, decoType: null, colours: null, cakeText: null, textColour: null, textStyle: null, missing: [], alerts: [], isTest: false, badge: null };
const early = { ...cake, key: "y", date: "2026-11-13" };
const m = mergeByDate([early, cake], L);
check("11 fusion par date : 13.11 puis gâteaux du 14.11 puis workshops", m[0].key === "y" && m[1].key === "x" && m[2].workshop === true, m.map((x) => x.key));
const measure = (t, f) => t.length * f.size * 0.55;
const txt = pageText(layoutCake(a[1], measure)[0]).join(" ").replace(/\s+/g, " ");
check("12 texte imprimé", /14\.11\.2026 · 18:00/.test(txt) && /Claire Dupont/.test(txt) && /ORDM-1/.test(txt) && /2\/2/.test(txt) && /Workshop Peinture · Bento/.test(txt) && /Génoise chocolat/.test(txt), txt);
// F45 : Pochage avec génoise et couleur par participant
const P = workshopCakeLabels([{ ...base, itemId: "p", type: "piping", time: "19:00", vanilla: 1, chocolate: 1, unknown: 0,
  participants: [{ sponge: "chocolate", colour: "pastel-pink" }, { sponge: "vanilla", colour: "sky-blue" }] }]);
check("13 Pochage : génoise et couleur dans l'ordre des participants", P.length === 2 && P[0].flavour === "Génoise chocolat" && P[0].base === "Rose Pastel" && P[1].flavour === "Génoise vanille" && P[1].base === "Bleu Ciel", P);
check("14 Pochage = Retro Box", P[0].productLine === "Workshop Pochage · Retro Box", P[0].productLine);
const Q = workshopCakeLabels([{ ...base, itemId: "q", type: "piping", vanilla: 1, chocolate: 0, unknown: 0, participants: [{ sponge: "vanilla", colour: null }] }]);
check("15 Pochage sans couleur : signalé « couleur de base »", Q[0].missing.includes("couleur de base"), Q[0].missing);
const ptxt = pageText(layoutCake(P[0], () => 1)[0]).join(" ");
check("16 texte imprimé : Base : Rose Pastel", /Base :/.test(ptxt) && /Rose Pastel/.test(ptxt), ptxt);
console.log(`\n${ok} PASS, ${ko} FAIL`);
process.exit(ko ? 1 : 0);
