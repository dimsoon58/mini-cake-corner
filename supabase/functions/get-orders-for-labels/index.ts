import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Returns all non-workshop order items whose effective pickup date falls
// within [startDate, endDate] (YYYY-MM-DD, inclusive). Effective date =
// order_fulfillments.pickup_delivery_date when the item has a fulfillment,
// otherwise orders.pickup_delivery_date. Cancelled orders are excluded.
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authError = await requireAdmin(req);
    if (authError) return authError;

    const { startDate, endDate } = (await req.json()) as {
      startDate: string;
      endDate: string;
    };

    if (!startDate || !endDate) {
      return new Response(
        JSON.stringify({ error: "startDate and endDate are required (YYYY-MM-DD)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    // ── Fetch items with embedded order ──────────────────────────────────
    const { data: rawItems, error: itemsErr } = await admin
      .from("order_items")
      .select(`
        id, order_id, product, size, shape, flavors, design,
        base_color, decoration_color, cake_text, text_style, text_color,
        ribbon_color, butterfly_color, item_comment, fulfillment_id,
        orders!inner(
          id, first_name, last_name, order_number, order_validation,
          pickup_delivery_date, order_source
        )
      `)
      .neq("product", "workshop");

    if (itemsErr) throw itemsErr;

    // ── Fetch fulfillments in bulk ────────────────────────────────────────
    const fulfillmentIds = [
      ...new Set(
        (rawItems ?? [])
          .filter((i: any) => i.fulfillment_id)
          .map((i: any) => i.fulfillment_id as string)
      ),
    ];

    const fulfillmentMap: Record<string, { id: string; pickup_delivery_date: string }> = {};

    if (fulfillmentIds.length > 0) {
      const { data: fulfs } = await admin
        .from("order_fulfillments")
        .select("id, pickup_delivery_date")
        .in("id", fulfillmentIds);
      (fulfs ?? []).forEach((f: any) => {
        fulfillmentMap[f.id] = f;
      });
    }

    // ── Filter and enrich ─────────────────────────────────────────────────
    const result = (rawItems ?? [])
      .map((item: any) => {
        const order = item.orders as any;
        if (order.order_validation === "cancelled") return null;

        const fulfillment = item.fulfillment_id
          ? fulfillmentMap[item.fulfillment_id]
          : null;
        const effectiveDate =
          fulfillment?.pickup_delivery_date ?? order.pickup_delivery_date;

        if (
          !effectiveDate ||
          effectiveDate < startDate ||
          effectiveDate > endDate
        )
          return null;

        return { ...item, effectiveDate };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => {
        const d = a.effectiveDate.localeCompare(b.effectiveDate);
        if (d !== 0) return d;
        return (a.orders.order_number ?? "").localeCompare(
          b.orders.order_number ?? ""
        );
      });

    return new Response(JSON.stringify({ items: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("get-orders-for-labels error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
