// Persists the orderId a checkout/payment attempt is (or was) using, across
// a reload of THIS tab. Reward points get reserved server-side the moment
// "Proceed to Payment" is pressed (see reserve_reward in
// create-postfinance-payment), and that reservation must never be silently
// abandoned just because the customer reloads/reopens this tab while a
// payment is still genuinely in progress (2026-09-13 payment-resilience
// fix). ONE slot per tab — Checkout.tsx reuses this same orderId (never a
// fresh crypto.randomUUID()) on the next "Proceed to Payment" click for as
// long as it's set, so create-postfinance-payment's own cart-fingerprint
// check decides whether it's safe to resume, rather than the frontend ever
// silently starting a second, parallel attempt on the same points.
//
// Cleared ONLY once the server has confirmed the previous attempt is
// genuinely resolved (paid — PaymentSuccess.tsx, once confirmed — or proven
// dead — EmbeddedCheckout.tsx's restart_checkout / cart_changed_previous_
// abandoned) — never merely because the customer navigated away or closed
// the payment tab.
const CHECKOUT_ORDER_ID_KEY = "bento_checkout_order_id";

export function getStoredOrderId(): string | null {
  try { return sessionStorage.getItem(CHECKOUT_ORDER_ID_KEY); } catch { return null; }
}
export function setStoredOrderId(orderId: string) {
  try { sessionStorage.setItem(CHECKOUT_ORDER_ID_KEY, orderId); } catch { /* ignore */ }
}
export function clearStoredOrderId() {
  try { sessionStorage.removeItem(CHECKOUT_ORDER_ID_KEY); } catch { /* ignore */ }
}
