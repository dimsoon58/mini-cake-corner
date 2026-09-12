// Frontend feature flags. Small, explicit, no framework — one named constant
// per flag, imported directly where needed.

// Multi-date fulfillment (Sept 2026 project): a single order/payment may
// contain physical products for several different pickup/delivery dates,
// each becoming its own `order_fulfillments` row server-side. The Supabase
// schema and the create-postfinance-payment / confirm-postfinance-payment
// code paths are ready for this, but Make/Notion are NOT yet adapted to
// receive per-fulfillment data (they still read the single legacy
// orders.pickup_delivery_date / delivery_method / … columns) — so this stays
// OFF until that follow-up work is done. While OFF, the cart still refuses a
// second pickup/delivery date (CartContext.addItem) and Checkout renders the
// single-block delivery UI exactly as before; nothing here changes customer-
// facing behaviour by itself.
//
// Flip to true only once Make/Notion (and the customer-facing email/invoice
// templates, which are not yet fulfillment-aware either — see the rollout
// report) have been updated to consume order_fulfillments.
export const MULTI_DATE_FULFILLMENT_ENABLED = false;
