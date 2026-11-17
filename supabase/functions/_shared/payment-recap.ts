// Récapitulatif du prix pour le lien de paiement (page /payer et e-mail du
// lien), 17.11.2026 : pourquoi ce prix, comme dans le panier. Seulement des
// montants déjà enregistrés sur la commande (mêmes lignes que la facture),
// jamais recalculés : la somme des lignes donne le total de la commande.
// Texte client : aucun tiret long, jamais la raison interne d'un ajustement.

import { itemSummaryLine } from "./order-received-email.ts";

export type RecapLine = { label: string; amount: number };
export type RecapGroup = { title: string | null; lines: RecapLine[] };
export type PaymentRecap = { groups: RecapGroup[]; extras: RecapLine[]; total: number; linesMatchTotal: boolean };

const r2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const dateCH = (iso?: string | null) => {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return y && m && d ? `${d}.${m}.${y}` : String(iso);
};

// deno-lint-ignore no-explicit-any
export function workshopLabel(w: any, lang: "fr" | "en"): string {
  const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);
  const name = w.workshop_type === "paint" ? tr("Paint Workshop", "Atelier Peinture")
    : w.workshop_type === "piping" ? tr("Piping Workshop", "Atelier Pochage") : tr("Signature Workshop", "Atelier Signature");
  const n = Number(w.workshop_participants) || 0;
  const places = n ? `${n} ${n > 1 ? tr("places", "places") : tr("place", "place")}` : "";
  return [name, dateCH(w.workshop_date), w.workshop_time ?? "", places].filter(Boolean).join(" · ");
}

// deno-lint-ignore no-explicit-any
export function buildPaymentRecap(order: any, items: any[], fulfillments: any[]): PaymentRecap {
  const lang: "fr" | "en" = order?.lang === "en" ? "en" : "fr";
  const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);
  const active = items.filter((it) => it.production_status !== "cancelled");
  // deno-lint-ignore no-explicit-any
  const itemLine = (it: any): RecapLine => {
    const qty = Number.isInteger(it.quantity) && it.quantity > 1 ? ` × ${it.quantity}` : "";
    const bits = [itemSummaryLine(it, lang) + qty];
    if (Number(it.fruit_supplement) > 0) bits.push(tr(`fruits CHF ${r2(it.fruit_supplement).toFixed(2)} incl.`, `fruits CHF ${r2(it.fruit_supplement).toFixed(2)} compris`));
    if (Number(it.free_amount) > 0) bits.push(tr(`free CHF ${r2(it.free_amount).toFixed(2)} deducted`, `offert CHF ${r2(it.free_amount).toFixed(2)} déduit`));
    return { label: bits.join(" · "), amount: r2(it.total) };
  };

  // Articles regroupés par date de retrait / livraison.
  // deno-lint-ignore no-explicit-any
  const fById = new Map<string, any>(fulfillments.map((f: any) => [f.id, f]));
  const byKey = new Map<string, { date: string | null; slot: string | null; method: string | null; lines: RecapLine[] }>();
  for (const it of active.filter((x) => x.product !== "workshop")) {
    const f = it.fulfillment_id ? fById.get(it.fulfillment_id) : null;
    const k = f ? f.id : "order";
    if (!byKey.has(k)) {
      byKey.set(k, f
        ? { date: f.pickup_delivery_date, slot: f.pickup_delivery_slot, method: f.delivery_method, lines: [] }
        : { date: order.pickup_delivery_date, slot: order.pickup_delivery_slot, method: order.delivery_method, lines: [] });
    }
    byKey.get(k)!.lines.push(itemLine(it));
  }
  const groups: RecapGroup[] = [...byKey.values()]
    .sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")))
    .map((g) => ({
      title: [dateCH(g.date), g.slot ?? "", g.method === "delivery" ? tr("Delivery", "Livraison") : g.method ? tr("Pickup", "Retrait") : ""].filter(Boolean).join(" · ") || null,
      lines: g.lines,
    }));
  const workshops = active.filter((x) => x.product === "workshop").map((w) => ({ label: workshopLabel(w, lang), amount: r2(w.total) }));
  if (workshops.length) groups.push({ title: tr("Workshops", "Workshops"), lines: workshops });

  // Lignes de la commande (mêmes règles que la facture).
  const extras: RecapLine[] = [];
  const add = (label: string, amount: number) => { if (amount !== 0) extras.push({ label, amount: r2(amount) }); };
  add(tr("Express surcharge", "Supplément express"), r2(order.express_surcharge_amount));
  add(tr("Delivery", "Livraison"), r2(order.delivery_fee));
  add(tr("Welcome discount", "Réduction de bienvenue"), -r2(order.welcome_discount_amount));
  if (order.partner_name) add(tr(`${order.partner_name} partner benefit`, `Avantage partenaire ${order.partner_name}`), -r2(order.partner_discount_amount));
  add(tr("Reward used", "Cagnotte utilisée"), -r2(order.reward_amount_used));
  const adj = r2(order.price_adjustment_amount);
  add(adj < 0 ? tr("Discount", "Remise") : tr("Supplement", "Supplément"), adj);
  add(tr("Difference kept (change after the deadline)", "Différence non remboursée (modification après le délai)"), r2(order.edit_kept_amount));
  add(tr("Paid with a gift voucher", "Payé par bon cadeau"), -r2(order.gift_card_amount));

  const total = r2(order.total_amount);
  const sum = r2([...groups.flatMap((g) => g.lines), ...extras].reduce((s, l) => s + l.amount, 0));
  const match = Math.abs(sum - total) < 0.011;
  // Jamais un récap qui ne tombe pas juste : l'écart éventuel est montré.
  if (!match) extras.push({ label: tr("Other adjustment", "Autre ajustement"), amount: r2(total - sum) });
  return { groups, extras, total, linesMatchTotal: match };
}
