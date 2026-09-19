import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { corsHeaders } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/admin-auth.ts";

// Read-only order lookup for the admin "Voir le détail complet de la
// commande" link (notify-order's reviewUrl, /admin/order/:id?token=...).
//
// WHY THIS EXISTS: AdminOrder.tsx used to query `orders`/`order_items`
// directly from the browser with the anon Supabase client. That is subject
// to RLS — orders is scoped to the signed-in customer's own rows
// (customer_id = auth.uid()), and the admin opening the e-mail link is
// never signed in as that customer. The query silently returned zero rows
// (no RLS error, just an empty result), so the page always showed "Order
// not found", regardless of whether the id/token were correct. The
// Accept/Refuse buttons never hit this problem because they live on a
// SEPARATE page (OrderAction.tsx, /order-action) that never reads `orders`
// client-side at all — it only calls manage-order (service_role,
// bypasses RLS) once the admin clicks confirm.
//
// This function is the same shape of fix as manage-order's own token gate:
// service_role read, authorised purely by knowing BOTH orderId and the
// matching order_action_tokens row — no PIN, no login. Viewing must stay
// available after the token has been consumed by an Accept/Refuse action
// (the "single-use" behaviour lives entirely in manage-order's own decision
// logic — order_action_tokens.used is never treated as invalidating the row
// itself, exactly like manage-order's own tolerant re-check), so this
// function deliberately does NOT check `used` — only that a row with this
// exact (order_id, token) pair exists.
//
// 2026-09-12: `used` is intentionally ignored (above), but `expires_at` IS
// enforced — order_action_tokens already carries it (NOT NULL, defaults to
// now() + 24h at creation: 20260306130750_1eab2afa-....sql), it's just never
// checked anywhere in the codebase today (manage-order's own token lookup
// only reads `used`). Left unchecked here too, a token from a months-old
// e-mail would let anyone holding that link keep reading this customer's
// name/e-mail/phone/address indefinitely. Enforcing the EXISTING 24h expiry
// — not a new/different one — here only, so a stale link eventually stops
// returning data while a fresh one still works for the customary window.
// This does NOT touch Accept/Refuse (manage-order, OrderAction.tsx) at all —
// their own single-use behaviour via `used` is completely unchanged.
//
// 2026-09-17 (real auth guard): the token alone used to be sufficient —
// anyone holding the link could view the order, with no way to know who
// actually opened it. A verified admin session (see _shared/admin-auth.ts)
// is now REQUIRED on every call; the token, when present (the notification
// e-mail's own link still carries one), is validated as an EXTRA layer, not
// a way around the admin check. The new /admin/orders dashboard calls this
// with no token at all — an orderId plus a valid admin session is enough.


serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }

  try {
    const { orderId, token } = await req.json();
    if (!orderId) {
      throw new Error("Missing required field: orderId");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // 2026-09-19: restores the admin-session requirement this function's own
    // header comment already documented as required (it had never actually
    // been wired in — requireAdmin was never imported/called here, so the
    // token was the ONLY gate; a leaked/guessed order id + token pair could
    // read a customer's name/e-mail/phone/address with no login at all).
    // Same pattern as list-orders/list-orders-by-date.
    const admin = await requireAdmin(req, supabase);
    if (!admin) {
      return new Response(JSON.stringify({ error: "Admin sign-in required" }), {
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
        status: 401,
      });
    }

    // Token, when supplied (the notification e-mail's own link), is
    // validated as an EXTRA layer on top of the admin session above — never
    // a way around it. When absent (the /admin/orders, /admin/calendar
    // dashboard flow, which never has one in the URL), the admin session
    // alone is sufficient to view the order; `used` deliberately ignored
    // (see header comment), `expires_at` IS enforced.
    if (token) {
      const { data: tokenRow, error: tokenErr } = await supabase
        .from("order_action_tokens")
        .select("order_id, expires_at")
        .eq("order_id", orderId)
        .eq("token", token)
        .maybeSingle();
      if (tokenErr) throw new Error(`Token lookup failed: ${tokenErr.message}`);
      if (!tokenRow) {
        return new Response(JSON.stringify({ error: "Invalid or unknown action token" }), {
          headers: { ...corsHeaders(req), "Content-Type": "application/json" },
          status: 403,
        });
      }
      if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() <= Date.now()) {
        return new Response(JSON.stringify({ error: "This link has expired" }), {
          headers: { ...corsHeaders(req), "Content-Type": "application/json" },
          status: 403,
        });
      }
    }

    const { data: order, error: orderErr } = await supabase
      .from("orders").select("*").eq("id", orderId).maybeSingle();
    if (orderErr) throw new Error(`Failed to load order: ${orderErr.message}`);
    if (!order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
        status: 404,
      });
    }

    const { data: items, error: itemsErr } = await supabase
      .from("order_items").select("*").eq("order_id", orderId).order("created_at", { ascending: true });
    if (itemsErr) throw new Error(`Failed to load order items: ${itemsErr.message}`);

    // Multi-date fulfillment: physical orders have one row per distinct
    // pickup/delivery date (order_items._fulfillmentIndex → fulfillment_id
    // at confirm-postfinance-payment time). This function already reads via
    // service_role, so no RLS concern here (unlike MyOrders.tsx, which
    // needed 20260912120000_order_fulfillments_customer_select_policy.sql).
    const { data: fulfillments, error: fulfillmentsErr } = await supabase
      .from("order_fulfillments").select("*").eq("order_id", orderId).order("pickup_delivery_date", { ascending: true });
    if (fulfillmentsErr) throw new Error(`Failed to load order fulfillments: ${fulfillmentsErr.message}`);

    // Ad-hoc manual refunds the admin recorded by hand (see the
    // order_manual_refunds migration's own header) — independent of
    // orders.refund_status, shown as its own history list on AdminOrder.tsx.
    const { data: manualRefunds, error: manualRefundsErr } = await supabase
      .from("order_manual_refunds").select("*").eq("order_id", orderId).order("created_at", { ascending: false });
    if (manualRefundsErr) throw new Error(`Failed to load manual refunds: ${manualRefundsErr.message}`);

    // When the caller didn't already supply their own token (the dashboard
    // flow), resolve this order's own existing order_action_tokens row (if
    // any) so Accept/Refuse from AdminOrder.tsx still has one to use —
    // same tolerant `used`-ignoring lookup as above, just not restricted to
    // one specific token value. Most recent row wins if more than one exists.
    let actionToken: string | null = null;
    if (!token) {
      const { data: ownToken, error: ownTokenErr } = await supabase
        .from("order_action_tokens")
        .select("token")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ownTokenErr) {
        console.error(`get-order-detail: own-token lookup failed for ${orderId} (non-fatal):`, ownTokenErr);
      } else {
        actionToken = ownToken?.token ?? null;
      }
    }

    // Admin "Voir/Télécharger la facture" — mints a short-lived signed URL
    // server-side (service_role, bypasses RLS entirely) instead of the
    // customer-facing MyOrders.tsx pattern (client-side createSignedUrl,
    // which depends on a storage RLS policy matching auth.uid() to
    // orders.customer_id — never true for an admin viewing someone else's
    // order). `invoiceUrl` stays null whenever invoice_path isn't set yet,
    // even if invoice_number already is — AdminOrder.tsx uses that gap to
    // show "facture manquante" instead of a broken link.
    let invoiceUrl: string | null = null;
    // 2026-09-20: surfaced alongside invoiceUrl (diagnostic only — AdminOrder.tsx
    // shows it next to "missing" so the real reason is visible from the page
    // itself instead of only ever reaching Edge Function logs nobody here has
    // access to). Never affects anything else: invoiceUrl/order/items/
    // fulfillments/actionToken are all completely unchanged either way.
    let invoiceUrlError: string | null = null;
    if (order.invoice_path) {
      const { data: signed, error: signErr } = await supabase.storage
        .from("invoice")
        .createSignedUrl(order.invoice_path, 60 * 10);
      if (signErr) {
        console.error(`get-order-detail: invoice signed URL failed for ${orderId} (non-fatal):`, signErr);
        // Only ever signErr.message (a short, storage-API-generated string
        // like "Object not found") — never the raw error object, which
        // could carry more than intended. A hardcoded, static fallback
        // string when message is somehow empty, never anything derived
        // from signErr itself.
        invoiceUrlError = signErr.message || "Unknown storage error";
      } else {
        invoiceUrl = signed?.signedUrl ?? null;
      }
    }

    return new Response(JSON.stringify({
      order,
      items: items ?? [],
      fulfillments: fulfillments ?? [],
      manualRefunds: manualRefunds ?? [],
      actionToken,
      invoiceUrl,
      invoiceUrlError,
    }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error in get-order-detail:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      status: 500,
    });
  }
});
