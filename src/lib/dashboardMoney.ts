// Tableau de bord — synthèse du mois, avec EXACTEMENT les chiffres de la Compta
// (aucun recalcul d'argent ici) :
//   - encaissé, remboursé, net : admin_finance_month (date réelle du paiement /
//     du remboursement), la même source que « Encaissements » de la Compta ;
//   - commandes, gâteaux, places de workshop : admin_sales_month (mois de
//     réalisation : retrait, livraison, séance), la même source que « Ventes »
//     de la Compta. Articles annulés exclus ; un remboursement sans annulation
//     (geste commercial) n'enlève aucun article vendu ;
//   - classements : par quantité vendue (lignes « vendu », une ligne = un
//     gâteau), jamais par chiffre d'affaires.
// Pur (aucun import) : testé tel quel avec les vraies réponses SQL.

export interface MoneyFinance { cards: { collected: number | string; refunded: number | string; net: number | string } }
export interface MoneySalesLine {
  kind: string; state: string; product: string | null; size: string | null; shape: string | null; design: string | null;
  workshopType: string | null; seats: number | null; orderId: string;
}
export interface MoneySales {
  cards: { orders: number; cakes: number; workshopSeats: number; net: number | string };
  lines: MoneySalesLine[];
}
export interface Ranked { key: string; product: string | null; size: string | null; shape: string | null; design: string | null; units: number }
export interface MonthSummary {
  collected: number; refunded: number; netCollected: number;
  orders: number; items: number; workshopSeats: number; workshopSeatsCancelled: number;
  workshopsByType: { type: string; seats: number }[];
  topProducts: Ranked[]; topDesigns: Ranked[];
}

const n2 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;

const rank = (lines: MoneySalesLine[], keyOf: (l: MoneySalesLine) => string | null, limit: number): Ranked[] => {
  const map = new Map<string, Ranked>();
  for (const l of lines) {
    const key = keyOf(l);
    if (!key) continue;
    const r = map.get(key) ?? { key, product: l.product, size: l.size, shape: l.shape, design: l.design, units: 0 };
    r.units += 1;
    map.set(key, r);
  }
  return [...map.values()].sort((a, b) => b.units - a.units || a.key.localeCompare(b.key)).slice(0, limit);
};

export function monthSummary(finance: MoneyFinance | null, sales: MoneySales | null, limit = 5): MonthSummary {
  const sold = (sales?.lines ?? []).filter((l) => l.kind === "item" && l.state === "kept");
  const products = sold.filter((l) => l.product !== "workshop");
  const ws = sold.filter((l) => l.product === "workshop");
  const wsCancelled = (sales?.lines ?? []).filter((l) => l.kind === "item" && l.product === "workshop" && l.state === "cancelled");
  const byType = new Map<string, number>();
  for (const l of ws) byType.set(l.workshopType ?? "?", (byType.get(l.workshopType ?? "?") ?? 0) + (Number(l.seats) || 0));
  return {
    collected: n2(finance?.cards.collected),
    refunded: n2(finance?.cards.refunded),
    netCollected: n2(finance?.cards.net),
    orders: Number(sales?.cards.orders) || 0,
    items: Number(sales?.cards.cakes) || 0,
    workshopSeats: Number(sales?.cards.workshopSeats) || 0,
    workshopSeatsCancelled: wsCancelled.reduce((s, l) => s + (Number(l.seats) || 0), 0),
    workshopsByType: [...byType.entries()].map(([type, seats]) => ({ type, seats })).sort((a, b) => b.seats - a.seats),
    topProducts: rank(products, (l) => [l.product, l.size, l.shape].filter(Boolean).join("|") || null, limit),
    topDesigns: rank(products, (l) => l.design, limit),
  };
}
