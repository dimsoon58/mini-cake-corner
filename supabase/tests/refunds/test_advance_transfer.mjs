// « Enregistrer un virement » (avances) : répartition automatique d'un montant
// viré, de la plus ancienne avance à la plus récente (vrai code du site).
//
//   cd supabase/tests/refunds && node test_advance_transfer.mjs
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

const REPO = path.resolve(import.meta.dirname, "../../..");
let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ""); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "transfer-"));
fs.writeFileSync(path.join(tmp, "client.mjs"), "export const supabase = {};");
await build({
  entryPoints: [path.join(REPO, "src/lib/compta.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "c.mjs"), logLevel: "silent",
  loader: { ".png": "empty", ".jpg": "empty", ".jpeg": "empty", ".webp": "empty", ".svg": "empty", ".gif": "empty" },
  plugins: [{ name: "alias", setup(b) {
    b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: path.join(tmp, "client.mjs") }));
    b.onResolve({ filter: /^@\// }, (a) => {
      const base = path.join(REPO, "src", a.path.slice(2));
      for (const ext of ["", ".ts", ".tsx"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return { path: base + ext };
      return { path: base };
    });
  } }],
});
const { allocateTransfer } = await import(path.join(tmp, "c.mjs"));

const adv = (code, date, remaining, state = "open") => ({ id: code, code, purchase_date: date, paid_at: date, supplier: "S", description: null, remaining_now: remaining, state });
// Octobre (2) + novembre (2), dans le désordre ; une « à payer » et une soldée ignorées.
const list = [adv("DEP-4", "2026-11-12", 80), adv("DEP-1", "2026-10-03", 45), adv("DEP-3", "2026-11-02", 120), adv("DEP-2", "2026-10-20", 30.5),
  adv("DEP-X", "2026-10-01", 50, "supplier_unpaid"), adv("DEP-Z", "2026-10-02", 0, "settled")];

let r = allocateTransfer(list, 200);
check("Ordre : plus ancienne d'abord (octobre puis novembre)", r.lines.map((l) => l.code).join(",") === "DEP-1,DEP-2,DEP-3,DEP-4", r.lines);
check("Octobre soldé, puis novembre en partie : 45 + 30.50 + 120 + 4.50 = 200", r.lines.map((l) => l.amount).join(",") === "45,30.5,120,4.5" && r.allocated === 200 && r.leftover === 0, r);
check("Dernière avance en partiel (reste 75.50)", r.lines[3].full === false && r.lines[2].full === true && Math.round((r.lines[3].remaining - r.lines[3].amount) * 100) / 100 === 75.5);
check("« À payer » et soldées jamais remboursées", !r.lines.some((l) => l.code === "DEP-X" || l.code === "DEP-Z"));
r = allocateTransfer(list, 75.5);
check("Montant pile sur octobre : 2 avances soldées, rien en novembre", r.lines.length === 2 && r.lines.every((l) => l.full) && r.leftover === 0, r);
r = allocateTransfer(list, 300);
check("Virement trop grand : tout est soldé, le surplus est signalé (24.50)", r.allocated === 275.5 && r.leftover === 24.5 && r.due === 275.5 && r.lines.every((l) => l.full), r);
r = allocateTransfer(list, 0.1 + 0.2);
check("Centimes exacts (0.30, pas 0.30000000000000004)", r.lines[0].amount === 0.3 && r.allocated === 0.3, r);
check("Sans date : en dernier", allocateTransfer([adv("A", null, 10), adv("B", "2026-10-01", 10)], 10).lines[0].code === "B");

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
