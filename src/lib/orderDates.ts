// Order-calendar rules for physical products (NOT workshops — public
// workshop sessions keep their own dates, and a private workshop quote
// request uses its own separate, longer, flat lead time with no surcharge —
// see WORKSHOP_MIN_LEAD_DAYS in PrivateWorkshopDialog.tsx. These two systems
// must never be mixed). The server (create-postfinance-payment) is always
// authoritative; these helpers only drive the calendar UI and the checkout
// preview.
//
//   * No daily order cap. Every calendar day is available.
//   * Lead time: the customer can never order for today or tomorrow. First
//     selectable date = today + 2 calendar days (Europe/Zurich).
//   * Express surcharge, tiered (replaces the old flat +10%):
//       J+2 / J+3 -> +20% on the physical-product amount
//       J+4 / J+5 -> +15% on the physical-product amount
//       J+6+      -> no surcharge
//     Delivery fees and workshops are always excluded from the surcharge base.

const LEAD_DAYS = 2;          // first selectable = today + 2
const TIER1_MAX_DAYS = 3;     // J+2 / J+3
const TIER1_RATE = 0.20;
const TIER2_MAX_DAYS = 5;     // J+4 / J+5
const TIER2_RATE = 0.15;

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

// The express surcharge RATE for a given date: 0.20 (J+2/J+3), 0.15
// (J+4/J+5), or 0 (J+6+, an unselectable date, or no date at all). Never a
// flat rate — this is the single place both the rate tiers live, so
// expressSurcharge() and every display helper below stay in sync with it.
export function expressSurchargeRate(date: Date | null | undefined): number {
  if (!date) return 0;
  const d = calendarDaysUntil(date);
  if (d < LEAD_DAYS) return 0;
  if (d <= TIER1_MAX_DAYS) return TIER1_RATE;
  if (d <= TIER2_MAX_DAYS) return TIER2_RATE;
  return 0;
}

// True for a selectable date that carries ANY express surcharge tier
// (J+2..J+5) — used by the calendar's dot marker, which doesn't need to know
// which of the two rates applies.
export function isExpressDate(date: Date | null | undefined): boolean {
  return expressSurchargeRate(date) > 0;
}

// Tiered surcharge of the physical-product amount (caller passes the
// pre-delivery, pre-discount products total; workshops must already be
// excluded). Returns 0 for a J+6+ date, exactly like the old function did
// for a non-express date.
export function expressSurcharge(physicalProductsTotal: number, date: Date | null | undefined): number {
  const rate = expressSurchargeRate(date);
  if (rate === 0) return 0;
  return Math.round(physicalProductsTotal * rate * 100) / 100;
}

function ratePercentLabel(rate: number): string {
  return String(Math.round(rate * 100));
}

// Per-date copy — computed from the date's own rate so it always states the
// tier that actually applies to THAT date (20% or 15%), never a stale flat
// number. Returns "" for a date with no surcharge (caller should treat that
// as "don't show anything").
export function expressHoverCopy(date: Date | null | undefined, lang: "en" | "fr"): string {
  const rate = expressSurchargeRate(date);
  if (rate === 0) return "";
  const p = ratePercentLabel(rate);
  return lang === "fr"
    ? `Commande express : un supplément de ${p} % s'applique pour cette date.`
    : `Express order: a ${p}% surcharge applies to this date.`;
}

// Explanatory notice shown when the current order date carries an express
// surcharge (ExpressDateNotice, rendered in Cart/Checkout/Printing). States
// the exact lead-time window in "less than X days" phrasing — X = calendar
// days until the date (from the same calendarDaysUntil() used everywhere
// else in this file) + 1, so J+2 -> "less than 3 days", J+3 -> "less than 4
// days", J+4 -> "less than 5 days", J+5 -> "less than 6 days" — together
// with Y, the exact rate THIS date's own tier carries (from
// expressSurchargeRate — never a hardcoded number, so a future tier change
// is picked up here automatically). Returns "" for a J+6+ date (or no
// date), same convention as every other express-copy helper: nothing to
// show once there is no surcharge to explain.
export function expressSelectedCopy(date: Date | null | undefined, lang: "en" | "fr"): string {
  if (!date) return "";
  const rate = expressSurchargeRate(date);
  if (rate === 0) return "";
  const x = calendarDaysUntil(date) + 1;
  const y = ratePercentLabel(rate);
  return lang === "fr"
    ? `Cette date se situe à moins de ${x} jours. Un supplément express de ${y} % s'applique à votre commande, hors frais de livraison. Sous réserve de disponibilité.`
    : `This date is less than ${x} days away. A ${y}% express surcharge applies to your order, excluding delivery fees. Subject to availability.`;
}

// Short inline notice shown directly below the calendar when an express date
// is selected — compact italic line (ⓘ Express order — A X% surcharge applies).
export function expressCalendarNotice(date: Date | null | undefined, lang: "en" | "fr"): string {
  const rate = expressSurchargeRate(date);
  if (rate === 0) return "";
  const p = ratePercentLabel(rate);
  return lang === "fr"
    ? `Commande express — Un supplément de ${p} % s'applique à cette date.`
    : `Express order — A ${p}% surcharge applies to this date.`;
}

// Legend stays rate-agnostic (no single percentage stated) on purpose — it
// already spells out both tiers by name, so there is nothing ambiguous
// about it either way.
export const EXPRESS_COPY = {
  legend: {
    en: "Orders placed 4–5 days in advance include a 15% express surcharge. Orders placed 2–3 days in advance include a 20% express surcharge. Standard pricing applies from 6 days in advance.",
    fr: "Les commandes passées 4 à 5 jours à l'avance incluent un supplément express de 15 %. Les commandes passées 2 à 3 jours à l'avance incluent un supplément express de 20 %. Le tarif standard s'applique à partir de 6 jours à l'avance.",
  },
  summaryLabel: {
    en: "Express surcharge",
    fr: "Supplément express",
  },
} as const;

// The single express rate to show next to the cart/checkout summary line
// (e.g. "Express surcharge (15%)"), or null when it can't be stated as one
// truthful number — either no date here carries a surcharge, or (a
// multi-date cart) two or more dates carry DIFFERENT rates, whose blended
// total has no single percentage. Callers must render the summary label
// WITHOUT a percentage suffix in that null case — see expressSummaryLabel
// below — never estimate one from amount ÷ subtotal.
export function uniformExpressRate(dates: Array<Date | null | undefined>): number | null {
  let rate: number | null = null;
  for (const date of dates) {
    const r = expressSurchargeRate(date);
    if (r === 0) continue;
    if (rate === null) rate = r;
    else if (rate !== r) return null;
  }
  return rate;
}

// Cart/checkout summary label for the express surcharge line. Appends the
// dynamic rate ("(15%)" / "(15 %)") when — and only when — uniformExpressRate
// found a single rate to state; falls back to the bare label for a blended
// multi-date total, exactly as before this wording fix (the exact CHF
// amount is always shown next to it regardless).
export function expressSummaryLabel(lang: "en" | "fr", rate: number | null): string {
  const base = EXPRESS_COPY.summaryLabel[lang];
  if (rate === null) return base;
  const p = ratePercentLabel(rate);
  return lang === "fr" ? `${base} (${p} %)` : `${base} (${p}%)`;
}
