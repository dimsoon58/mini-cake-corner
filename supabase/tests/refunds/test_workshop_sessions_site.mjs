// Page « Réserver » : quelles sessions le site propose (src/data/workshopSessions.ts,
// vrai code). Seulement les sessions de la base, à venir et ouvertes ; une session
// fermée dans Admin > Workshops disparaît ; jamais l'ancienne liste écrite dans le
// code pendant le chargement. Aucune base, aucun réseau.
//
//   cd supabase/tests/refunds
//   npm install --no-save esbuild
//   node test_workshop_sessions_site.mjs
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

const REPO = path.resolve(import.meta.dirname, "../../..");
let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra) : ""); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ws-"));
await build({ entryPoints: [path.join(REPO, "src/data/workshopSessions.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "ws.mjs"), logLevel: "error" });
const W = await import(path.join(tmp, "ws.mjs"));

const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const row = (id, type, date, time, open = true, price = 65) => ({ id, workshop_type: type, workshop_date: date, workshop_time: time, unit_price: price, max_capacity: 10, is_open: open, active_reserved_seats: 0 });
const rows = [
  row("paint-old", "paint", day(-2), "14:00"),
  row("paint-a", "paint", day(2), "14:00", false),          // fermée (retirée du site)
  row("paint-b", "paint", day(9), "18:00", true, 70),
  row("paint-c", "paint", day(12), "15:00"),
  row("sig-a", "signature", day(5), "13:00", true, 85),
];
const p = W.upcomingSessions("paint", rows);
check("Seulement les sessions ouvertes et à venir, triées", p.map((s) => s.id).join() === "paint-b,paint-c", p.map((s) => s.id));
check("Session fermée : absente du site (plus affichée « Complet »)", !p.some((s) => s.id === "paint-a"));
check("Session passée : absente", !p.some((s) => s.id === "paint-old"));
check("Prix et heure lus dans la base (70 CHF, 18:00)", p[0].pricePerPerson === 70 && p[0].time === "18:00");
check("Par type : Signature à part", W.upcomingSessions("signature", rows).map((s) => s.id).join() === "sig-a");
check("Pendant le chargement (base pas encore lue) : aucune session, jamais l'ancienne liste", W.upcomingSessions("paint", null).length === 0 && W.workshopSessions.length > 0);
check("Ancienne ligne sans is_open (anciennes réponses) : considérée ouverte", W.upcomingSessions("paint", [{ ...row("x", "paint", day(3), "10:00"), is_open: undefined }]).length === 1);
const page = fs.readFileSync(path.join(REPO, "src/pages/WorkshopBooking.tsx"), "utf8");
check("Page : « Chargement des dates… » pendant le chargement, message d'erreur si la base ne répond pas",
  page.includes("Chargement des dates…") && page.includes("Les dates sont momentanément indisponibles"));

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
