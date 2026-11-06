// Samedi, sur le site : retrait 11:00 – 12:00 seulement ; livraison jusqu'à
// 13:00 (06.11.2026).
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
// (en sautant les jours de fermeture, ex. 13–14.11.2026)
const nextDow = (dow) => { const d = new Date(`${zToday}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); while (d.getUTCDay() !== dow || site.CLOSED_DATES.includes(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const SAT = nextDow(6), FRI = nextDow(5);
const resolve = (date, slot, method = "pickup", options) =>
  server.resolveOneFulfillment({ date, deliveryMethod: method, slot, itemIndexes: [0] }, 60, options).then(() => "ok", (e) => String(e.message));

check("Même créneau du samedi sur le site et le serveur (tiret demi-cadratin)", server.SATURDAY_SLOT === "11:00 – 12:00" && site.SATURDAY_SLOT === server.SATURDAY_SLOT);
check(`Serveur : samedi ${SAT} 11:00 – 12:00 en retrait accepté`, (await resolve(SAT, "11:00 – 12:00")) === "ok");
const refused = await resolve(SAT, "15:00 – 16:00");
check("Serveur : samedi 15:00 – 16:00 en retrait refusé (SATURDAY_SLOT)", refused.startsWith("SATURDAY_SLOT:"), refused);
const delivOk = await resolve(SAT, "08:00 – 09:00", "delivery");
check("Serveur : samedi 08:00 – 09:00 en livraison passe la règle du samedi", !delivOk.startsWith("SATURDAY_SLOT:"), delivOk);
const deliv12 = await resolve(SAT, "12:00 – 13:00", "delivery");
check("Serveur : samedi 12:00 – 13:00 en livraison passe la règle du samedi", !deliv12.startsWith("SATURDAY_SLOT:"), deliv12);
const refusedDelivery = await resolve(SAT, "13:00 – 14:00", "delivery");
check("Serveur : samedi 13:00 – 14:00 en livraison refusé avant tout calcul de livraison", refusedDelivery.startsWith("SATURDAY_SLOT:"), refusedDelivery);
const refusedPickup12 = await resolve(SAT, "12:00 – 13:00", "pickup");
check("Serveur : samedi 12:00 – 13:00 en retrait toujours refusé", refusedPickup12.startsWith("SATURDAY_SLOT:"), refusedPickup12);
check(`Serveur : vendredi ${FRI} 15:00 – 16:00 accepté (semaine inchangée)`, (await resolve(FRI, "15:00 – 16:00")) === "ok");
check("Serveur : commande manuelle (allowAnySlot) un samedi à 15:00 – 16:00 acceptée",
  (await resolve(SAT, "15:00 – 16:00", "pickup", { minLeadDays: 0, allowClosedDays: true, allowAnySlot: true, shortNoticeExpress: true })) === "ok");
check("Serveur : le flux admin passe bien allowAnySlot", fs.readFileSync(path.join(ROOT, "functions/_shared/manual-order-quote.ts"), "utf8").includes("allowAnySlot: true"));
check("Serveur : samedi sans créneau (comme avant) non bloqué par cette règle", (await resolve(SAT, null)) === "ok");

const checkout = fs.readFileSync(path.join(SRC, "pages/Checkout.tsx"), "utf8");
const P = ["10:00 – 11:00", "11:00 – 12:00", "17:00 – 18:00"];
check("Site : samedi → seulement 11:00 – 12:00 (date texte et Date)", site.slotsForDate(P, SAT).join() === "11:00 – 12:00" && site.slotsForDate(P, new Date(`${SAT}T00:00:00`)).join() === "11:00 – 12:00");
const D = ["08:00 – 09:00", "11:00 – 12:00", "12:00 – 13:00", "13:00 – 14:00", "19:00 – 20:00"];
check("Site : samedi en livraison → créneaux jusqu'à 13:00", site.slotsForDate(D, SAT, "delivery").join() === "08:00 – 09:00,11:00 – 12:00,12:00 – 13:00", site.slotsForDate(D, SAT, "delivery"));
check("Site : vendredi en livraison → tous les créneaux", site.slotsForDate(D, FRI, "delivery").length === 5);
check("Site : phrase du samedi propre à la livraison", site.slotRuleCopy(SAT, "delivery").fr === "Le samedi, livraison jusqu'à 13:00." && site.slotRuleCopy(SAT).fr.includes("11:00 – 12:00"));
check("Site : les listes de livraison passent « delivery »", (checkout.match(/slotsForDate\(DELIVERY_TIME_SLOTS, [a-zA-Z.]+, "delivery"\)/g) ?? []).length === 4);
check("Site : vendredi et sans date → tous les créneaux", site.slotsForDate(P, FRI).length === 3 && site.slotsForDate(P, null).length === 3);
check("Site : les 4 listes de créneaux de la page de paiement passent par slotsForDate",
  !/\{(PICKUP|DELIVERY)_TIME_SLOTS\.map/.test(checkout) && (checkout.match(/slotsForDate\(/g) ?? []).length >= 6);
check("Site : admin (commandes manuelles) garde tous les créneaux", !fs.readFileSync(path.join(SRC, "lib/manualOrders.ts"), "utf8").includes("slotsForDate"));

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
