// Strict server-side whitelists for what may ever be written to public.orders
// and public.order_items.
//
// The client sends `order` / `orderItems` in the create-postfinance-payment
// request body. A normal browser sends only the fields below, but ANY HTTP
// client can add internal columns (order_validation, payment_status, paid_at,
// finalized_at, make_*, notion_sync_*, invoice_*, reward_amount_earned, …).
// The backend NEVER spreads `...order` / `...item` from the client. It builds
// explicit objects from these allow-lists; every server-authoritative field
// (customer_id, recomputed amounts, resolved delivery, payment/finalisation
// state, workshop_* from workshop_sessions) is set separately by the code.
//
// Anything not listed here is silently dropped — received, never written.

// orders — client-supplied fields that are safe to carry through as-is
// (still validated / normalised elsewhere). NOTHING money-, payment-,
// finalisation- or ops-related is here.
export const ORDER_CLIENT_FIELDS = [
  "order_source",
  "lang",
  "first_name",
  "last_name",
  "email",
  "phone",
  "delivery_method",          // 'pickup' | 'delivery' | null (server re-nulls for workshop-only)
  "pickup_delivery_date",
  "pickup_delivery_slot",
  "pickup_delivery_datetime",
  "order_comment",
  "newsletter_subscription",
] as const;

// order_items — client-supplied product / design / personalisation fields.
// order_id, order_number, total, production_status, workshop_reference and
// every workshop_* pricing field are forced by the server, never taken here.
export const ORDER_ITEM_CLIENT_FIELDS = [
  "product",
  "size",
  "shape",
  "flavors",
  "design",
  "design_image_url",
  "base_color",
  "decoration_color",
  // Gender Reveal only: the colour inside the cake ("Rose" / "Bleu") — a
  // genuinely different piece of information from decoration_color (which
  // can legitimately stay empty for this design). Null for every other
  // product/design.
  "inside_color",
  "cake_text",
  "text_color",
  "text_style",
  "extra",
  "extra_type",
  "extra_color",
  "extras_price",
  "candle_name",
  "candle_quantity",
  "candles_price",
  "candle_colors",
  "reference_images",
  "item_comment",
  "ribbon_color",
  "butterfly_color",
  "extras",
  "candles",
  // Workshop form answers (booleans). Every other workshop_* column is filled
  // server-side from public.workshop_sessions.
  "workshop_has_minor",
  "workshop_minor_consent_confirmed",
] as const;

// Server-authoritative orders fields (set by create-postfinance-payment, never
// by the client). Used to re-whitelist the already-server-built payload at the
// confirm-postfinance-payment INSERT site (defence in depth — pending_payments
// is service-role only, but a corrupted row must still never inject a column).
export const ORDER_SERVER_FIELDS = [
  "id",
  "customer_id",
  "delivery_address",
  "delivery_zone",
  "delivery_fee",
  "delivery_postal_code",
  "delivery_city",
  "delivery_latitude",
  "delivery_longitude",
  "delivery_distance_km",
  "welcome_discount_amount",
  "reward_amount_used",
  "express_surcharge_amount",
  "total_amount",
  // 'cake_only' | 'workshop_only' | 'mixed' — computed by create-postfinance-
  // payment from the (already priced) order_items, carried on the payload.
  "fulfillment_type",
] as const;

export const ORDER_ITEM_SERVER_FIELDS = [
  "order_id",
  "order_number",
  "total",
  "workshop_type",
  "workshop_session_id",
  "workshop_date",
  "workshop_time",
  "workshop_participants",
  "workshop_unit_price",
  // Multi-date fulfillment (Sept 2026): links a PHYSICAL order_item to the
  // order_fulfillments row (one per distinct pickup/delivery date) it
  // belongs to. Set only by confirm-postfinance-payment, after creating that
  // row — never client-supplied. Always null for a workshop item (workshops
  // keep their own workshop_session_id / date / time, never a fulfillment).
  "fulfillment_id",
  // Reward/workshop bugfix (Sept 2026): how much of THIS line's total was
  // paid with the customer's reward balance, set by create-postfinance-
  // payment's reward-allocation loop. Never affects `total` itself — purely
  // informational, read back later by claim_workshop_reservations_batch to
  // seed workshop_reservations.reward_amount_used for cancellation math.
  "reward_amount_used",
] as const;

// Every field allowed on a payload that create-postfinance-payment already
// built (client whitelist + server fields).
export const ORDER_PAYLOAD_FIELDS = [...ORDER_CLIENT_FIELDS, ...ORDER_SERVER_FIELDS] as const;
export const ORDER_ITEM_PAYLOAD_FIELDS = [...ORDER_ITEM_CLIENT_FIELDS, ...ORDER_ITEM_SERVER_FIELDS] as const;

// Keep only the allowed keys from `source`. Everything else is dropped.
export function pickAllowed(
  source: Record<string, unknown> | null | undefined,
  allowed: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!source || typeof source !== "object") return out;
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      out[key] = (source as Record<string, unknown>)[key];
    }
  }
  return out;
}
