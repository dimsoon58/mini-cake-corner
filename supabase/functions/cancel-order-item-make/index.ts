// Copie de production récupérée le 05.10.2026 (retour-production-F26.zip), identique au code
// déployé sauf « Authentification de Make ». Destinée au seul scénario Make 7425367 ; à supprimer
// le jour de l'arrêt de 7425367.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function humanize(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s) return "";
  const mapped: Record<string, string> = {
    bento_cake: "Bento Cake",
    dot_cakes: "Dot Cakes",
    dot_cake: "Dot Cake",
    diy_kit: "DIY Kit",
    printing: "Printing",
    bento: "Bento",
    retro: "Retro Box",
    medium: "Medium",
    large: "Large",
    rectangle: "Rectangle",
    round: "Round",
    heart: "Heart",
  };
  if (mapped[s]) return mapped[s];
  return s
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatDate(value: unknown): string {
  const s = String(value ?? "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}

function formatFlavors(value: unknown): string {
  if (Array.isArray(value)) return value.map(humanize).filter(Boolean).join(", ");
  return humanize(value);
}

function formatExtras(value: unknown): string {
  if (Array.isArray(value)) return value.map(humanize).filter(Boolean).join(", ");
  return humanize(value);
}

function detailRow(label: string, value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return `<tr><td style="padding:6px 8px;color:#7A6540;font-size:14px;width:40%;">${esc(label)}</td><td style="padding:6px 8px;color:#351E13;font-size:14px;">${esc(text)}</td></tr>`;
}

// ── Authentification de Make (audit 05.10.2026, v2) ─────────────────────
// Fonction appelée UNIQUEMENT par Make (scénario 7425367). Deux preuves
// seulement, comparées à temps constant à des valeurs gardées côté serveur :
//   1. en-tête « x-make-function-secret » = secret dédié MAKE_FUNCTIONS_SECRET
//      (au moins 32 caractères ; ajouté dans les modules Make lors de la
//      transition coordonnée) ;
//   2. clé service_role EXACTE du projet (Authorization: Bearer … ou apikey)
//      = SUPABASE_SERVICE_ROLE_KEY.
// Tout le reste est refusé (403) avant de lire la requête : clé publique
// (sb_publishable_…, ancienne clé anon), jeton d'une personne connectée,
// clé « sb_secret_… » quelconque, jeton se disant « service_role » mais
// différent de la clé du projet. Le préfixe ou le rôle d'un jeton ne sont
// jamais une preuve. Les journaux indiquent la preuve utilisée, jamais la clé.
function makeSafeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function makeCallerRefusal(req: Request, fn: string): Response | null {
  const dedicated = Deno.env.get("MAKE_FUNCTIONS_SECRET") ?? "";
  const given = req.headers.get("x-make-function-secret") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const apikey = (req.headers.get("apikey") ?? "").trim();
  let via = "refused";
  if (dedicated.length >= 32 && makeSafeEqual(given, dedicated)) via = "dedicated_secret";
  else if (serviceKey && (makeSafeEqual(bearer, serviceKey) || makeSafeEqual(apikey, serviceKey))) via = "service_role_key";
  console.log(`[${fn}] make_auth=${via}`);
  if (via !== "refused") return null;
  return new Response(JSON.stringify({ error: "Caller not allowed", reason: "make_auth" }), {
    status: 403, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const refused = makeCallerRefusal(req, "cancel-order-item-make");
  if (refused) return refused;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey || !resendKey) {
    return json({
      error: "Server partial-cancellation configuration is incomplete",
      has_supabase_url: Boolean(supabaseUrl),
      has_service_role_key: Boolean(serviceRoleKey),
      has_resend_api_key: Boolean(resendKey),
    }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const orderItemId = String(body.orderItemId ?? body.order_item_id ?? "").trim();
  if (!orderItemId) return json({ error: "Missing orderItemId" }, 400);

  const authHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    Accept: "application/json",
  };

  const itemResp = await fetch(
    `${supabaseUrl}/rest/v1/order_items?id=eq.${encodeURIComponent(orderItemId)}&select=id,order_id,order_number,product,size,shape,flavors,design,design_image_url,base_color,decoration_color,extras,total,production_status,fulfillment_id,cancellation_email_id,cancellation_email_sent_at&limit=1`,
    { headers: authHeaders },
  );
  if (!itemResp.ok) return json({ error: "Unable to load order item", details: await itemResp.text() }, 502);
  const itemRows = await itemResp.json();
  const item = Array.isArray(itemRows) && itemRows.length ? itemRows[0] as Record<string, unknown> : null;
  if (!item) return json({ error: "Order item not found" }, 404);

  const orderId = String(item.order_id ?? "").trim();
  if (!orderId) return json({ error: "Order item has no parent order" }, 409);

  const orderResp = await fetch(
    `${supabaseUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,order_number,lang,first_name,last_name,email,order_validation,payment_status&limit=1`,
    { headers: authHeaders },
  );
  if (!orderResp.ok) return json({ error: "Unable to load parent order", details: await orderResp.text() }, 502);
  const orderRows = await orderResp.json();
  const order = Array.isArray(orderRows) && orderRows.length ? orderRows[0] as Record<string, unknown> : null;
  if (!order) return json({ error: "Parent order not found" }, 404);

  if (!String(order.email ?? "").trim()) return json({ error: "Parent order has no customer email" }, 409);

  if (String(item.production_status ?? "") !== "cancelled") {
    const siblingsResp = await fetch(
      `${supabaseUrl}/rest/v1/order_items?order_id=eq.${encodeURIComponent(orderId)}&select=id,production_status`,
      { headers: authHeaders },
    );
    if (!siblingsResp.ok) return json({ error: "Unable to validate sibling items", details: await siblingsResp.text() }, 502);
    const siblings = await siblingsResp.json();
    const activeCount = Array.isArray(siblings)
      ? siblings.filter((row) => String(row?.production_status ?? "") !== "cancelled").length
      : 0;
    if (activeCount <= 1) {
      return json({
        error: "last_active_item_use_full_order_cancellation",
        message: "This is the last active item. Use Commandes & Paiements for whole-order cancellation.",
      }, 409);
    }
  }

  if (String(item.production_status ?? "") !== "cancelled") {
    const cancelResp = await fetch(`${supabaseUrl}/rest/v1/order_items?id=eq.${encodeURIComponent(orderItemId)}`, {
      method: "PATCH",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ production_status: "cancelled" }),
    });
    if (!cancelResp.ok) return json({ error: "Unable to cancel order item", details: await cancelResp.text() }, 502);
  }

  if (item.cancellation_email_sent_at) {
    return json({
      success: true,
      already_cancelled: true,
      email_already_sent: true,
      order_item_id: orderItemId,
      order_number: order.order_number ?? item.order_number ?? null,
      email_id: item.cancellation_email_id ?? null,
    });
  }

  let fulfillment: Record<string, unknown> | null = null;
  const fulfillmentId = String(item.fulfillment_id ?? "").trim();
  const fulfillmentUrl = fulfillmentId
    ? `${supabaseUrl}/rest/v1/order_fulfillments?id=eq.${encodeURIComponent(fulfillmentId)}&select=pickup_delivery_date,pickup_delivery_slot,delivery_method&limit=1`
    : `${supabaseUrl}/rest/v1/order_fulfillments?order_id=eq.${encodeURIComponent(orderId)}&select=pickup_delivery_date,pickup_delivery_slot,delivery_method&limit=1`;
  const fulfillmentResp = await fetch(fulfillmentUrl, { headers: authHeaders });
  if (fulfillmentResp.ok) {
    const rows = await fulfillmentResp.json();
    if (Array.isArray(rows) && rows.length) fulfillment = rows[0] as Record<string, unknown>;
  }

  const lang = String(order.lang ?? "en").toLowerCase().startsWith("fr") ? "fr" : "en";
  const orderNumber = String(order.order_number ?? item.order_number ?? "").trim();
  const firstName = String(order.first_name ?? "").trim();
  const product = humanize(item.product);
  const size = humanize(item.size);
  const flavor = formatFlavors(item.flavors);
  const shape = humanize(item.shape);
  const design = humanize(item.design);
  const baseColor = humanize(item.base_color);
  const decorationColor = humanize(item.decoration_color);
  const extras = formatExtras(item.extras);
  const date = formatDate(fulfillment?.pickup_delivery_date);
  const slot = String(fulfillment?.pickup_delivery_slot ?? "").trim();
  const imageUrl = String(item.design_image_url ?? "").trim();

  const labels = lang === "fr"
    ? { size: "Taille", flavor: "Parfum", shape: "Forme", design: "Design", base: "Couleur de base", deco: "Couleur décoration", extras: "Extras", date: "Date", slot: "Créneau" }
    : { size: "Size", flavor: "Flavour", shape: "Shape", design: "Design", base: "Base colour", deco: "Decoration colour", extras: "Extras", date: "Date", slot: "Time slot" };

  const details = [
    detailRow(labels.size, size),
    detailRow(labels.flavor, flavor),
    detailRow(labels.shape, shape),
    detailRow(labels.design, design),
    detailRow(labels.base, baseColor),
    detailRow(labels.deco, decorationColor),
    detailRow(labels.extras, extras),
    detailRow(labels.date, date),
    detailRow(labels.slot, slot),
  ].join("");

  const subject = lang === "fr"
    ? `Annulation partielle de votre commande — n° ${orderNumber}`
    : `Partial cancellation — #${orderNumber}`;

  const greeting = lang === "fr" ? `Bonjour ${firstName || ""},` : `Hello ${firstName || ""},`;
  const intro = lang === "fr"
    ? `Suite à votre demande, nous confirmons l’annulation d’un article de votre commande <strong>n° ${esc(orderNumber)}</strong>.`
    : `Following your request, we confirm the cancellation of one item from your order <strong>#${esc(orderNumber)}</strong>.`;
  const itemHeading = lang === "fr" ? "Article annulé" : "Cancelled item";
  const remaining = lang === "fr"
    ? "Les autres articles de votre commande restent confirmés."
    : "The other items in your order remain confirmed.";
  const signoff = lang === "fr" ? "À bientôt," : "See you soon,";
  const team = lang === "fr" ? "L’équipe Bento Cake Studio" : "The Bento Cake Studio Team";

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#78020C;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;">
    <div style="background:#FDF8E1;margin:0 20px;">
      <div style="padding:36px 40px 0;text-align:center;">
        <img src="https://dimsoon58.github.io/mini-cake-corner/logo-red-email.png" alt="Bento Cake Studio" style="width:240px;height:auto;display:block;margin:0 auto 28px;" />
      </div>
      <div style="padding:0 40px 36px;">
        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 12px;">${esc(greeting)}</p>
        <div style="border-left:3px solid #78020C;background:#F5EDCC;padding:14px 18px;margin:0 0 20px;">
          <p style="color:#351E13;font-size:14px;line-height:1.7;margin:0;">${intro}</p>
        </div>
        <p style="color:#78020C;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;margin:24px 0 8px;">${esc(itemHeading)}</p>
        <div style="background:#FDF8E1;border:1px solid #78020C;border-radius:12px;padding:20px;margin:12px 0 20px;">
          <h3 style="margin:0 0 12px;color:#351E13;font-size:15px;font-weight:600;">${esc(product)}</h3>
          ${imageUrl ? `<img src="${esc(imageUrl)}" alt="Chosen design" style="max-width:220px;width:100%;height:auto;border-radius:8px;border:1px solid #78020C;display:block;margin:0 0 12px;" />` : ""}
          <table style="border-collapse:collapse;width:100%;">${details}</table>
        </div>
        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 20px;">${esc(remaining)}</p>
        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0;">${esc(signoff)}<br><strong>${esc(team)}</strong> 🤍</p>
      </div>
    </div>
    <div style="height:24px;background:#78020C;"></div>
  </div>
</body>
</html>`;

  const text = lang === "fr"
    ? `${greeting}\n\nSuite à votre demande, nous confirmons l’annulation d’un article de votre commande n° ${orderNumber}.\n\n${itemHeading}\n${product}${size ? ` — ${size}` : ""}${flavor ? ` — ${flavor}` : ""}${design ? ` — ${design}` : ""}${date ? `\n${date}${slot ? ` · ${slot}` : ""}` : ""}\n\n${remaining}\n\n${signoff}\n${team} 🤍`
    : `${greeting}\n\nFollowing your request, we confirm the cancellation of one item from your order #${orderNumber}.\n\n${itemHeading}\n${product}${size ? ` — ${size}` : ""}${flavor ? ` — ${flavor}` : ""}${design ? ` — ${design}` : ""}${date ? `\n${date}${slot ? ` · ${slot}` : ""}` : ""}\n\n${remaining}\n\n${signoff}\n${team} 🤍`;

  const emailResp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `order-item-cancellation-${orderItemId}`,
    },
    body: JSON.stringify({
      from: "Bento Cake Studio <contact@bentocakestudio.ch>",
      to: [String(order.email)],
      subject,
      html,
      text,
    }),
  });

  const emailText = await emailResp.text();
  let emailData: Record<string, unknown> | null = null;
  try { emailData = emailText ? JSON.parse(emailText) : null; } catch { emailData = null; }

  if (!emailResp.ok && emailResp.status !== 409) {
    return json({
      error: "item_cancelled_but_email_failed",
      order_item_id: orderItemId,
      order_number: orderNumber,
      email_status: emailResp.status,
      email_response: emailData ?? emailText,
    }, 502);
  }

  const emailId = String(emailData?.id ?? item.cancellation_email_id ?? "").trim() || null;
  const trackingResp = await fetch(`${supabaseUrl}/rest/v1/order_items?id=eq.${encodeURIComponent(orderItemId)}`, {
    method: "PATCH",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      cancellation_email_id: emailId,
      cancellation_email_sent_at: new Date().toISOString(),
    }),
  });

  if (!trackingResp.ok) {
    return json({
      error: "email_sent_but_tracking_failed",
      order_item_id: orderItemId,
      order_number: orderNumber,
      email_id: emailId,
      details: await trackingResp.text(),
    }, 502);
  }

  return json({
    success: true,
    order_item_id: orderItemId,
    order_number: orderNumber,
    product,
    production_status: "cancelled",
    email_sent: true,
    email_id: emailId,
  });
});