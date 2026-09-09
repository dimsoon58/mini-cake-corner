// Order-calendar rules for physical products (NOT workshops — those keep their
// own session dates). The server is always authoritative; these helpers only
// drive the calendar UI and the checkout preview.
//
//   * No daily order cap. Every calendar day is available.
//   * Lead time: the customer can never order for today or tomorrow. First
//     selectable date = today + 2 calendar days (Europe/Zurich).
//   * Express: any pickup/delivery date 3 calendar days or less after "today"
//     (Europe/Zurich) — i.e. J+2 and J+3 — carries a +10% surcharge on the
//     physical-product amount (delivery and workshops excluded). J+4+ = normal.

export const EXPRESS_RATE = 0.10;
const LEAD_DAYS = 2;             // first selectable = today + 2
const EXPRESS_MAX_DAYS = 3;      // <= 3 days out => express

// Europe/Zurich "today" as a browser-local Date at 00:00 whose calendar day
// equals the current Zurich calendar day. Avoids the UTC off-by-one.
export function zurichToday(): Date {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Calendar-day difference between Zurich "today" and a target date (both
// reduced to their calendar day). 0 = today, 1 = tomorrow, ...
export function calendarDaysUntil(date: Date): number {
  const a = zurichToday();
  const b = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

// Earliest date the customer may pick (local Date at 00:00).
export function minSelectableOrderDate(): Date {
  const t = zurichToday();
  t.setDate(t.getDate() + LEAD_DAYS);
  return t;
}

// Calendar `disabled` predicate: everything before J+2 is off. No other rule.
export function isOrderDateDisabled(date: Date): boolean {
  return calendarDaysUntil(date) < LEAD_DAYS;
}

// True for a selectable date that carries the express surcharge (J+2 / J+3).
export function isExpressDate(date: Date | null | undefined): boolean {
  if (!date) return false;
  const d = calendarDaysUntil(date);
  return d >= LEAD_DAYS && d <= EXPRESS_MAX_DAYS;
}

// +10% of the physical-product amount (caller passes the pre-delivery,
// pre-discount products total; workshops must already be excluded).
export function expressSurcharge(physicalProductsTotal: number, date: Date | null | undefined): number {
  if (!isExpressDate(date)) return 0;
  return Math.round(physicalProductsTotal * EXPRESS_RATE * 100) / 100;
}

// Shared copy — no emoji, no icons.
export const EXPRESS_COPY = {
  hover: {
    en: "Express order: a 10% surcharge applies to this date.",
    fr: "Commande express : un supplément de 10 % s'applique pour cette date.",
  },
  selected: {
    en: "This date qualifies as an express order. A 10% surcharge will be applied to your cart, excluding delivery fees.",
    fr: "Cette date correspond à une commande express. Un supplément de 10 % sera appliqué à votre panier, hors frais de livraison.",
  },
  legend: {
    en: "Highlighted dates are express orders (+10%).",
    fr: "Les dates en évidence sont des commandes express (+10 %).",
  },
  summaryLabel: {
    en: "Express surcharge (10%)",
    fr: "Supplément express (10 %)",
  },
} as const;
