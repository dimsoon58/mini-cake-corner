import { formatChf } from "@/lib/money";

// Planning (/admin/calendar) — totaux d'un jour ou d'une période (27.11.2026).
// Même service que le planning (list-orders-by-date), par jour de RETRAIT ou
// de LIVRAISON (pas par date de paiement : la Compta peut donc différer).
//   • Gâteaux : Bento, Rectangle (gâteaux de Noël compris), bûches, Dot Cakes.
//     Kits, bougies seules et impressions ne sont pas des gâteaux.
//   • Montant : prix des articles − remboursements de l'article, puis une
//     fois par commande : livraison + express − réductions − remboursements
//     de toute la commande (comme orders.total_amount).
//   • Exclus : commande annulée ou refusée, article annulé, commande
//     remboursée en entier.
//   • À accepter : compté à part, jamais dans le montant.
// Les montants n'existent que pour l'admin (le service les retire pour
// l'employée) : sans montant, seul le compte des gâteaux s'affiche.

export interface TotalsEntry {
  type: "cake" | "workshop";
  orderId: string;
  status: string;
  awaitingDecision?: boolean;
  product: string;
  total?: number | null;
  itemCancelled?: boolean;
  refundStatus?: string | null;
  workshopParticipants?: number | null;
  workshopActiveSeats?: number;
  itemManualRefundTotal?: number;
  workshopRefundedAmount?: number;
  manualRefundTotal?: number;
  orderExtras?: number;
  orderDiscount?: number;
}

export interface DayTotals {
  date: string;
  cakes: number;
  workshops: number;
  seats: number;
  amount: number;
  pendingAmount: number;
  pendingOrders: number;
}

export interface PeriodTotals extends Omit<DayTotals, "date"> {
  days: DayTotals[];
  hasAmounts: boolean;
}

export const CAKE_PRODUCTS = new Set(["bento_cake", "rectangle_cake", "christmas_log", "dot_cakes"]);

const cents = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Article qui compte : ni annulé, ni refusé, ni remboursé en entier. */
export const countsInTotals = (e: TotalsEntry) =>
  e.status !== "cancelled" && e.status !== "refused" && !e.itemCancelled &&
  e.refundStatus !== "refunded" && e.refundStatus !== "to_refund";

const emptyDay = (date: string): DayTotals => ({ date, cakes: 0, workshops: 0, seats: 0, amount: 0, pendingAmount: 0, pendingOrders: 0 });

/**
 * Totaux des jours [from, to] (YYYY-MM-DD, inclus). `days` = jour → entrées
 * du planning (plusieurs mois fusionnés si besoin). Une commande sur
 * plusieurs jours compte ses frais et réductions une seule fois, au premier
 * de ses jours dans la période.
 */
export function periodTotals(days: Record<string, TotalsEntry[]>, from: string, to: string): PeriodTotals {
  const dates = Object.keys(days).filter((d) => d >= from && d <= to).sort();
  const seenOrders = new Set<string>();
  const pendingOrders = new Set<string>();
  let hasAmounts = false;
  const out: DayTotals[] = [];
  for (const date of dates) {
    const day = emptyDay(date);
    const dayPending = new Set<string>();
    for (const e of days[date] ?? []) {
      if (!countsInTotals(e)) continue;
      if (e.type === "cake" && CAKE_PRODUCTS.has(e.product)) day.cakes += 1;
      if (e.type === "workshop") {
        day.workshops += 1;
        day.seats += num(e.workshopActiveSeats) > 0 ? num(e.workshopActiveSeats) : num(e.workshopParticipants);
      }
      if (typeof e.total === "number") hasAmounts = true;
      let money = num(e.total) - num(e.itemManualRefundTotal) - num(e.workshopRefundedAmount);
      if (!seenOrders.has(e.orderId)) {
        seenOrders.add(e.orderId);
        money += num(e.orderExtras) - num(e.orderDiscount) - num(e.manualRefundTotal);
      }
      if (e.awaitingDecision) {
        day.pendingAmount += money;
        dayPending.add(e.orderId);
        pendingOrders.add(e.orderId);
      } else {
        day.amount += money;
      }
    }
    day.amount = cents(day.amount);
    day.pendingAmount = cents(day.pendingAmount);
    day.pendingOrders = dayPending.size;
    if (day.cakes || day.workshops || day.amount || day.pendingAmount) out.push(day);
  }
  const sum = (k: "cakes" | "workshops" | "seats" | "amount" | "pendingAmount") => cents(out.reduce((s, d) => s + d[k], 0));
  return {
    cakes: sum("cakes"), workshops: sum("workshops"), seats: sum("seats"),
    amount: sum("amount"), pendingAmount: sum("pendingAmount"), pendingOrders: pendingOrders.size,
    days: out, hasAmounts,
  };
}

/** Mois (YYYY-MM) couverts par [from, to]. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = to.slice(0, 7).split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
    if (out.length > 24) break; // garde-fou : 2 ans au plus
  }
  return out;
}

// « CHF 2'184.00 » (apostrophe des milliers, comme en Suisse).
export const formatPeriodChf = (n: number) => {
  const [int, dec] = formatChf(n).split(".");
  return `CHF ${int.replace(/\B(?=(\d{3})+(?!\d))/g, "'")}.${dec}`;
};
