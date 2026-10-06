// Fiche commande — références PostFinance (06.10.2026) : référence de paiement
// « PAY-… » et numéro de transaction, comme dans Notion. Affichage seul, dans
// le bloc « Paiement » réservé aux administratrices. Aucun réseau.
//
//   cd supabase/tests/refunds
//   npm install --no-save esbuild
//   node test_payment_refs.mjs
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

const REPO = path.resolve(import.meta.dirname, "../../..");
let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra) : ""); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr-"));
await build({ entryPoints: [path.join(REPO, "src/lib/paymentRefs.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "p.mjs"), logLevel: "error" });
const { paymentRefs } = await import(path.join(tmp, "p.mjs"));

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check("Commande du site payée : référence PAY-… et transaction", eq(paymentRefs({ payment_reference: "PAY-26092007", postfinance_transaction_id: "596029594" }), { reference: "PAY-26092007", transactionId: "596029594", rewardOnly: false }));
check("Numéro de transaction reçu comme nombre : affiché tel quel", paymentRefs({ postfinance_transaction_id: 600056145 }).transactionId === "600056145");
check("Payée entièrement par la cagnotte : « aucune transaction »", eq(paymentRefs({ payment_reference: "PAY-26100101", postfinance_transaction_id: "REWARD_ONLY" }), { reference: "PAY-26100101", transactionId: null, rewardOnly: true }));
check("Commande manuelle (rien de PostFinance) : rien affiché", eq(paymentRefs({ payment_reference: null, postfinance_transaction_id: null }), { reference: null, transactionId: null, rewardOnly: false }));
check("Valeurs vides ou espaces : ignorées", eq(paymentRefs({ payment_reference: "  ", postfinance_transaction_id: "" }), { reference: null, transactionId: null, rewardOnly: false }));

const page = fs.readFileSync(path.join(REPO, "src/pages/AdminOrder.tsx"), "utf8");
const payBlock = page.slice(page.indexOf("{/* Payment Summary */}"), page.indexOf("<OrderRefundsPanel"));
check("Fiche : « Référence de paiement » et « Transaction PostFinance » dans le bloc Paiement", payBlock.includes('"Référence de paiement"') && payBlock.includes('"Transaction PostFinance"') && payBlock.includes("paymentRefs(order)"));
check("Bloc Paiement réservé aux administratrices (jamais affiché à l'employée)", /\{!employee && \(<>\s*<div[^>]*>\s*<h3[\s\S]*?\{t\("Payment", "Paiement"\)\}/.test(payBlock));

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
