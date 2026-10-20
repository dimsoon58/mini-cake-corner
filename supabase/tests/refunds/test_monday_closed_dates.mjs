// Lundi : aucun créneau avant 12:00 (retrait et livraison) ; 13 et 14
// novembre 2026 fermés (dates grisées) — sur le site uniquement, l'Admin
// (commandes manuelles) garde tout. Vrai code serveur
// (_shared/order-pricing.ts resolveOneFulfillment) et vrai code du site
// (src/lib/orderDates.ts). Sans base, sans réseau.
//
//   cd supabase/tests/refunds
//   npm install --no-save esbuild
//   node test_monday_closed_dates.mjs
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mon-"));
async function load(entry, name) {
  const out = path.join(tmp, `${name}.mjs`);
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error",
    plugins: [{ name: "m", setup(b) { b.onResolve({ filter: /^(https:|npm:)/ }, () => ({ path: path.join(tmp, "empty.mjs") })); } }] });
  return import(out);
}
fs.writeFileSync(path.join(tmp, "empty.mjs"), "export default {}; export const serve = () => {}; export const createClient = () => ({});");
const server = await load(path.join(ROOT, "functions/_shared/order-pricing.ts"), "pricing");
const site = await load(path.join(SRC, "lib/orderDates.ts"), "dates");


const zToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
const nextDow = (dow) => { const d = new Date(`${zToday}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const MON = nextDow(1), TUE = nextDow(2), SAT = nextDow(6);
const resolve = (date, slot, method = "pickup", options) =>
  server.resolveOneFulfillment({ date, deliveryMethod: method, slot, itemIndexes: [0] }, 60, options).then(() => "ok", (e) => String(e.message));
const PICKUP = ["10:00 – 11:00", "11:00 – 12:00", "12:00 – 13:00", "13:00 – 14:00", "14:00 – 15:00", "15:00 – 16:00", "16:00 – 17:00", "17:00 – 18:00"];
const DELIVERY = ["08:00 – 09:00", "09:00 – 10:00", "10:00 – 11:00", "11:00 – 12:00", "12:00 – 13:00", "13:00 – 14:00", "14:00 – 15:00", "15:00 – 16:00", "16:00 – 17:00", "17:00 – 18:00", "18:00 – 19:00", "19:00 – 20:00"];
const ADMIN = { minLeadDays: 0, allowClosedDays: true, allowAnySlot: true, shortNoticeExpress: true };

// ═══ Lundi ═══════════════════════════════════════════════════════════════
check("Même règle du lundi sur le site et le serveur (12:00)", site.MONDAY_FIRST_HOUR === 12 && server.MONDAY_FIRST_HOUR === 12);
check(`Site : lundi ${MON} en retrait → 12:00 à 18:00 seulement`, JSON.stringify(site.slotsForDate(PICKUP, MON)) === JSON.stringify(PICKUP.slice(2)), site.slotsForDate(PICKUP, MON));
check(`Site : lundi ${MON} en livraison → 12:00 à 20:00 seulement`, JSON.stringify(site.slotsForDate(DELIVERY, MON)) === JSON.stringify(DELIVERY.slice(4)), site.slotsForDate(DELIVERY, MON));
check(`Site : mardi ${TUE} → tous les créneaux (retrait et livraison)`, site.slotsForDate(PICKUP, TUE).length === 8 && site.slotsForDate(DELIVERY, TUE).length === 12);
check(`Site : samedi ${SAT} → toujours 11:00 – 12:00 seulement`, JSON.stringify(site.slotsForDate(PICKUP, SAT)) === '["11:00 – 12:00"]' && JSON.stringify(site.slotsForDate(DELIVERY, SAT)) === '["11:00 – 12:00"]');
check("Site : note sous le créneau le lundi et le samedi, rien le mardi",
  site.slotRuleCopy(MON)?.fr === "Le lundi, créneaux à partir de 12:00 seulement." && site.slotRuleCopy(SAT)?.fr.startsWith("Le samedi") && site.slotRuleCopy(TUE) === null);
const monDate = new Date(`${MON}T00:00:00`);
check("Site : le lundi reste une date sélectionnable", !site.isOrderDateDisabled(monDate));
for (const [slot, method] of [["10:00 – 11:00", "pickup"], ["11:00 – 12:00", "pickup"], ["08:00 – 09:00", "delivery"], ["11:00 – 12:00", "delivery"]]) {
  const r = await resolve(MON, slot, method);
  check(`Serveur : lundi ${slot} en ${method === "pickup" ? "retrait" : "livraison"} refusé (MONDAY_SLOT)`, r.startsWith("MONDAY_SLOT:"), r);
}
check("Serveur : lundi 12:00 – 13:00 en retrait accepté", (await resolve(MON, "12:00 – 13:00")) === "ok");
check("Serveur : lundi 17:00 – 18:00 en retrait accepté", (await resolve(MON, "17:00 – 18:00")) === "ok");
check("Serveur : mardi 10:00 – 11:00 accepté (seul le lundi change)", (await resolve(TUE, "10:00 – 11:00")) === "ok");
check("Serveur : samedi toujours limité à 11:00 – 12:00", (await resolve(SAT, "15:00 – 16:00")).startsWith("SATURDAY_SLOT:") && (await resolve(SAT, "11:00 – 12:00")) === "ok");
check("Admin (commande manuelle) : lundi 10:00 – 11:00 accepté", (await resolve(MON, "10:00 – 11:00", "pickup", ADMIN)) === "ok");

// ═══ 13 et 14 novembre ═══════════════════════════════════════════════════
check("Même liste de dates fermées sur le site et le serveur", JSON.stringify(site.CLOSED_DATES) === JSON.stringify(server.CLOSED_DATES) && site.CLOSED_DATES.join() === "2026-11-13,2026-11-14");
if (zToday <= "2026-11-11") {
  for (const d of ["2026-11-13", "2026-11-14"]) {
    check(`Site : ${d} grisé dans le calendrier`, site.isOrderDateDisabled(new Date(`${d}T00:00:00`)) && site.isClosedDate(new Date(`${d}T00:00:00`)));
    const r1 = await resolve(d, "11:00 – 12:00", "pickup"), r2 = await resolve(d, "11:00 – 12:00", "delivery");
    check(`Serveur : ${d} refusé en retrait et en livraison (CLOSED_DATE)`, r1.startsWith("CLOSED_DATE:") && r2.startsWith("CLOSED_DATE:"), [r1, r2]);
    check(`Admin (commande manuelle) : ${d} accepté`, (await resolve(d, "11:00 – 12:00", "pickup", ADMIN)) === "ok");
  }
  check("Site : 12 novembre (jeudi) et 16 novembre (lundi) restent ouverts",
    !site.isOrderDateDisabled(new Date("2026-11-12T00:00:00")) && !site.isOrderDateDisabled(new Date("2026-11-16T00:00:00")));
  check("Serveur : 12 novembre accepté", (await resolve("2026-11-12", "10:00 – 11:00")) === "ok");
} else {
  console.log("(13–14 novembre déjà trop proches ou passés : contrôles de date sautés)");
}
check("Site : un dimanche reste grisé", site.isOrderDateDisabled(new Date(`${nextDow(0)}T00:00:00`)));

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
