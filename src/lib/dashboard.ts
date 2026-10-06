import { isProductionDone } from "@/components/admin/ProductionCheck";

// Admin > Tableau de bord — ce qu'il faut gérer, sans aucun chiffre financier.
// Tout vient de get-today (même règle d'inclusion que Production et Aujourd'hui :
// commandes annulées / refusées, gâteaux annulés ou refusés et places annulées
// déjà exclus côté serveur) et de get_workshop_availability (capacité des
// sessions, places occupées). Ici, uniquement des regroupements pour l'écran.

export type TodayItem = {
  type: "cake" | "workshop";
  orderId: string;
  itemId: string;
  orderNumber: string | null;
  customerName: string;
  product: string;
  workshopType: string | null;
  participants: number | null;
  slot: string | null;
  deliveryMethod: string | null;
  deliveryCity: string | null;
  productionStatus: string | null;
  badge: "to_accept" | "awaiting_payment" | null;
  quantity?: number;
};
export type ToDecideOrder = { orderId: string; orderNumber: string | null; customerName: string; date: string | null; receivedAt?: string | null };
export type SessionAvailability = {
  id: string;
  workshop_type: string;
  workshop_date: string;
  workshop_time: string;
  max_capacity: number;
  is_open: boolean;
  active_reserved_seats: number;
};

/** Un gâteau = une unité (une ligne « × 2 » compte pour 2), comme Aujourd'hui. */
export const cakeUnits = (i: TodayItem) => (i.quantity && i.quantity > 1 ? i.quantity : 1);

export type CakeDay = { date: string; toPrepare: number; ready: number; toAccept: number };

/**
 * Gâteaux par jour de retrait / livraison. « À préparer » = gâteaux confirmés
 * pas encore « Fait » ; « À accepter » est compté à part, jamais dans la production.
 */
export function cakeDays(days: Record<string, TodayItem[]>): CakeDay[] {
  return Object.keys(days).sort().map((date) => {
    const cakes = days[date].filter((i) => i.type === "cake");
    const confirmed = cakes.filter((i) => i.badge !== "to_accept");
    const ready = confirmed.filter((i) => isProductionDone(i.productionStatus));
    const sum = (l: TodayItem[]) => l.reduce((s, i) => s + cakeUnits(i), 0);
    return { date, toPrepare: sum(confirmed) - sum(ready), ready: sum(ready), toAccept: sum(cakes.filter((i) => i.badge === "to_accept")) };
  });
}

export type Handover = {
  key: string;
  date: string;
  slot: string | null;
  method: "pickup" | "delivery";
  city: string | null;
  orderId: string;
  orderNumber: string | null;
  customerName: string;
  cakes: number;
  ready: number;
  toAccept: boolean;
  awaitingPayment: boolean;
};

/**
 * Retraits et livraisons : un passage = une commande, un jour, un créneau, un
 * mode. Une commande à plusieurs dates apparaît une fois par date ; plusieurs
 * gâteaux du même passage sont regroupés.
 */
export function handovers(days: Record<string, TodayItem[]>): Handover[] {
  const map = new Map<string, Handover>();
  for (const date of Object.keys(days).sort()) {
    for (const i of days[date]) {
      if (i.type !== "cake") continue;
      const method = i.deliveryMethod === "delivery" ? "delivery" : "pickup";
      const key = `${date}|${i.orderId}|${i.slot ?? ""}|${method}`;
      const h = map.get(key) ?? {
        key, date, slot: i.slot, method, city: method === "delivery" ? i.deliveryCity : null,
        orderId: i.orderId, orderNumber: i.orderNumber, customerName: i.customerName,
        cakes: 0, ready: 0, toAccept: false, awaitingPayment: false,
      };
      h.cakes += cakeUnits(i);
      if (i.badge !== "to_accept" && isProductionDone(i.productionStatus)) h.ready += cakeUnits(i);
      if (i.badge === "to_accept") h.toAccept = true;
      if (i.badge === "awaiting_payment") h.awaitingPayment = true;
      map.set(key, h);
    }
  }
  return [...map.values()].sort((a, b) =>
    a.date.localeCompare(b.date) || (a.slot ?? "99").localeCompare(b.slot ?? "99") || (a.orderNumber ?? "").localeCompare(b.orderNumber ?? ""));
}

export type NextSession = { id: string; date: string; time: string; type: string; reserved: number; capacity: number; open: boolean };

/** Prochaines sessions (à partir d'aujourd'hui), places occupées / capacité. */
export function nextSessions(rows: SessionAvailability[] | null, today: string, limit = 4): NextSession[] {
  return (rows ?? [])
    .filter((r) => String(r.workshop_date) >= today)
    .sort((a, b) => `${a.workshop_date} ${a.workshop_time}`.localeCompare(`${b.workshop_date} ${b.workshop_time}`))
    .slice(0, limit)
    .map((r) => ({
      id: r.id, date: String(r.workshop_date), time: r.workshop_time, type: r.workshop_type,
      reserved: Number(r.active_reserved_seats) || 0, capacity: Number(r.max_capacity) || 0, open: r.is_open !== false,
    }));
}

/** Commandes à accepter / refuser, la plus proche d'abord (ordre de get-today). */
export const toDecideFirst = (list: ToDecideOrder[], limit = 5) => ({ shown: list.slice(0, limit), more: Math.max(0, list.length - limit) });
