// Shared money-arithmetic/formatting helpers — used everywhere a CHF price
// or total is computed or displayed (Cart.tsx, Checkout.tsx, MyOrders.tsx).
//
// JS floating-point numbers can't represent most CHF amounts (5.95, 7.65,
// ...) exactly in binary. Chaining several such approximate values through
// plain addition/subtraction (subtotal - discount - reward + surcharge +
// delivery) accumulates that error — e.g. 51 - 4 - 5.95 + 7.65 can land on
// 48.699999999999996 instead of the exact 48.70, even though every INPUT
// was already itself a clean two-decimal amount. Displaying that raw float
// (or feeding it into yet another sum) is the bug this file exists to
// prevent.
//
// Fix: convert every already-priced CHF amount to an INTEGER number of
// cents (toCents — Math.round, so a genuinely borderline amount still
// rounds the normal way), do all addition/subtraction on those integers
// (exact — no binary fraction involved), then convert back to CHF once, at
// the very end, with centsToChf(). formatChf() is the display-only
// shortcut: always exactly 2 decimals, and round-trips through cents first
// so it can never show a raw float like the one above either.
//
// Mirrors roundToCents() in supabase/functions/create-postfinance-payment/
// index.ts (the server-side pricing authority — same rounding rule,
// Math.round(amount * 100)). Nothing here changes any price or discount
// RULE, and nothing here is sent to PostFinance — this is purely the
// client-side display/estimate layer; the server independently computes
// and verifies the real amount on its own, exactly as before.

export function toCents(amount: number): number {
  return Math.round((Number.isFinite(amount) ? amount : 0) * 100);
}

export function centsToChf(cents: number): number {
  return cents / 100;
}

// Round-trips a CHF amount through integer cents — the safe way to collapse
// any existing float drift back to a clean two-decimal value, e.g. before
// using it as one input of a further sum.
export function roundChf(amount: number): number {
  return centsToChf(toCents(amount));
}

// Sums CHF amounts with exact integer-cent arithmetic. Pass a negative
// amount to subtract it (e.g. sumChf(subtotal, -discount, -reward,
// surcharge, delivery)) — every operand is independently rounded to its own
// nearest cent first, so this also fixes an operand that already carries
// drift from earlier float math, not just the final combination.
export function sumChf(...amounts: number[]): number {
  return centsToChf(amounts.reduce((cents, amount) => cents + toCents(amount), 0));
}

// Always exactly 2 decimals, never a raw float (e.g. never
// "48.699999999999996") — the only helper price DISPLAYS should call.
export function formatChf(amount: number): string {
  return roundChf(amount).toFixed(2);
}
