import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { orderStatus, type ProdOrder } from "../_shared/production-stats.ts";
import { productionCategory } from "../_shared/production-catalog.ts";

// Admin > Étiquettes de production — read-only. Returns the physical cakes
// to label, with ONLY what a label shows (customer first/last name, order
// number, the item's own date and its cake fields — never email, phone,
// address, prices or notes). Since 2026-10-04 also whether the customer left
// an order comment (has_comment) and how many reference photos of her own she
// sent (reference_photos) — presence only, for the label alerts.
//
// Same eligibility as the production agenda (get-production +
// _shared/production-stats.ts): drafts, cancelled / rejected / failed
// orders, refused cake parts, unpaid website orders and items cancelled
// through a manual refund marked cancels_item or marked cancelled
// (order_items.production_status = 'cancelled') are left out; workshops,
// candles and edible printing sheets are not cakes. Each item is dated by
// its own fulfillment (order_items.fulfillment_id), else by the order.
//
// Two modes:
//   { from, to }  — every eligible cake dated in the period (max 31 days);
//   { orderId }   — every cake of one order (any date), for the order sheet;
//                   ineligible cakes come back with `excluded` set so the
//                   page can say why instead of silently hiding them.
// Never writes anything, never sends anything.

const MAX_DAYS = 31;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ITEM_FIELDS =
  "id, order_id, fulfillment_id, product, size, shape, flavors, design, base_color, decoration_color, inside_color, " +
  "ribbon_color, butterfly_color, extra, cake_text, text_color, text_style, item_comment, quantity, created_at, " +
  "reference_images, design_image_url, production_status";

// Photos de référence envoyées par la cliente : reference_images sans la photo
// du design choisi sur le site (design_image_url, ou la photo d'inspiration
// que le catalogue y recopie). Seul le nombre est renvoyé, jamais les liens.
const INSPIRATION_ASSET = /\/inspiration-\d+[^/]*\.(jpe?g|png|webp)(\?.*)?$/i;
function customerPhotoCount(refs: unknown, designUrl: unknown): number {
  if (!Array.isArray(refs)) return 0;
  return refs.filter((u) => typeof u === "string" && u.trim() && u !== designUrl && !INSPIRATION_ASSET.test(u)).length;
}

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Excluded = "not_a_cake" | "order_not_eligible" | "item_cancelled" | "no_date" | null;

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(cors, { error: "Method not allowed" }, 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
    const admin = await requireAdmin(req, supabase);
    if (!admin) return json(cors, { error: "Admin sign-in required" }, 401);

    const body = await req.json().catch(() => ({}));
    const orderId = typeof body?.orderId === "string" ? body.orderId : null;
    const from = String(body?.from ?? "");
    const to = String(body?.to ?? "");
    const single = !!orderId;
    if (single) {
      if (!UUID_RE.test(orderId!)) return json(cors, { error: "orderId invalide" }, 400);
    } else {
      if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return json(cors, { error: "from and to must be YYYY-MM-DD" }, 400);
      if (from > to) return json(cors, { error: "from must be on or before to" }, 400);
      const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
      if (days > MAX_DAYS) return json(cors, { error: `Période trop longue (max ${MAX_DAYS} jours)` }, 400);
    }

    // ── Candidate orders (same approach as get-production) ────────────────
    let orderIds: string[];
    if (single) {
      orderIds = [orderId!];
    } else {
      const { data: fIn, error: fErr } = await supabase
        .from("order_fulfillments").select("order_id").gte("pickup_delivery_date", from).lte("pickup_delivery_date", to);
      if (fErr) throw new Error(`Failed to load fulfillments: ${fErr.message}`);
      const { data: oIn, error: oErr } = await supabase
        .from("orders").select("id").gte("pickup_delivery_date", from).lte("pickup_delivery_date", to);
      if (oErr) throw new Error(`Failed to load orders by date: ${oErr.message}`);
      orderIds = Array.from(new Set([...(fIn ?? []).map((f) => f.order_id), ...(oIn ?? []).map((o) => o.id)]));
    }
    if (orderIds.length === 0) return json(cors, { items: [] });

    // select("*") like get-production: is_draft / created_via / is_test are
    // read when present. Only names and the order number leave this function.
    const { data: orders, error: ordErr } = await supabase.from("orders").select("*").in("id", orderIds);
    if (ordErr) throw new Error(`Failed to load orders: ${ordErr.message}`);
    const orderById = new Map((orders ?? []).map((o) => [o.id, o as ProdOrder & Record<string, unknown>]));
    if (single && orderById.size === 0) return json(cors, { error: "Commande introuvable" }, 404);

    const { data: fulfillments, error: afErr } = await supabase
      .from("order_fulfillments").select("id, pickup_delivery_date").in("order_id", orderIds);
    if (afErr) throw new Error(`Failed to load order fulfillments: ${afErr.message}`);
    const fById = new Map((fulfillments ?? []).map((f) => [f.id, f]));

    const { data: items, error: iErr } = await supabase
      .from("order_items").select(ITEM_FIELDS).in("order_id", orderIds).neq("product", "workshop");
    if (iErr) throw new Error(`Failed to load order items: ${iErr.message}`);

    const ids = (items ?? []).map((i) => i.id);
    const cancelled = new Set<string>();
    if (ids.length > 0) {
      const { data: cancels, error: cErr } = await supabase
        .from("order_manual_refunds").select("order_item_id").eq("cancels_item", true).in("order_item_id", ids);
      if (cErr) throw new Error(`Failed to load item cancellations: ${cErr.message}`);
      for (const c of cancels ?? []) if (c.order_item_id) cancelled.add(c.order_item_id);
    }

    const out = [];
    for (const it of items ?? []) {
      const o = orderById.get(it.order_id);
      if (!o) continue;
      const f = it.fulfillment_id ? fById.get(it.fulfillment_id) : null;
      const date: string | null = f ? f.pickup_delivery_date : ((o.pickup_delivery_date as string | null) ?? null);
      if (!single && !(date && date >= from && date <= to)) continue;

      let excluded: Excluded = null;
      const status = orderStatus(o, true);
      if (productionCategory(it.product, it.size, it.shape) === "skip") excluded = "not_a_cake";
      else if (!status.include) excluded = "order_not_eligible";
      else if (cancelled.has(it.id) || (it as { production_status?: string }).production_status === "cancelled") excluded = "item_cancelled";
      else if (!date) excluded = "no_date";
      if (excluded && !single) continue;

      const { reference_images, design_image_url, production_status: _ps, ...fields } = it as typeof it & { reference_images?: unknown; design_image_url?: unknown; production_status?: unknown };
      out.push({
        ...fields,
        reference_photos: customerPhotoCount(reference_images, design_image_url),
        date,
        excluded,
        badge: status.include ? status.badge : null,
        order: {
          id: o.id,
          order_number: o.order_number ?? null,
          first_name: o.first_name ?? null,
          last_name: o.last_name ?? null,
          manual: status.include ? status.manual : null,
          is_test: (o as { is_test?: boolean }).is_test === true,
          // Commentaire de commande : présence seulement (le texte reste dans l'admin).
          has_comment: typeof (o as { order_comment?: unknown }).order_comment === "string" && !!String((o as { order_comment?: string }).order_comment).trim(),
        },
      });
    }
    return json(cors, { items: out });
  } catch (error) {
    console.error("get-orders-for-labels error:", error);
    return json(cors, { error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
