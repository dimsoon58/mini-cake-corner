// Frontend feature flags. Small, explicit, no framework — one named constant
// per flag, imported directly where needed.

// Multi-date fulfillment (Sept 2026 project): a single order/payment may
// contain physical products for several different pickup/delivery dates,
// each becoming its own `order_fulfillments` row server-side. Backend
// (create-postfinance-payment / confirm-postfinance-payment), the customer-
// facing email/invoice templates, MyOrders.tsx/AdminOrder.tsx, and Make/
// Notion (adapted on the user's side to read fulfillment_id/order_fulfillments)
// are all ready — enabled 2026-09-12. While it was OFF, the cart refused a
// second pickup/delivery date (CartContext.addItem) and Checkout rendered the
// single-block delivery UI; that gate is now lifted.
export const MULTI_DATE_FULFILLMENT_ENABLED = true;
