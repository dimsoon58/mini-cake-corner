import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { corsHeaders } from "../_shared/cors.ts";
// 2026-10-13: the e-mail itself is rendered by _shared/order-received-email.ts
// (moved there verbatim, shared with the admin « Renvoyer » action).
import { renderOrderReceivedEmail } from "../_shared/order-received-email.ts";


async function sendOrderReceivedEmail(resendApiKey: string, order: any, items: any[] = [], fulfillments: any[] = []) {
  const { subject, html } = renderOrderReceivedEmail(order, items, fulfillments);

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
      // Stable per order — a retry (payment webhook + poll both re-firing the
      // side-effects) can never send this e-mail twice. Resend keeps the key
      // ~24h.
      "Idempotency-Key": `order-received-${order.id}`,
    },
    body: JSON.stringify({
      from: "contact@bentocakestudio.ch",
      to: [order.email],
      subject,
      html,
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    console.error("Order received email send failed:", data);
    throw new Error(`Resend error: ${JSON.stringify(data)}`);
  }
  console.log("Order received email sent to customer:", data.id);
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }

  try {
    const { orderId } = await req.json();
    if (!orderId) throw new Error("orderId is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // orders is read, never written — this function has no side effect on
    // order_validation, payment_status, or any other order field.
    const { data: order, error: orderError } = await supabase
      .from("orders").select("*").eq("id", orderId).single();

    if (orderError || !order) throw new Error("Order not found");

    // Needed only for the multi-date fulfillment grouping in the summary
    // table (see sendOrderReceivedEmail) — a no-op fetch cost-wise, and the
    // function itself falls back to today's exact single-block rendering
    // whenever there's at most one fulfillment (every order today).
    const { data: itemsData, error: itemsError } = await supabase
      .from("order_items").select("*").eq("order_id", orderId);
    if (itemsError) console.error(`Failed to load order_items for ${orderId} (non-fatal):`, itemsError);
    const { data: fulfillmentsData, error: fulfillmentsError } = await supabase
      .from("order_fulfillments").select("*").eq("order_id", orderId);
    if (fulfillmentsError) console.error(`Failed to load order_fulfillments for ${orderId} (non-fatal):`, fulfillmentsError);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) throw new Error("RESEND_API_KEY not configured");

    const result = await sendOrderReceivedEmail(resendKey, order, itemsData || [], fulfillmentsData || []);

    return new Response(JSON.stringify({ success: true, id: result.id }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error in send-order-received-email:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      status: 500,
    });
  }
});
