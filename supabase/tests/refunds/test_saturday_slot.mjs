// Samedi : un seul créneau, 11:00 – 12:00 (retrait et livraison), sur le site.
// Vrai code serveur (_shared/order-pricing.ts resolveOneFulfillment) et vrai
// code du site (src/lib/orderDates.ts slotsForDate). Sans base, sans réseau.
//
//   cd supabase/tests/refunds
//   npm install --no-save esbuild
//   node test_saturday_slot.mjs
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SRC = path.resolve(ROOT, "../src");
let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ""); } };
globalThis.fetch = async () => { throw new Error("réseau interdit dans ce test"); };
globalThis.Deno = { env: { get: () => undefined } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sat-"));
async function load(entry, name) {
  const out = path.join(tmp, `${name}.mjs`);
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error",
    plugins: [{ name: "m", setup(b) { b.onResolve({ filter: /^(https:|npm:)/ }, () => ({ path: path.join(tmp, "empty.mjs") })); } }] });
  return import(out);
}
fs.writeFileSync(path.join(tmp, "empty.mjs"), "export default {}; export const serve = () => {}; export const createClient = () => ({});");
const server = await load(path.join(ROOT, "functions/_shared/order-pricing.ts"), "pricing");
const site = await load(path.join(SRC, "lib/orderDates.ts"), "dates");

// Prochain samedi et prochain vendredi à au moins 7 jours (hors délai minimum et hors express).
const zToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
const nextDow = (dow) => { const d = new Date(`${zToday}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const SAT = nextDow(6), FRI = nextDow(5);
const resolve = (date, slot, method = "pickup", options) =>
  server.resolveOneFulfillment({ date, deliveryMethod: method, slot, itemIndexes: [0] }, 60, options).then(() => "ok", (e) => String(e.message));

check("Même créneau du samedi sur le site et le serveur (tiret demi-cadratin)", server.SATURDAY_SLOT === "11:00 – 12:00" && site.SATURDAY_SLOT === server.SATURDAY_SLOT);
check(`Serveur : samedi ${SAT} 11:00 – 12:00 en retrait accepté`, (await resolve(SAT, "11:00 – 12:00")) === "ok");
const refused = await resolve(SAT, "15:00 – 16:00");
check("Serveur : samedi 15:00 – 16:00 en retrait refusé (SATURDAY_SLOT)", refused.startsWith("SATURDAY_SLOT:"), refused);
const refusedDelivery = await resolve(SAT, "09:00 – 10:00", "delivery");
check("Serveur : samedi 09:00 – 10:00 en livraison refusé avant tout calcul de livraison", refusedDelivery.startsWith("SATURDAY_SLOT:"), refusedDelivery);
check(`Serveur : vendredi ${FRI} 15:00 – 16:00 accepté (semaine inchangée)`, (await resolve(FRI, "15:00 – 16:00")) === "ok");
check("Serveur : commande manuelle (allowAnySlot) un samedi à 15:00 – 16:00 acceptée",
  (await resolve(SAT, "15:00 – 16:00", "pickup", { minLeadDays: 0, allowClosedDays: true, allowAnySlot: true, shortNoticeExpress: true })) === "ok");
check("Serveur : le flux admin passe bien allowAnySlot", fs.readFileSync(path.join(ROOT, "functions/_shared/manual-order-quote.ts"), "utf8").includes("allowAnySlot: true"));
check("Serveur : samedi sans créneau (comme avant) non bloqué par cette règle", (await resolve(SAT, null)) === "ok");

const P = ["10:00 – 11:00", "11:00 – 12:00", "17:00 – 18:00"];
check("Site : samedi → seulement 11:00 – 12:00 (date texte et Date)", site.slotsForDate(P, SAT).join() === "11:00 – 12:00" && site.slotsForDate(P, new Date(`${SAT}T00:00:00`)).join() === "11:00 – 12:00");
check("Site : vendredi et sans date → tous les créneaux", site.slotsForDate(P, FRI).length === 3 && site.slotsForDate(P, null).length === 3);
const checkout = fs.readFileSync(path.join(SRC, "pages/Checkout.tsx"), "utf8");
check("Site : les 4 listes de créneaux de la page de paiement passent par slotsForDate",
  !/\{(PICKUP|DELIVERY)_TIME_SLOTS\.map/.test(checkout) && (checkout.match(/slotsForDate\(/g) ?? []).length >= 6);
check("Site : admin (commandes manuelles) garde tous les créneaux", !fs.readFileSync(path.join(SRC, "lib/manualOrders.ts"), "utf8").includes("slotsForDate"));

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
