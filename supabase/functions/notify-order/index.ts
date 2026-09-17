import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { getSiteBaseUrl, getLogoEmailUrl } from "../_shared/site-config.ts";

import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { corsHeaders } from "../_shared/cors.ts";


const ADMIN_EMAILS = ["naglemelodie@gmail.com", "e.potapushina@gmail.com"];

// Fixed pickup address — shown systematically whenever a date/method row
// says "Pickup at store"/"Retrait sur place", never left implicit. Same
// address as elsewhere (Footer.tsx, _shared/delivery-pricing.ts's
// DELIVERY_ORIGIN, manage-order/index.ts, send-order-received-email/index.ts).
const STORE_ADDRESS = "Rue Prévost-Martin 8, 1205 Genève";

function formatDateCH(dateValue?: string): string {
  if (!dateValue) return "—";
  const [year, month, day] = dateValue.split("-");
  return year && month && day ? `${day}.${month}.${year}` : dateValue;
}

// Display only — a Dot Cakes pack's flavors can carry a trailing category
// annotation baked in at add-to-cart time ("Red Velvet (Standard Flavours)"),
// needed exactly as stored in order_items.flavors (Notion, kitchen ops) —
// never touched here, only how it's shown. Strips the trailing "(...)" off
// each entry, preserving order and duplicates. An entry with no annotation
// (every non-Dot-Cakes product) passes through unchanged. Same behaviour as
// src/lib/orderLabels.ts's flavorLabel() (frontend cart) — kept as a local
// copy here (Deno function, can't import from src/).
function flavorsLabel(flavors: string[] | null | undefined): string {
  if (!flavors?.length) return "";
  return flavors.map((f) => f.trim().replace(/\s*\([^)]*\)\s*$/, "")).filter(Boolean).join(", ");
}

function row(label: string, value: string | undefined | null): string {
  if (!value) return "";
  return `<tr><td style="padding:6px 12px;color:#888;font-size:14px;white-space:nowrap;vertical-align:top;">${label}</td><td style="padding:6px 12px;font-size:14px;color:#333;">${value}</td></tr>`;
}

// 2026-09-15: reference images are per-ARTICLE, not per-order — each
// order_items row already carries its own reference_images (select("*") on
// order_items, no flattening at the query level). Rendered inside that
// item's own card, right under its details, instead of the old single
// global gallery at the bottom of the email (which merged every item's
// photos together with no way to tell which cake a given image belonged
// to). Returns "" when the item has none — never an empty "Reference
// images" heading with nothing under it.
function itemReferenceImagesBlock(item: any): string {
  const urls: string[] = Array.isArray(item?.reference_images)
    ? item.reference_images.filter((u: unknown): u is string => typeof u === "string" && u.length > 0)
    : [];
  if (!urls.length) return "";
  return `
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid #e5e7eb;">
          <p style="margin:0 0 8px;color:#888;font-size:13px;font-weight:600;">📎 Images de référence</p>
          <table style="width:100%;border-collapse:collapse;">
            ${urls.map((url: string, j: number) =>
              `<tr><td style="padding:6px 0;color:#888;font-size:13px;vertical-align:top;">Image ${j + 1}</td><td style="padding:6px 0;"><a href="${url}" style="color:#2563eb;" target="_blank">Ouvrir l’image</a><br/><img src="${url}" alt="Image de référence ${j + 1}" style="max-width:220px;width:100%;height:auto;border-radius:8px;border:1px solid #e5e7eb;display:block;margin-top:4px;" /></td></tr>`
            ).join("")}
          </table>
        </div>`;
}

// Catalog.tsx embeds this exact tag into item_comment for a Shag-Cake-style
// design with two option photos ("[Preferred design: Option N]"), purely so
// the design photo actually picked survives as data — never something the
// customer typed. This email now shows that photo directly (design_image_url,
// below), so the tag is no longer needed here at all — split out the same
// way src/lib/orderLabels.ts's splitComment() already does for the customer/
// admin-facing pages, so only the customer's real comment (if any) is shown.
// Kept as a local copy (Deno function, can't import from src/) — same regex,
// same behaviour; update both if this tag format ever changes.
const PREFERRED_DESIGN_RE = /^\[Preferred design: Option (\d+)\]\s*/;
function realComment(comment: string | null | undefined): string | null {
  if (!comment) return null;
  const stripped = comment.replace(PREFERRED_DESIGN_RE, "").trim();
  return stripped || null;
}

async function sendAdminEmail(
  resendApiKey: string,
  order: any,
  items: any[],
  fulfillments: any[],
  siteUrl: string,
  token: string | null,
  isWorkshopOnly: boolean,
  mixed: boolean,
) {
  const reviewUrl = `${siteUrl}/admin/order/${order.id}${token ? `?token=${token}` : ""}`;
  // Multi-date fulfillment: each physical order_item carries its own
  // fulfillment_id (one order_fulfillments row per distinct pickup/delivery
  // date). Falls back to the order-level legacy date for an old item with
  // no fulfillment_id (never null-checked before this) — never a second
  // source of truth, just the one already-authoritative date resolved per
  // item instead of assumed to be the same for the whole order.
  const fulfillmentById = new Map<string, any>((fulfillments || []).map((f: any) => [f.id, f]));
  const itemDateLabel = (item: any): string | null => {
    if (item.fulfillment_id) {
      const f = fulfillmentById.get(item.fulfillment_id);
      if (f?.pickup_delivery_date) {
        return formatDateCH(f.pickup_delivery_date) + (f.pickup_delivery_slot ? ` · ${f.pickup_delivery_slot}` : "");
      }
    }
    return order.pickup_delivery_date
      ? formatDateCH(order.pickup_delivery_date) + (order.pickup_delivery_slot ? ` · ${order.pickup_delivery_slot}` : "")
      : null;
  };
  // 2026-09-15 (deferred capture restored): nothing auto-confirms any more —
  // workshop_only now goes through this SAME Accept/Refuse decision as every
  // other order (see manage-order/index.ts). The payment is only AUTHORIZED
  // at this point (never captured yet), and Accept/Refuse is always a single
  // whole-order decision now (Option A) — there is no more partial "only the
  // cake part" outcome for a mixed order, so refundDue and the old "refund
  // by hand, workshop stays confirmed" wording are gone entirely.

  const itemBlocks = items.map((item: any, i: number) => {
    if (item.product === "workshop") {
      const wsName = item.workshop_type === "paint" ? "Atelier Peinture" : "Atelier Signature";
      return `
      <div style="background:#fafafa;border:1px solid #eee;border-radius:12px;padding:20px;margin:12px 0;">
        <h4 style="margin:0 0 12px;color:#333;font-size:16px;font-weight:600;">Atelier ${i + 1} — CHF ${item.total}</h4>
        <table style="width:100%;border-collapse:collapse;">
          ${row("Atelier", wsName)}
          ${row("Date", item.workshop_date)}
          ${row("Horaire", item.workshop_time)}
          ${row("Participants", item.workshop_participants != null ? String(item.workshop_participants) : null)}
          ${row("Notes", item.item_comment?.trim() || null)}
        </table>
        ${itemReferenceImagesBlock(item)}
      </div>`;
    }

    const candlesList = item.candle_name
      ? `${item.candle_name}${item.candle_quantity ? ` ×${item.candle_quantity}` : ""}`
      : "";

    // The exact design photo the customer picked on the site — never
    // reconstructed from the design slug/id. design_image_url is already
    // an absolute URL (set by Catalog.tsx at checkout); shown only when
    // present, kept entirely separate from reference_images (the client's
    // own uploaded photos), which stay in their own block below, unchanged.
    // Deliberately scoped to bento_cake/rectangle_cake (Catalog.tsx's own
    // products) only: order_items.design_image_url is now also populated
    // for Dot Cakes, DIY Kit and Printing (Sept 2026 image-consistency
    // fix — see Cart.tsx/Checkout.tsx), but this internal Accept/Refuse
    // email should stay exactly as light as it already was for those
    // products, per explicit request — the customer-facing confirmation
    // email is where those photos now show up instead.
    const designImageBlock = item.design_image_url && (item.product === "bento_cake" || item.product === "rectangle_cake")
      ? `<img src="${item.design_image_url}" alt="Design choisi" style="max-width:220px;width:100%;height:auto;border-radius:8px;border:1px solid #e5e7eb;display:block;margin:0 0 12px;" />`
      : "";

    return `
      <div style="background:#fafafa;border:1px solid #eee;border-radius:12px;padding:20px;margin:12px 0;">
        <h4 style="margin:0 0 12px;color:#333;font-size:16px;font-weight:600;">🍰 Article ${i + 1} — CHF ${item.total}</h4>
        ${designImageBlock}
        <table style="width:100%;border-collapse:collapse;">
          ${row("Date", itemDateLabel(item))}
          ${row("Taille", item.size)}
          ${row("Forme", item.shape)}
          ${row("Parfum", flavorsLabel(item.flavors))}
          ${row("Design", item.design)}
          ${row("Couleur de base", item.base_color)}
          ${row("Couleur de déco", item.decoration_color)}
          ${row("Couleur intérieure", item.inside_color)}
          ${row("Texte sur le gâteau", item.cake_text ? `"${item.cake_text}" (${item.text_style || "normal"}, ${item.text_color || "default"})` : null)}
          ${row("Suppléments", item.extra || null)}
          ${row("Bougies", candlesList || null)}
          ${row("Instructions", realComment(item.item_comment))}
        </table>
        ${itemReferenceImagesBlock(item)}
      </div>`;
  }).join("");

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
      
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#1a1a1a,#333);padding:32px;text-align:center;">
        <h1 style="color:#fff;font-size:26px;margin:0 0 8px;font-weight:700;">${isWorkshopOnly ? "🎨 Nouvelle réservation workshop" : "🎂 Nouvelle commande Bento Cake"}</h1>
        <p style="color:#ccc;margin:0;font-size:14px;">${isWorkshopOnly ? "La réservation" : "La commande"} <strong style="color:#fff;">${order.order_number || order.id.slice(0, 8).toUpperCase()}</strong> attend votre validation</p>
      </div>

      <div style="padding:28px;">

        <!-- Customer Info -->
        <div style="background:#f0f7ff;border-radius:12px;padding:20px;margin-bottom:20px;">
          <h3 style="margin:0 0 12px;color:#333;font-size:15px;font-weight:600;">👤 Informations client</h3>
          <table style="border-collapse:collapse;width:100%;">
            ${row("Nom", `${order.first_name || ""} ${order.last_name || ""}`.trim())}
            ${row("Email", order.email)}
            ${row("Téléphone", order.phone)}
          </table>
        </div>

        <!-- Pickup / Delivery (physical products only) -->
        ${order.delivery_method ? `
        <div style="background:#f0fff4;border-radius:12px;padding:20px;margin-bottom:20px;">
          <h3 style="margin:0 0 12px;color:#333;font-size:15px;font-weight:600;">📦 Retrait / Livraison</h3>
          <table style="border-collapse:collapse;width:100%;">
            ${row("Date", formatDateCH(order.pickup_delivery_date))}
            ${row("Créneau", order.pickup_delivery_slot || "—")}
            ${row("Option", order.delivery_method === "delivery" ? "🚚 Livraison" : "🏪 Retrait sur place")}
            ${row("Adresse", order.delivery_method === "delivery" ? order.delivery_address : STORE_ADDRESS)}
            ${row("Remarques", order.order_comment || null)}
          </table>
        </div>` : ""}

        <!-- Order Items (each item's own reference images, if any, are
             rendered inside its own card above — see itemReferenceImagesBlock) -->
        <h3 style="color:#333;font-size:15px;margin:0 0 4px;font-weight:600;">🍰 Articles commandés (${items.length})</h3>
        ${itemBlocks}

        <!-- Payment -->
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:20px;margin:20px 0;">
          <h3 style="margin:0 0 12px;color:#333;font-size:15px;font-weight:600;">💳 Récapitulatif du paiement</h3>
          <table style="border-collapse:collapse;width:100%;">
             ${row("Commande №", order.order_number || order.id.slice(0, 8).toUpperCase())}
             ${row("Facture №", order.invoice_number || "—")}
            ${(Number(order.express_surcharge_amount) || 0) > 0 ? row("Supplément express", `CHF ${Number(order.express_surcharge_amount).toFixed(2)}`) : ""}
            ${row("Total", `CHF ${order.total_amount}`)}
            ${row("Statut", mixed
              ? "⏳ Paiement autorisé (non encaissé) — en attente de votre validation (gâteau + atelier ensemble)"
              : "⏳ Paiement autorisé (non encaissé) — en attente de votre validation")}
          </table>
        </div>

        <!-- Action Buttons -->
        <div style="text-align:center;margin:32px 0 16px;">
          <p style="color:#666;font-size:13px;margin-bottom:20px;">${mixed
            ? "Le paiement n'est qu'autorisé, pas encore encaissé. Votre décision porte sur la commande entière (gâteau et atelier ensemble). Accepter encaisse le paiement et confirme tout ; refuser annule l'autorisation sans rien prélever et libère la/les place(s) d'atelier."
            : isWorkshopOnly
              ? "Le paiement n'est qu'autorisé, pas encore encaissé. Accepter encaisse le paiement et confirme la réservation ; refuser annule l'autorisation sans rien prélever et libère la/les place(s)."
              : "Le paiement n'est qu'autorisé, pas encore encaissé. Cliquez sur un bouton pour traiter cette commande. Aucune connexion requise."}</p>

          <a href="${siteUrl}/order-action?orderId=${order.id}&action=approve&token=${token}" style="display:inline-block;background:#16a34a;color:#fff;padding:16px 40px;border-radius:10px;text-decoration:none;font-size:17px;font-weight:600;margin:0 8px 12px;">
            ${isWorkshopOnly ? "✅ Accepter la réservation" : "✅ Accepter la commande"}
          </a>

          <a href="${siteUrl}/order-action?orderId=${order.id}&action=decline&token=${token}" style="display:inline-block;background:#dc2626;color:#fff;padding:16px 40px;border-radius:10px;text-decoration:none;font-size:17px;font-weight:600;margin:0 8px 12px;">
            ${isWorkshopOnly ? "❌ Refuser la réservation" : "❌ Refuser la commande"}
          </a>
        </div>

        <p style="color:#999;font-size:12px;text-align:center;margin-top:8px;">
          Chaque bouton ne peut être utilisé qu’une seule fois.
        </p>

        <p style="color:#999;font-size:12px;text-align:center;margin-top:4px;">
          <a href="${reviewUrl}" style="color:#666;">Voir le détail complet de la ${isWorkshopOnly ? "réservation" : "commande"} →</a>
        </p>
      </div>

      <!-- Footer -->
      <div style="background:#fafafa;padding:16px;text-align:center;border-top:1px solid #eee;">
        <p style="color:#aaa;font-size:11px;margin:0;">Bento Cake Studio · Système de notification des commandes</p>
      </div>
    </div>
  </div>
</body>
</html>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
      // Stable per order — confirm-postfinance-payment retries this invocation
      // until orders.admin_notified_at is set, so a duplicate invoke must not
      // send a second admin e-mail. Resend keeps the key ~24h.
      "Idempotency-Key": `notify-order-${order.id}`,
    },
    body: JSON.stringify({
      from: "contact@bentocakestudio.ch",
      to: ADMIN_EMAILS,
      subject: isWorkshopOnly
        ? `🎨 Nouvelle réservation workshop ${order.order_number || order.id.slice(0, 8).toUpperCase()} — ${order.first_name || ""} ${order.last_name || ""} (CHF ${order.total_amount})`
        : `🎂 Nouvelle commande Bento Cake ${order.order_number || order.id.slice(0, 8).toUpperCase()} — ${order.first_name || ""} ${order.last_name || ""} (CHF ${order.total_amount})`,
      html,
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    console.error("Email send failed:", data);
    throw new Error(`Resend error: ${JSON.stringify(data)}`);
  }
  console.log("Admin email sent:", data.id);
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

    const { data: order, error: orderError } = await supabase
      .from("orders").select("*").eq("id", orderId).single();

    if (orderError || !order) throw new Error("Order not found");

    // Every article of this order lives in its own order_items row — this
    // is what makes the "Détails de commande" side of the email/Notion
    // complete for multi-cake orders, not just the first item.
    const { data: items, error: itemsError } = await supabase
      .from("order_items").select("*").eq("order_id", orderId).order("created_at", { ascending: true });

    if (itemsError) throw new Error(`Failed to load order_items: ${itemsError.message}`);

    // Multi-date fulfillment: one row per distinct physical pickup/delivery
    // date, linked from each order_item via fulfillment_id — read here
    // (service_role, no RLS concern) so each cake in the e-mail can show
    // its own date instead of assuming the whole order shares one.
    const { data: fulfillments, error: fulfillmentsError } = await supabase
      .from("order_fulfillments").select("*").eq("order_id", orderId);
    if (fulfillmentsError) throw new Error(`Failed to load order_fulfillments: ${fulfillmentsError.message}`);

    // 2026-09-15 (deferred capture restored): EVERY fulfilment type now goes
    // through the same Accept/Refuse admin decision, workshop_only included
    // — no more auto-confirmation, no more "info notification only" email.
    // A token is always created below.
    const wsItems = (items ?? []).filter((it: any) => it.product === "workshop");
    const physItems = (items ?? []).filter((it: any) => it.product !== "workshop");
    const fulfillmentType: string = order.fulfillment_type ||
      (wsItems.length > 0 ? (physItems.length > 0 ? "mixed" : "workshop_only") : "cake_only");
    const isWorkshopOnly = fulfillmentType === "workshop_only";
    const mixed = fulfillmentType === "mixed";

    // Single-use accept/decline token. notify-order is normally invoked once
    // per order, but the payment-resilience webhook means a retry is
    // possible if a previous invocation created the token and then died
    // before Resend accepted the email. Reuse an existing token in that case
    // instead of failing or stacking one.
    let token: string | null = null;
    {
      const { data: existingToken } = await supabase
        .from("order_action_tokens")
        .select("token")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (existingToken?.token) {
        token = existingToken.token;
      } else {
        token = crypto.randomUUID() + "-" + crypto.randomUUID();
        const { error: tokenError } = await supabase
          .from("order_action_tokens")
          .insert({ order_id: orderId, token });
        if (tokenError) {
          const { data: raced } = await supabase
            .from("order_action_tokens")
            .select("token")
            .eq("order_id", orderId)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (raced?.token) {
            token = raced.token;
          } else {
            console.error("Token creation error:", tokenError);
            throw new Error("Failed to create action token");
          }
        }
      }
    }

    const siteUrl = getSiteBaseUrl();
    const results: { email?: any; errors: string[] } = { errors: [] };

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      try { results.email = await sendAdminEmail(resendKey, order, items || [], fulfillments || [], siteUrl, token, isWorkshopOnly, mixed); }
      catch (e) { console.error("Email error:", e); results.errors.push(`Email: ${e instanceof Error ? e.message : String(e)}`); }
    } else { results.errors.push("RESEND_API_KEY not configured"); }

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error in notify-order:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      status: 500,
    });
  }
});
