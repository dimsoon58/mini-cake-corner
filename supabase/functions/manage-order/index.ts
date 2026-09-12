import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

// NEW MODEL: manage-order NEVER moves money and NEVER touches workshop
// reservations. The payment is captured at checkout; the workshop part
// auto-confirms in runSideEffects (workshop-only and mixed alike). manage-order
// only records the admin's decision on the PHYSICAL part. A physical refusal is
// flagged refund_status = 'to_refund' and refunded by hand in PostFinance.
// (The old PostFinance capture/void/refund block and the
// syncWorkshopReservationsAfterDecision helper were removed here.)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function formatDateCH(dateValue?: string): string {
  if (!dateValue) return "—";
  const [year, month, day] = dateValue.split("-");
  return year && month && day ? `${day}.${month}.${year}` : dateValue;
}

function customerName(order: any): string {
  return `${order.first_name || ""} ${order.last_name || ""}`.trim();
}

// Reference images now live per-item, on order_items.reference_images.
function getOrderImageUrls(items: any[]): string[] {
  return items.flatMap((item: any) =>
    Array.isArray(item?.reference_images)
      ? item.reference_images.filter((u: unknown): u is string => typeof u === "string" && u.length > 0)
      : []
  );
}

// ── Customer language helper ────────────────────────────────────────
// orders.lang is written by Checkout.tsx directly (top-level column, no
// longer nested in JSON). Customer-facing emails and the invoice follow
// that language; French is the default.
function getCustomerLang(order: any): "fr" | "en" {
  return order?.lang === "en" ? "en" : "fr";
}

// ── Approval confirmation email ─────────────────────────────────────

async function sendApprovalEmail(resendApiKey: string, order: any, items: any[], paymentMethodLabel: string, pdfBase64?: string | null) {
  const lang = getCustomerLang(order);
  const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);

  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();

  // Order shape — drives which wording / blocks appear. Never changes any
  // payment, capture, void or order_validation logic.
  const workshopItems = items.filter((it: any) => it.product === "workshop");
  const physicalItems = items.filter((it: any) => it.product !== "workshop");
  const workshopOnly = workshopItems.length > 0 && physicalItems.length === 0;
  const mixed = workshopItems.length > 0 && physicalItems.length > 0;

  // Bento identity: bordeaux #78020C (accents, section titles, borders,
  // banners) + cream #FDF8E1 (main background). Running text uses the SAME
  // browns already used for this in send-order-received-email — not a new
  // approximate colour: #351E13 for body copy / row values / card titles,
  // #7A6540 for the muted label side of a row. Text on a bordeaux surface
  // is cream (table headers, Total row, footer bar).
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 8px;color:#7A6540;font-size:14px;width:40%;">${label}</td><td style="padding:6px 8px;color:#351E13;font-size:14px;font-weight:600;">${value}</td></tr>`;

  // Physical items only — workshops render in their own block below.
  const cakeDetailsRows = physicalItems.map((item: any, i: number) => {
    const candleStr = item.candle_name
      ? `${item.candle_name}${item.candle_quantity ? ` ×${item.candle_quantity}` : ""}`
      : "";

    const rows: string[] = [];
    if (item.size) rows.push(row(tr("Size", "Taille"), item.size));
    if (item.flavors?.length) rows.push(row(tr("Flavour", "Parfum"), item.flavors.join(", ")));
    if (item.shape) rows.push(row(tr("Shape", "Forme"), item.shape));
    if (item.design) rows.push(row(tr("Design", "Design"), item.design));
    if (item.base_color) rows.push(row(tr("Base colour", "Couleur de base"), item.base_color));
    if (item.decoration_color) rows.push(row(tr("Decoration colour", "Couleur de décoration"), item.decoration_color));
    if (item.text_color) rows.push(row(tr("Text colour", "Couleur du texte"), item.text_color));
    if (item.text_style) rows.push(row(tr("Text style", "Style du texte"), item.text_style));
    if (item.cake_text) rows.push(row(tr("Text on cake", "Texte sur le gâteau"), item.cake_text));
    if (item.extra) rows.push(row(tr("Extras", "Suppléments"), item.extra));
    if (candleStr) rows.push(row(tr("Candles", "Bougies"), candleStr));
    if (item.item_comment?.trim()) rows.push(row(tr("Additional note", "Remarque complémentaire"), item.item_comment.trim()));

    return `
      <div style="background:#FDF8E1;border:1px solid #78020C;border-radius:12px;padding:20px;margin:12px 0;">
        <h3 style="margin:0 0 12px;color:#351E13;font-size:15px;font-weight:600;">${tr("Cake", "Gâteau")}${physicalItems.length > 1 ? ` ${i + 1}` : ""}</h3>
        <table style="border-collapse:collapse;width:100%;">
          ${rows.join("")}
        </table>
      </div>`;
  }).join("");

  // Section label + the cards above — only when the order actually has a
  // physical/cake part (always true in practice: sendApprovalEmail only
  // ever fires for the physical-part decision, never for a workshop-only
  // order). Same "Order details" copy as sendDeclineEmail, for consistency.
  const cakeDetailsBlock = physicalItems.length > 0
    ? `
        <p style="color:#78020C;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;margin:24px 0 8px;">
          ${tr("Order details", "Détails de la commande")}
        </p>
        ${cakeDetailsRows}`
    : "";

  // Workshop detail block — one card per workshop line, shown only when the
  // order actually contains a workshop. Never presented as a cake.
  const workshopDetailsRows = workshopItems.map((item: any, i: number) => {
    const wsName = item.workshop_type === "paint" ? tr("Paint Workshop", "Atelier Peinture") : tr("Signature Workshop", "Atelier Signature");
    const wsRows = [
      item.workshop_reference ? row(tr("Booking reference", "Référence de réservation"), item.workshop_reference) : "",
      row(tr("Workshop", "Atelier"), wsName),
      item.workshop_date ? row(tr("Date", "Date"), formatDateCH(item.workshop_date)) : "",
      item.workshop_time ? row(tr("Time", "Horaire"), item.workshop_time) : "",
      item.workshop_participants != null ? row(tr("Participants", "Participants"), String(item.workshop_participants)) : "",
      item.workshop_unit_price != null ? row(tr("Price per person", "Prix par personne"), `CHF ${Number(item.workshop_unit_price).toFixed(2)}`) : "",
      item.total != null ? row(tr("Workshop total", "Total du workshop"), `CHF ${Number(item.total).toFixed(2)}`) : "",
      item.item_comment?.trim() ? row(tr("Notes", "Notes"), item.item_comment.trim()) : "",
    ].join("");
    return `
      <div style="background:#FDF8E1;border:1px solid #78020C;border-radius:12px;padding:20px;margin:12px 0;">
        <h3 style="margin:0 0 12px;color:#351E13;font-size:15px;font-weight:600;">${wsName}${workshopItems.length > 1 ? ` ${i + 1}` : ""}</h3>
        <table style="border-collapse:collapse;width:100%;">${wsRows}</table>
      </div>`;
  }).join("");

  const workshopDetailsBlock = workshopItems.length > 0
    ? `
        <p style="color:#78020C;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;margin:24px 0 8px;">
          ${tr("Workshop details", "Détails du workshop")}
        </p>
        ${workshopDetailsRows}`
    : "";

  // Reference images block, from order_items.reference_images
  const orderImageUrls = getOrderImageUrls(items);
  const orderImagesBlock = orderImageUrls.length
    ? `
      <div style="background:#FDF8E1;border:1px solid #78020C;border-radius:12px;padding:20px;margin:12px 0;">
        <h3 style="margin:0 0 12px;color:#351E13;font-size:15px;font-weight:600;">${tr("Reference images", "Images de référence")}</h3>
        <table style="border-collapse:collapse;width:100%;">
          ${orderImageUrls.map((url: string, j: number) =>
            `<tr><td style="padding:8px;color:#7A6540;font-size:14px;vertical-align:top;">Image ${j + 1}</td><td style="padding:8px;"><a href="${url}" style="color:#78020C;font-size:14px;display:inline-block;margin-bottom:6px;font-weight:600;text-decoration:underline;" target="_blank">${tr("Open image", "Ouvrir l’image")}</a><br/><img src="${url}" alt="${tr("Reference image", "Image de référence")} ${j + 1}" style="max-width:220px;width:100%;height:auto;border-radius:8px;border:1px solid #78020C;display:block;" /></td></tr>`
          ).join("")}
        </table>
      </div>`
    : "";

  const itemSummaryRows = items.map((item: any) => {
    const label = item.product === "workshop"
      ? `${item.workshop_type === "paint" ? tr("Paint Workshop", "Atelier Peinture") : tr("Signature Workshop", "Atelier Signature")}`
        + `${item.workshop_date ? " — " + formatDateCH(item.workshop_date) : ""}`
        + `${item.workshop_time ? " · " + item.workshop_time : ""}`
        + `${item.workshop_participants ? ` — ${item.workshop_participants} ${tr("participant(s)", "participant(s)")}` : ""}`
      : `${item.size || ""} ${item.shape || ""} — ${(item.flavors || []).join(", ")}`;
    return `
    <tr>
      <td style="padding:12px;border-bottom:1px solid #78020C;font-size:14px;color:#351E13;">${label}</td>
      <td style="padding:12px;border-bottom:1px solid #78020C;font-size:14px;color:#351E13;text-align:right;white-space:nowrap;">CHF ${item.total}</td>
    </tr>`;
  }).join("");

  // Same wordmark asset + size as sendDeclineEmail (240px, auto height) —
  // was logo-red.png at height:72px here only; now consistent across both
  // customer-facing decision emails.
  const logoUrl = "https://dimsoon58.github.io/mini-cake-corner/logo-red-email.png";
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#78020C;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;">

    <div style="background:#FDF8E1;margin:0 20px;">
      <div style="padding:36px 40px 0;text-align:center;">
        <img src="${logoUrl}" alt="Bento Cake Studio" style="width:240px;height:auto;display:block;margin:0 auto 28px;" />
      </div>

      <div style="padding:0 40px 36px;">
        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 12px;">
          ${tr("Dear", "Bonjour")} ${customerName(order)},
        </p>

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 12px;">
          ${tr("Thank you for choosing Bento Cake Studio.", "Merci d'avoir choisi Bento Cake Studio.")}
        </p>
        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 20px;">
          ${workshopOnly
            ? tr(
                "Your workshop booking is now confirmed.",
                "Votre réservation de workshop est maintenant confirmée."
              )
            : tr(
                `Your order <strong>#${orderNumber}</strong> is now confirmed.`,
                `Votre commande <strong>n° ${orderNumber}</strong> est maintenant confirmée.`
              )}
        </p>

        <p style="color:#78020C;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;margin:0 0 8px;">
          ${order.delivery_method === "delivery"
            ? tr("Delivery details", "Détails de la livraison")
            : order.delivery_method === "pickup"
              ? tr("Pickup details", "Détails du retrait")
              : tr("Payment", "Paiement")}
        </p>
        <table style="border-collapse:collapse;width:100%;border:1px solid #78020C;margin:0 0 24px;">
          ${order.delivery_method ? row(tr("Date", "Date"), formatDateCH(order.pickup_delivery_date)) : ""}
          ${order.delivery_method && order.pickup_delivery_slot ? row(tr("Time", "Heure"), order.pickup_delivery_slot) : ""}
          ${order.delivery_method === "pickup" ? row(tr("Mode", "Mode"), tr("Pickup at store", "Retrait sur place")) : ""}
          ${order.delivery_method === "delivery" ? row(tr("Mode", "Mode"), tr("Delivery", "Livraison")) : ""}
          ${order.delivery_method === "delivery" ? row(tr("Address", "Adresse"), order.delivery_address || "—") : ""}
        </table>

        ${cakeDetailsBlock}

        ${workshopDetailsBlock}

        ${orderImagesBlock}

        <p style="color:#78020C;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;margin:24px 0 8px;">
          ${tr("Order summary", "Récapitulatif de la commande")}
        </p>
        <table style="width:100%;border-collapse:collapse;border:1px solid #78020C;margin-bottom:24px;">
          <thead>
            <tr style="background:#78020C;">
              <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#FDF8E1;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${tr("Item", "Article")}</th>
              <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#FDF8E1;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${tr("Price", "Prix")}</th>
            </tr>
          </thead>
          <tbody>
            ${itemSummaryRows}
            ${(Number(order.express_surcharge_amount) || 0) > 0 ? `<tr>
              <td style="padding:12px 14px;border-bottom:1px solid #78020C;font-size:14px;color:#351E13;">${tr("Near-date surcharge", "Supplément date rapprochée")}</td>
              <td style="padding:12px 14px;border-bottom:1px solid #78020C;font-size:14px;color:#351E13;text-align:right;white-space:nowrap;">CHF ${Number(order.express_surcharge_amount).toFixed(2)}</td>
            </tr>` : ""}
            ${(Number(order.welcome_discount_amount) || 0) > 0 ? `<tr>
              <td style="padding:12px 14px;border-bottom:1px solid #78020C;font-size:14px;color:#351E13;">${tr("Welcome discount", "Réduction de bienvenue")}</td>
              <td style="padding:12px 14px;border-bottom:1px solid #78020C;font-size:14px;color:#351E13;text-align:right;white-space:nowrap;">- CHF ${Number(order.welcome_discount_amount).toFixed(2)}</td>
            </tr>` : ""}
            ${(Number(order.reward_amount_used) || 0) > 0 ? `<tr>
              <td style="padding:12px 14px;border-bottom:1px solid #78020C;font-size:14px;color:#351E13;">${tr("Reward used", "Cagnotte utilisée")}</td>
              <td style="padding:12px 14px;border-bottom:1px solid #78020C;font-size:14px;color:#351E13;text-align:right;white-space:nowrap;">- CHF ${Number(order.reward_amount_used).toFixed(2)}</td>
            </tr>` : ""}
            ${(Number(order.delivery_fee) || 0) > 0 ? `<tr>
              <td style="padding:12px 14px;border-bottom:1px solid #78020C;font-size:14px;color:#351E13;">${tr("Delivery", "Livraison")}</td>
              <td style="padding:12px 14px;border-bottom:1px solid #78020C;font-size:14px;color:#351E13;text-align:right;white-space:nowrap;">CHF ${Number(order.delivery_fee).toFixed(2)}</td>
            </tr>` : ""}
          </tbody>
          <tfoot>
            <tr style="background:#78020C;">
              <td style="padding:10px 14px;font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#FDF8E1;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${tr("Total", "Total")}</td>
              <td style="padding:10px 14px;font-size:15px;font-weight:700;color:#FDF8E1;text-align:right;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">CHF ${order.total_amount}</td>
            </tr>
          </tfoot>
        </table>

        <p style="color:#351E13;font-size:13px;line-height:1.7;margin:0 0 20px;border-top:1px solid #78020C;padding-top:20px;">
          ${tr(
            "If any of these details are incorrect or if you need to make a small change, please contact us as soon as possible.",
            "Si l'une de ces informations est incorrecte ou si vous souhaitez apporter une petite modification, merci de nous contacter au plus vite."
          )}
        </p>

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0;">
          ${workshopOnly
            ? `${tr(
                "Thank you again for your order. We look forward to welcoming you to the workshop!",
                "Merci encore pour votre commande. Nous avons hâte de vous accueillir au workshop !"
              )}<br><br>${tr("Warm regards", "Bien chaleureusement")},<br><strong>Bento Cake Studio</strong> 🤍`
            : mixed
              ? `${tr(
                  "Thank you again for your order. We look forward to preparing your order and welcoming you to Bento Cake Studio.",
                  "Merci encore pour votre commande. Nous avons hâte de préparer votre commande et de vous accueillir chez Bento Cake Studio."
                )}<br><br>${tr("Warm regards", "Bien chaleureusement")},<br><strong>Bento Cake Studio</strong> 🤍`
              // Exact copy validated for the plain cake order case — see
              // sendDeclineEmail's "See you soon" / "À bientôt" sign-off,
              // reused here for consistency between the two decision emails.
              : `${tr(
                  "We can't wait to prepare your cake!",
                  "Nous avons hâte de préparer votre gâteau !"
                )}<br><br>${tr("See you soon", "À bientôt")},<br><strong>Bento Cake Studio</strong> 🤍`}
        </p>
      </div>
    </div>

    <div style="height:24px;background:#78020C;"></div>
  </div>
</body>
</html>`;

  const invoiceNum = order.invoice_number || orderNumber;
  const emailPayload: any = {
    from: "contact@bentocakestudio.ch",
    to: [order.email],
    bcc: ["facturesbentocakestudio@gmail.com"],
    subject: tr(`Order Confirmation — #${orderNumber}`, `Confirmation de commande — n° ${orderNumber}`),
    html,
  };

  if (pdfBase64) {
    emailPayload.attachments = [{
      filename: tr(`Invoice_${invoiceNum}.pdf`, `Facture_${invoiceNum}.pdf`),
      content: pdfBase64,
    }];
  }

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(emailPayload),
  });

  const data = await resp.json();
  if (!resp.ok) {
    console.error("Approval email send failed:", data);
    throw new Error(`Resend error: ${JSON.stringify(data)}`);
  }
  console.log("Approval email sent to customer:", data.id);
  return data;
}

// ── Decline customer email ──────────────────────────────────────────

async function sendDeclineEmail(
  resendApiKey: string,
  order: any,
  items: any[],
  opts?: { fulfillmentType?: "cake_only" | "workshop_only" | "mixed"; refundDue?: number },
) {
  const lang = getCustomerLang(order);
  const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);
  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();
  const rewardOnly = order.postfinance_transaction_id === "REWARD_ONLY";

  const declineWorkshopItems = (items || []).filter((it: any) => it.product === "workshop");
  const declinePhysicalItems = (items || []).filter((it: any) => it.product !== "workshop");
  const workshopOnly = opts?.fulfillmentType === "workshop_only"
    || (declineWorkshopItems.length > 0 && declinePhysicalItems.length === 0);
  const mixed = opts?.fulfillmentType === "mixed"
    || (declineWorkshopItems.length > 0 && declinePhysicalItems.length > 0);

  // Amount the customer will be refunded BY HAND (server-computed upstream):
  //   mixed -> only the cake part; cake-only -> the whole order.
  const refundAmount = mixed && typeof opts?.refundDue === "number"
    ? opts.refundDue
    : Number(order.total_amount ?? 0);
  const amountCHF = refundAmount.toFixed(2);

  const refundText = rewardOnly
    ? tr(
        "Your order has therefore been cancelled. The amount used from your reward balance has been credited back to your account.",
        "Votre commande a donc été annulée. Le montant utilisé depuis votre cagnotte a été recrédité sur votre compte."
      )
    : mixed
      ? tr(
          `Only the cake part of your order has been declined. A refund of CHF ${amountCHF} will be issued to your original payment method within the next few business days. Your workshop booking remains confirmed and paid — nothing changes for it.`,
          `Seule la partie gâteau de votre commande a été refusée. Un remboursement de CHF ${amountCHF} sera effectué sur votre moyen de paiement d'origine dans les prochains jours ouvrables. Votre réservation d'atelier reste confirmée et payée — rien ne change de ce côté.`
        )
      : tr(
          `Your order has therefore been cancelled, and you will receive a full refund. The amount of CHF ${amountCHF} will be credited back to your account within the next few business days, depending on your bank's processing times.`,
          `Votre commande a donc été annulée et vous recevrez un remboursement intégral. Le montant de CHF ${amountCHF} sera recrédité sur votre compte dans les prochains jours ouvrables, selon les délais de votre établissement bancaire.`
        );

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#78020C;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;">

    <div style="background:#FDF8E1;margin:0 20px;">
      <div style="padding:36px 40px 0;text-align:center;">
        <img src="https://dimsoon58.github.io/mini-cake-corner/logo-red-email.png" alt="Bento Cake Studio" style="width:240px;height:auto;display:block;margin:0 auto 28px;" />
      </div>

      <div style="padding:0 40px 36px;">
        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 12px;">
          ${tr("Hello", "Bonjour")} ${order.first_name || ""},
        </p>

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 12px;">
          ${tr(
            "Thank you for choosing Bento Cake Studio.",
            "Merci d’avoir choisi Bento Cake Studio pour votre commande."
          )}
        </p>

        <div style="border-left:3px solid #78020C;background:#F5EDCC;padding:14px 18px;margin:0 0 20px;">
          <p style="color:#351E13;font-size:14px;line-height:1.7;margin:0;">
            ${workshopOnly
              ? tr(
                  `We regret to inform you that your workshop booking cannot be confirmed.`,
                  `Nous sommes au regret de vous informer que votre réservation de workshop ne peut pas être confirmée.`
                )
              : mixed
                ? tr(
                    `We regret to inform you that the cake part of your order <strong>${orderNumber}</strong> cannot be confirmed. Your workshop booking is not affected.`,
                    `Nous sommes au regret de vous informer que la partie gâteau de votre commande <strong>n° ${orderNumber}</strong> ne peut pas être confirmée. Votre réservation d'atelier n'est pas concernée.`
                  )
                : tr(
                    `We regret to inform you that your order <strong>${orderNumber}</strong>, scheduled for <strong>${formatDateCH(order.pickup_delivery_date)}</strong>, cannot be fulfilled.`,
                    `Nous sommes au regret de vous informer que votre commande <strong>n° ${orderNumber}</strong>, prévue le <strong>${formatDateCH(order.pickup_delivery_date)}</strong>, ne pourra pas être réalisée.`
                  )}
          </p>
        </div>

        ${(!workshopOnly && !mixed) ? `<p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 16px;">
          ${tr(
            "To ensure the quality of each of our creations, we limit the number of orders we take each day, and we have reached our maximum capacity for this date.",
            "Afin de garantir la qualité de chacune de nos créations, nous limitons le nombre de commandes que nous réalisons chaque jour, et notre capacité maximale pour cette date a été atteinte."
          )}
        </p>` : ""}

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 24px;">
          ${refundText}
        </p>

        <p style="color:#78020C;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;margin:0 0 8px;">
          ${tr("Order details", "Détails de la commande")}
        </p>
        <table style="border-collapse:collapse;width:100%;border:1px solid #D4C89A;margin:0 0 24px;">
          <tr style="border-bottom:1px solid #D4C89A;">
            <td style="padding:10px 14px;color:#7A6540;font-size:13px;width:48%;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${tr("Order", "Commande")}</td>
            <td style="padding:10px 14px;color:#351E13;font-size:13px;font-weight:700;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${orderNumber}</td>
          </tr>
          <tr style="border-bottom:1px solid #D4C89A;background:#FDF3D0;">
            <td style="padding:10px 14px;color:#7A6540;font-size:13px;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${tr("Amount", "Montant")}</td>
            <td style="padding:10px 14px;color:#351E13;font-size:13px;font-weight:700;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">CHF ${amountCHF}</td>
          </tr>
          <tr style="background:#78020C;">
            <td style="padding:10px 14px;color:#FDF8E1;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${tr("Status", "Statut")}</td>
            <td style="padding:10px 14px;color:#FDF8E1;font-size:13px;font-weight:700;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${rewardOnly
              ? tr("Reward balance credited", "Cagnotte recréditée")
              : tr("Refund in progress", "Remboursement en cours")}</td>
          </tr>
        </table>

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 24px;">
          ${(workshopOnly || mixed)
            ? tr(
                "We are sorry for the inconvenience and thank you for your understanding.",
                "Nous sommes désolées pour ce contretemps et vous remercions pour votre compréhension."
              )
            : tr(
                "We are sorry for the inconvenience and thank you for your understanding. We would be happy to create your cake for another available date.",
                "Nous sommes désolées pour ce contretemps et vous remercions pour votre compréhension. Nous serions ravies de réaliser votre gâteau pour une autre date disponible."
              )}
        </p>

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0;border-top:1px solid #D4C89A;padding-top:20px;">
          ${tr("See you soon", "À bientôt")},<br>
          <strong>Bento Cake Studio</strong>
        </p>
      </div>
    </div>

    <div style="height:24px;background:#78020C;"></div>
  </div>
</body>
</html>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "contact@bentocakestudio.ch",
      to: [order.email],
      subject: tr(
        `Update Regarding Your Order #${orderNumber}`,
        `Mise à jour concernant votre commande n° ${orderNumber}`
      ),
      html,
    }),
  });

  const data = await resp.json();

  if (!resp.ok) {
    console.error("Decline email send failed:", data);
    throw new Error(`Resend error: ${JSON.stringify(data)}`);
  }

  console.log("Decline email sent to customer:", data.id);
  return data;
}

// ── Invoice PDF generation ──────────────────────────────────────────
// Redrawn to match the "modele facture.pdf" reference template: cream
// background, maroon table header, FACTURE AQUITÉE title, and a table that
// grows to however many rows the real order needs (one row per order_item,
// plus a "Livraison" row when delivery_fee > 0, plus a bold TOTAL row) —
// paginating onto additional A4 pages, with the table header repeated, if
// the rows don't fit on one page. No VAT line: Bento Cake Studio is not
// VAT-registered, so order.total_amount is used as-is everywhere.

function formatInvoicePrice(amount: number | string): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return Number.isInteger(n) ? `${n}.-` : n.toFixed(2);
}

function formatInvoiceDate(dateInput: string): string {
  const d = new Date(dateInput);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

async function generateInvoicePdf(
  order: any,
  items: any[],
  opts?: { mode?: "full" | "workshop_only_kept"; refundedAmount?: number; fulfillments?: any[] },
): Promise<string> {
  const lang = getCustomerLang(order);
  const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);

  // "workshop_only_kept": a mixed order whose cake part was refused. `items` is
  // the workshop lines only, and the invoice total is their sum — NOT
  // order.total_amount, part of which is being refunded by hand.
  const keptMode = opts?.mode === "workshop_only_kept";
  const invoiceTotalNum = keptMode
    ? items.reduce((s: number, it: any) => s + (Number(it.total) || 0), 0)
    : Number(order.total_amount ?? 0);

  // Multi-date fulfillment (Sept 2026): while MULTI_DATE_FULFILLMENT_ENABLED
  // is false on the frontend, every physical order has exactly ONE
  // order_fulfillments row, so this never changes today's invoice at all —
  // grouping only activates once a real order genuinely spans 2+ distinct
  // physical pickup/delivery dates. One order is still exactly one
  // transaction and one invoice either way; this only adds a date/mode
  // section header above each group's lines. Kept in sync with the
  // identical copy in _shared/invoice-pdf.ts — update BOTH.
  const fulfillments: any[] = opts?.fulfillments ?? [];
  const fulfillmentById = new Map<string, any>(fulfillments.map((f: any) => [f.id, f]));
  const physicalFulfillmentIds = new Set(
    items
      .filter((it: any) => it.product !== "workshop" && it.fulfillment_id)
      .map((it: any) => it.fulfillment_id),
  );
  const groupByFulfillment = physicalFulfillmentIds.size > 1;
  const fulfillmentSectionLabel = (f: any): string => {
    const method = f.delivery_method === "delivery" ? tr("Delivery", "Livraison") : tr("Pickup", "Retrait");
    const parts = [formatDateCH(f.pickup_delivery_date), method];
    if (f.pickup_delivery_slot) parts.push(f.pickup_delivery_slot);
    return parts.join(" — ");
  };

  const PAGE_W = 595.28;
  const PAGE_H = 841.89; // A4
  const margin = 50;

  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // Palette matched to the supplied "modele facture.pdf" reference.
  const cream = rgb(0.976, 0.953, 0.902);
  const maroon = rgb(0.42, 0.11, 0.11);
  const textDark = rgb(0.15, 0.1, 0.08);
  const gray = rgb(0.4, 0.4, 0.4);
  const white = rgb(1, 1, 1);
  const borderColor = rgb(0.6, 0.5, 0.42);
  const totalRowFill = rgb(0.93, 0.88, 0.78);

  let page: any;
  let y = 0;

  const startPage = () => {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: cream });
    y = PAGE_H - margin;
  };

  const drawLabelValue = (label: string, value: string, x: number, yPos: number, size = 10) => {
    page.drawText(label, { x, y: yPos, size, font: fontBold, color: textDark });
    const labelW = fontBold.widthOfTextAtSize(label, size);
    if (value) page.drawText(value, { x: x + labelW + 2, y: yPos, size, font: fontRegular, color: textDark });
  };

  startPage();

  // ── Logo (top-right) ────────────────────────────────────────────
  // Real Bento Cake Studio wordmark, fetched and embedded. Failure here
  // (network / decode) is non-fatal: the invoice is still generated, just
  // without the logo.
  try {
    const logoRes = await fetch("https://dimsoon58.github.io/mini-cake-corner/logo-red-email.png");
    if (!logoRes.ok) throw new Error(`logo fetch failed: ${logoRes.status}`);
    const logoImg = await pdfDoc.embedPng(new Uint8Array(await logoRes.arrayBuffer()));
    const logoDrawW = 150;
    const logoDrawH = (logoImg.height / logoImg.width) * logoDrawW;
    page.drawImage(logoImg, {
      x: PAGE_W - margin - logoDrawW,
      y: PAGE_H - margin - logoDrawH,
      width: logoDrawW,
      height: logoDrawH,
    });
  } catch (logoErr) {
    console.error("Invoice logo could not be embedded:", logoErr);
  }

  // ── Title ────────────────────────────────────────────────────────
  page.drawText(tr("PAID INVOICE", "FACTURE AQUITÉE"), { x: margin, y, size: 15, font: fontBold, color: textDark });
  y -= 34;

  // ── Company block (left) + facture info block (right) ─────────────
  const leftStartY = y;
  drawLabelValue("BENTO CAKE STUDIO SNC", "", margin, y, 11);
  y -= 18;
  drawLabelValue(tr("ADDRESS: ", "ADRESSE : "), tr("58 Chemin de la Gradelle, 1224 Geneva", "58 Chemin de la Gradelle, 1224 Genève"), margin, y);
  y -= 15;
  drawLabelValue(tr("PHONE: ", "TÉLÉPHONE : "), "+41 78 337 95 00", margin, y);
  y -= 15;
  drawLabelValue(tr("EMAIL: ", "EMAIL : "), "Contact@bentocakestudio.ch", margin, y);
  y -= 15;
  drawLabelValue(tr("IDE : ", "IDE : "), "CHE-425.048.539", margin, y);
  y -= 15;
  drawLabelValue(tr("VAT: ", "TVA : "), tr("Not subject to VAT", "Non assujetti TVA"), margin, y);
  const leftEndY = y;

  const invoiceNumber = order.invoice_number || "—";
  const invoiceDate = formatInvoiceDate(new Date().toISOString());
  const orderDate = order.created_at ? formatInvoiceDate(order.created_at) : "—";

  let ry = leftStartY - 54; // roughly aligned with the EMAIL line of the left block, as in the reference
  const rightBlockX = PAGE_W - margin - 220;
  drawLabelValue(tr("INVOICE NO.: ", "FACTURE N° : "), invoiceNumber, rightBlockX, ry);
  ry -= 15;
  drawLabelValue(tr("INVOICE DATE: ", "DATE DE FACTURE : "), invoiceDate, rightBlockX, ry);
  ry -= 15;
  drawLabelValue(tr("ORDER DATE: ", "DATE COMMANDE : "), orderDate, rightBlockX, ry);

  y = Math.min(leftEndY, ry) - 26;

  // ── Client block ─────────────────────────────────────────────────
  page.drawText(tr("CUSTOMER", "CLIENT"), { x: margin, y, size: 11, font: fontBold, color: textDark });
  y -= 17;
  drawLabelValue(tr("NAME: ", "NOM : "), customerName(order), margin, y);
  y -= 15;
  if (order.delivery_address) {
    drawLabelValue(tr("ADDRESS: ", "ADRESSE : "), order.delivery_address, margin, y);
    y -= 15;
  }
  drawLabelValue(tr("EMAIL: ", "EMAIL : "), order.email, margin, y);
  y -= 30;

  // ── Items table ──────────────────────────────────────────────────
  const tableLeft = margin;
  const tableRight = PAGE_W - margin;
  const tableWidth = tableRight - tableLeft;
  const col1 = tableLeft;
  const col2 = tableLeft + tableWidth * 0.46;
  const col3 = tableLeft + tableWidth * 0.60;
  const col4 = tableLeft + tableWidth * 0.82;
  const headerRowH = 30;
  const dataRowH = 32;

  const drawTableHeader = () => {
    const headerBot = y - headerRowH;
    page.drawRectangle({ x: tableLeft, y: headerBot, width: tableWidth, height: headerRowH, color: maroon });
    const labelY = headerBot + headerRowH / 2 - 4;
    page.drawText(tr("DESCRIPTION", "DESCRIPTION"), { x: col1 + 8, y: labelY, size: 10, font: fontBold, color: white });
    page.drawText(tr("QTY", "QUANTITÉ"), { x: col2 + 8, y: labelY, size: 10, font: fontBold, color: white });
    page.drawText(tr("UNIT PRICE CHF", "PRIX UNITAIRE CHF"), { x: col3 + 8, y: labelY, size: 10, font: fontBold, color: white });
    page.drawText(tr("TOTAL", "TOTAL"), { x: col4 + 8, y: labelY, size: 10, font: fontBold, color: white });
    y = headerBot;
  };

  drawTableHeader();

  type InvoiceRow = { description: string; quantity: string; unitPrice: string; total: string; bold?: boolean; section?: boolean };

  // Workshop line: description is the WORKSHOP NAME ONLY (date / time /
  // booking reference are deliberately left off — they made the line too
  // long and broke the invoice layout; they still live on the reservation /
  // in the database and in the confirmation e-mail, untouched).
  // QTY = participants, UNIT PRICE = workshop_unit_price, TOTAL = item.total.
  // Never labelled as a cake. order.total_amount is not recomputed from here.
  const rowForItem = (item: any): InvoiceRow => {
    if (item.product === "workshop") {
      const wsName = item.workshop_type === "paint" ? tr("Paint Workshop", "Atelier Peinture") : tr("Signature Workshop", "Atelier Signature");
      const participants = item.workshop_participants != null ? Number(item.workshop_participants) : 1;
      return {
        description: wsName,
        quantity: String(participants),
        unitPrice: formatInvoicePrice(item.workshop_unit_price ?? 0),
        total: formatInvoicePrice(item.total ?? 0),
      };
    }

    const desc = item.size
      ? `${item.size}${item.flavors?.length ? " — " + item.flavors.join(", ") : ""}`
      : (item.design || tr("Custom cake", "Gâteau personnalisé"));
    const total = item.total ?? 0;
    return {
      description: desc,
      quantity: "1",
      unitPrice: formatInvoicePrice(total),
      total: formatInvoicePrice(total),
    };
  };

  // Count of real ordered products/workshops only — computed from `items`
  // directly, never from itemRows.length below, since grouping inserts extra
  // section-header rows that must never be counted as billable lines in the
  // TOTAL row's QTY.
  const productLineCount = items.length;

  let itemRows: InvoiceRow[];
  if (groupByFulfillment) {
    // Workshop lines first, exactly as before (never grouped by date — they
    // keep their own session date shown separately, not on the invoice).
    const workshopRows = items.filter((it: any) => it.product === "workshop").map(rowForItem);
    const sortedFulfillmentIds = Array.from(physicalFulfillmentIds).sort((a, b) => {
      const da = fulfillmentById.get(a)?.pickup_delivery_date ?? "";
      const db = fulfillmentById.get(b)?.pickup_delivery_date ?? "";
      return String(da).localeCompare(String(db));
    });
    const groupedRows: InvoiceRow[] = [];
    for (const fid of sortedFulfillmentIds) {
      const f = fulfillmentById.get(fid);
      groupedRows.push({
        description: f ? fulfillmentSectionLabel(f) : tr("Pickup / delivery", "Retrait / livraison"),
        quantity: "", unitPrice: "", total: "", section: true,
      });
      groupedRows.push(
        ...items
          .filter((it: any) => it.product !== "workshop" && it.fulfillment_id === fid)
          .map(rowForItem),
      );
    }
    // Defensive only: a physical item with no fulfillment_id at all (should
    // never happen once every physical order goes through fulfillment
    // creation) — never silently dropped, just appended ungrouped.
    const ungroupedRows = items
      .filter((it: any) => it.product !== "workshop" && !it.fulfillment_id)
      .map(rowForItem);
    itemRows = [...workshopRows, ...groupedRows, ...ungroupedRows];
  } else {
    // Exactly today's behaviour — one order always has one fulfillment while
    // MULTI_DATE_FULFILLMENT_ENABLED is false, so this is the only branch
    // that ever runs in production right now. Zero visual change.
    itemRows = items.map(rowForItem);
  }

  // The itemised detail must reconcile exactly with the TOTAL. Order of the
  // lines: products / workshops -> express surcharge -> welcome discount (-) ->
  // reward used (-) -> delivery -> TOTAL. Every amount below is read straight
  // off the committed order (welcome_discount_amount / reward_amount_used /
  // express_surcharge_amount / delivery_fee) — nothing is recomputed.
  // "workshop_only_kept" (mixed order, cake part refused): the invoice must
  // contain ONLY the workshop lines — express surcharge, delivery, welcome
  // discount and reward all belong to the physical part and are included in the
  // amount being refunded, so they are NOT shown here. Σ(rows) === invoiceTotal.
  if (!keptMode) {
    const expressSurchargeInvoice = Number(order.express_surcharge_amount) || 0;
    if (expressSurchargeInvoice > 0) {
      itemRows.push({
        description: tr("Near-date surcharge", "Supplément date rapprochée"),
        quantity: "1",
        unitPrice: formatInvoicePrice(expressSurchargeInvoice),
        total: formatInvoicePrice(expressSurchargeInvoice),
      });
    }

    const welcomeDiscountInvoice = Number(order.welcome_discount_amount) || 0;
    if (welcomeDiscountInvoice > 0) {
      itemRows.push({
        description: tr("Welcome discount", "Réduction de bienvenue"),
        quantity: "",
        unitPrice: "",
        total: `- ${formatInvoicePrice(welcomeDiscountInvoice)}`,
      });
    }

    const rewardUsedInvoice = Number(order.reward_amount_used) || 0;
    if (rewardUsedInvoice > 0) {
      itemRows.push({
        description: tr("Reward used", "Cagnotte utilisée"),
        quantity: "",
        unitPrice: "",
        total: `- ${formatInvoicePrice(rewardUsedInvoice)}`,
      });
    }

    const deliveryFee = Number(order.delivery_fee) || 0;
    if (deliveryFee > 0) {
      itemRows.push({
        description: tr("Delivery", "Livraison"),
        quantity: "1",
        unitPrice: formatInvoicePrice(deliveryFee),
        total: formatInvoicePrice(deliveryFee),
      });
    }
  }

  const billableRows = itemRows.length > 0 ? itemRows : [{
    description: tr("Custom cake", "Gâteau personnalisé"),
    quantity: "1",
    unitPrice: formatInvoicePrice(invoiceTotalNum),
    total: formatInvoicePrice(invoiceTotalNum),
  }];

  const rows: InvoiceRow[] = [
    ...billableRows,
    {
      description: tr("TOTAL", "TOTAL"),
      quantity: String(productLineCount || 1),
      unitPrice: "",
      total: formatInvoicePrice(invoiceTotalNum),
      bold: true,
    },
  ];

  const sectionRowH = 24;
  for (const invoiceRow of rows) {
    const rowH = invoiceRow.section ? sectionRowH : dataRowH;
    if (y - rowH < margin) {
      // Row doesn't fit — start a new page and repeat the table header, so
      // a table row is never split across two pages.
      startPage();
      drawTableHeader();
    }

    const rowTop = y;
    const rowBot = y - rowH;
    const textY = rowBot + rowH / 2 - 4;
    const font = invoiceRow.bold ? fontBold : fontRegular;

    if (invoiceRow.section) {
      // Full-width date/mode header ("07.10.2026 — Retrait") above the group
      // of physical items for that fulfillment — no columns, no price, just
      // the label. Only ever drawn when items genuinely span 2+ distinct
      // pickup/delivery dates (see groupByFulfillment above); a normal
      // single-date order never reaches this branch.
      page.drawRectangle({
        x: tableLeft, y: rowBot, width: tableWidth, height: rowH,
        color: totalRowFill, borderColor, borderWidth: 0.75,
      });
      page.drawText(invoiceRow.description, { x: col1 + 8, y: textY, size: 9, font: fontBold, color: textDark });
      y = rowBot;
      continue;
    }

    page.drawRectangle({
      x: tableLeft, y: rowBot, width: tableWidth, height: rowH,
      color: invoiceRow.bold ? totalRowFill : cream,
      borderColor, borderWidth: 0.75,
    });
    for (const cx of [col2, col3, col4]) {
      page.drawLine({ start: { x: cx, y: rowTop }, end: { x: cx, y: rowBot }, thickness: 0.5, color: borderColor });
    }

    page.drawText(invoiceRow.description, { x: col1 + 8, y: textY, size: 10, font, color: textDark });
    page.drawText(invoiceRow.quantity, { x: col2 + 8, y: textY, size: 10, font, color: textDark });
    if (invoiceRow.unitPrice) {
      page.drawText(invoiceRow.unitPrice, { x: col3 + 8, y: textY, size: 10, font, color: textDark });
    }
    page.drawText(invoiceRow.total, { x: col4 + 8, y: textY, size: 10, font, color: textDark });

    y = rowBot;
  }

  // ── Footer: TOTAL PAYÉ + legal mention + thank-you ─────────────────
  // Kept immediately after the last table row — pushed to a fresh page
  // together (never split) if there isn't enough room left.
  const FOOTER_RESERVED_HEIGHT = 120;
  if (y - FOOTER_RESERVED_HEIGHT < margin) {
    startPage();
  } else {
    y -= 26;
  }

  page.drawText(
    keptMode
      ? tr(`WORKSHOP TOTAL: CHF ${formatInvoicePrice(invoiceTotalNum)}`, `TOTAL ATELIER : CHF ${formatInvoicePrice(invoiceTotalNum)}`)
      : tr(`TOTAL PAID: CHF ${formatInvoicePrice(invoiceTotalNum)}`, `TOTAL PAYÉ : CHF ${formatInvoicePrice(invoiceTotalNum)}`),
    { x: margin, y, size: 12, font: fontBold, color: textDark },
  );
  y -= 20;
  // Legal mention — conditional on what the order actually contains.
  const invoiceWorkshopItems = items.filter((it: any) => it.product === "workshop");
  const invoicePhysicalItems = items.filter((it: any) => it.product !== "workshop");
  const refundNote = keptMode && opts?.refundedAmount
    ? tr(
        ` The cake part of this order was cancelled; a refund of CHF ${Number(opts.refundedAmount).toFixed(2)} is being processed.`,
        ` La partie gâteau de cette commande a été annulée ; un remboursement de CHF ${Number(opts.refundedAmount).toFixed(2)} est en cours.`,
      )
    : "";
  const legalMention = (invoiceWorkshopItems.length > 0 && invoicePhysicalItems.length === 0
    ? tr(
        "Workshop booking paid and confirmed. Cancellation conditions apply in accordance with the Terms & Conditions.",
        "Réservation de workshop payée et confirmée. Conditions d'annulation applicables conformément aux Conditions Générales de Vente.",
      )
    : invoiceWorkshopItems.length > 0 && invoicePhysicalItems.length > 0
      ? tr(
          "Order paid and confirmed. The applicable conditions for products and workshops are those set out in the Terms & Conditions.",
          "Commande payée et confirmée. Les conditions applicables aux produits et workshops sont celles prévues dans les Conditions Générales de Vente.",
        )
      : tr(
          "Order paid before production. Custom cakes cannot be returned or exchanged.",
          "Commande payée avant réalisation. Gâteau personnalisé non repris, non échangé.",
        )) + refundNote;
  // pdf-lib does not wrap — split the mention onto as many lines as the
  // usable width needs (the workshop / mixed wordings are longer than the
  // original cake-only one).
  const mentionMaxW = PAGE_W - margin * 2;
  const mentionWords = legalMention.split(" ");
  const mentionLines: string[] = [];
  let mentionLine = "";
  for (const word of mentionWords) {
    const candidate = mentionLine ? `${mentionLine} ${word}` : word;
    if (fontItalic.widthOfTextAtSize(candidate, 9) > mentionMaxW && mentionLine) {
      mentionLines.push(mentionLine);
      mentionLine = word;
    } else {
      mentionLine = candidate;
    }
  }
  if (mentionLine) mentionLines.push(mentionLine);

  for (const line of mentionLines) {
    page.drawText(line, { x: margin, y, size: 9, font: fontItalic, color: gray });
    y -= 12;
  }
  y -= 12;
  page.drawText(tr("Thank you for your trust", "Merci pour votre confiance"), { x: margin, y, size: 11, font: fontRegular, color: textDark });

  // Save and convert to base64
  const pdfBytes = await pdfDoc.save();
  let binary = "";
  for (let i = 0; i < pdfBytes.length; i++) {
    binary += String.fromCharCode(pdfBytes[i]);
  }
  return btoa(binary);
}

// Token validation + single-use consumption now happen ATOMICALLY inside the
// decide_order_physical RPC (under a row lock, in the decision transaction).
// The old validateToken() / consumeToken() JS helpers were removed — a
// two-step check-then-consume in JS could race two concurrent Accept/Reject.

// ── Main handler ─────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { orderId, action: rawAction, pin, token, refundReference } = await req.json();

    if (!orderId || !rawAction) {
      throw new Error("Missing required fields: orderId, action");
    }

    // Normalize: accept both "decline" and "reject"
    const action = rawAction === "decline" ? "reject" : rawAction;

    if (action !== "approve" && action !== "reject" && action !== "mark_refunded") {
      throw new Error("Action must be 'approve', 'reject', 'decline', or 'mark_refunded'");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // ── mark_refunded: the admin has done the manual PostFinance refund and
    //    is recording it. PIN-only (admin page), no token, no e-mail.
    //    cake_only : the WHOLE order was refunded → payment_status = 'refunded'
    //                too (fires the reward trigger's refund branch).
    //    mixed     : only the CAKE part was refunded — the workshop is still
    //                paid & confirmed → payment_status STAYS 'paid', only
    //                refund_status flips.
    if (action === "mark_refunded") {
      const adminPin = Deno.env.get("ADMIN_ORDER_PIN");
      if (!adminPin || pin !== adminPin) {
        return new Response(JSON.stringify({ error: "Invalid PIN" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403,
        });
      }
      const { data: mo } = await supabase
        .from("orders")
        .select("fulfillment_type, order_number, total_amount, refund_due_amount")
        .eq("id", orderId).single();
      const isMixedRefund = (mo?.fulfillment_type) === "mixed";
      const refundUpd: Record<string, unknown> = {
        refund_status: "refunded",
        refund_marked_at: new Date().toISOString(),
        refund_reference: (typeof refundReference === "string" && refundReference.trim())
          ? refundReference.trim() : null,
      };
      if (!isMixedRefund) refundUpd.payment_status = "refunded";
      const { data: rows, error: mErr } = await supabase
        .from("orders")
        .update(refundUpd)
        .eq("id", orderId)
        .eq("refund_status", "to_refund")
        .select("id");
      if (mErr) throw new Error(`Failed to mark refund done: ${mErr.message}`);

      // Best-effort Make status webhook (scenario may be inactive — never fails
      // the request). Lets the Notion row show the refund is settled.
      if ((Array.isArray(rows) ? rows.length : 0) > 0) {
        try {
          await fetch("https://hook.eu1.make.com/dmmtxutu1pwcu3w3al8c25gifbspag7r", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              order_id: mo?.order_number || orderId,
              supabase_id: orderId,
              status: "refund_completed",
              refunded_amount: Number(mo?.refund_due_amount) || 0,
              refund_reference: refundUpd.refund_reference ?? null,
            }),
          });
        } catch (e) {
          console.error("Make refund_completed webhook error:", e);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        status: "refund_marked",
        fulfillmentType: mo?.fulfillment_type ?? null,
        paymentStatus: isMixedRefund ? "paid" : "refunded",
        matched: Array.isArray(rows) ? rows.length : 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
    }

    if (!token) {
      throw new Error("Missing required field: token");
    }

    // If PIN is provided, verify it (admin page flow).
    // If no PIN, token-only auth is sufficient (email link flow).
    if (pin) {
      const adminPin = Deno.env.get("ADMIN_ORDER_PIN");
      if (!adminPin || pin !== adminPin) {
        return new Response(JSON.stringify({ error: "Invalid PIN" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 403,
        });
      }
    }

    // Token validation + single-use consumption is done ATOMICALLY inside the
    // decide_order_physical RPC below (under a row lock, in the same
    // transaction as the decision) — a lightweight pre-check here would only
    // race. A quick read for a friendly early error:
    {
      const { data: tk } = await supabase
        .from("order_action_tokens").select("used").eq("order_id", orderId).eq("token", token).maybeSingle();
      if (!tk) throw new Error("Invalid or unknown action token");
      // A used token is NOT rejected here — it may be an idempotent retry of the
      // winning request; the RPC returns { already_decided } for that case.
    }

    const { data: order, error: orderError } = await supabase
      .from("orders").select("*").eq("id", orderId).single();

    if (orderError || !order) throw new Error("Order not found");

    // Every article of this order lives in its own order_items row.
    const { data: items, error: itemsFetchError } = await supabase
      .from("order_items").select("*").eq("order_id", orderId).order("created_at", { ascending: true });

    if (itemsFetchError) throw new Error(`Failed to load order_items: ${itemsFetchError.message}`);
    const orderItems = items || [];

    // Multi-date fulfillment (Sept 2026): needed only so the invoice PDF can
    // group physical items by pickup/delivery date when an order genuinely
    // spans more than one (generateInvoicePdf itself no-ops this into
    // today's exact single-block layout whenever there's only one — see that
    // function). Cheap, tiny row count; always fetched rather than gated on
    // fulfillment_type, so a future mixed/cake_only multi-date order never
    // has to remember to opt in.
    const { data: orderFulfillmentsData, error: fulfillmentsFetchError } = await supabase
      .from("order_fulfillments").select("*").eq("order_id", orderId);
    if (fulfillmentsFetchError) {
      console.error(`Failed to load order_fulfillments for ${orderId} (non-fatal, invoice falls back to ungrouped):`, fulfillmentsFetchError);
    }
    const orderFulfillments = orderFulfillmentsData || [];

    // ── Fulfilment shape ────────────────────────────────────────────────
    // NEW MODEL: the payment is ALREADY captured at checkout. manage-order
    // NEVER moves money — no capture, no void, no automatic refund. It only
    // records the admin's decision on the PHYSICAL part. A physical refusal is
    // flagged refund_status = 'to_refund' and refunded by hand in PostFinance.
    const workshopItems = orderItems.filter((it: any) => it.product === "workshop");
    const physicalItems = orderItems.filter((it: any) => it.product !== "workshop");
    const hasWorkshopItem = workshopItems.length > 0;
    const hasPhysicalItem = physicalItems.length > 0;
    const fulfillmentType: "cake_only" | "workshop_only" | "mixed" =
      (order.fulfillment_type as any) ||
      (hasWorkshopItem ? (hasPhysicalItem ? "mixed" : "workshop_only") : "cake_only");

    if (fulfillmentType === "workshop_only") {
      return new Response(JSON.stringify({
        error: "Workshop-only orders are auto-confirmed — there is no admin decision to make.",
        status: order.order_validation,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 });
    }

    // The physical part is the only thing decided here. Any order with a
    // physical part carries physical_validation ('pending' | 'approved' |
    // 'rejected'), set at INSERT by confirm-postfinance-payment. For a
    // cake-only order it mirrors order_validation; for a mixed order
    // order_validation follows the workshop instead.
    const physicalState: string = order.physical_validation ?? "pending";
    if (physicalState !== "pending") {
      return new Response(JSON.stringify({
        error: `The physical part of this order has already been ${physicalState}`,
        status: physicalState,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 });
    }
    // A mixed order whose workshop part has not confirmed yet cannot be decided.
    if (fulfillmentType === "mixed" && !order.workshop_confirmed_at) {
      return new Response(JSON.stringify({
        error: "The workshop part is still confirming — please try again in a moment.",
        status: "workshop_confirming",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
    }

    // ── Atomic decision (RPC) ─────────────────────────────────────────
    // decide_order_physical locks the order + the action token, verifies
    // physical_validation='pending' (+ workshop_confirmed_at for mixed), runs
    // the refund invariants, writes ONE decision (firing the reward trigger in
    // the same transaction), finalises/releases the welcome discount and
    // consumes the token — all atomically. Two simultaneous Accept/Reject can
    // never both land. A retry of the winning request returns
    // { already_decided: true } so the side-effects below can still run.
    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const isRewardOnly = order.postfinance_transaction_id === "REWARD_ONLY";
    const paymentMethodLabel = isRewardOnly ? "Reward balance" : (order.payment_method || "PostFinance");

    let decision: any;
    {
      const { data, error } = await supabase.rpc("decide_order_physical", {
        p_order_id: orderId,
        p_token: token,
        p_action: action,
      });
      if (error) {
        const msg = error.message || String(error);
        // Expected "the decision cannot be made right now" cases -> 409 (the
        // admin can react: reload, retry). Genuine inconsistencies (refund
        // invariant, welcome-discount mismatch) -> 500 (technical error).
        const isClientErr = /unknown action token|token already used|no admin decision|already (approved|rejected)|not confirmed yet|physical part already/i.test(msg);
        return new Response(JSON.stringify({ error: msg }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: isClientErr ? 409 : 500,
        });
      }
      decision = data ?? {};
    }

    const alreadyDecided = decision.already_decided === true;
    const decidedOV: string = decision.order_validation ?? "pending";
    const decidedPV: string = decision.physical_validation ?? "pending";
    const decidedRefundStatus: string = decision.refund_status ?? "none";
    const physicalRefundDue: number = round2(Number(decision.refund_due_amount) || 0);

    // The RECORDED DB decision is the authority — derive the effective action
    // from it, never from the initial HTTP `action`. If a concurrent request
    // lost the race (already_decided) and asked for the OPPOSITE decision, it
    // must send NO side-effect (no decline e-mail, no refuse invoice, no
    // "refused_physical" to Make).
    const effectiveAction: "approve" | "reject" | null =
      decidedPV === "approved" ? "approve" : decidedPV === "rejected" ? "reject" : null;

    if (alreadyDecided && effectiveAction !== action) {
      return new Response(JSON.stringify({
        error: `This order's physical part was already ${decidedPV} — your "${action}" request was not applied.`,
        status: decidedPV,
        orderValidation: decidedOV,
        physicalValidation: decidedPV,
        refundStatus: decidedRefundStatus,
        refundDueAmount: decidedRefundStatus === "to_refund" ? physicalRefundDue : 0,
        alreadyDecided: true,
        appliedAction: effectiveAction,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
    }
    if (!effectiveAction) {
      // physical_validation is neither approved nor rejected — should be
      // impossible after a successful decide_order_physical. Defensive 409.
      return new Response(JSON.stringify({
        error: `Unexpected decision state (physical_validation=${decidedPV})`,
        status: decidedPV,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
    }

    console.log(`Order ${orderId} (${fulfillmentType}) physical part ${decidedPV}` +
      (alreadyDecided ? " (idempotent retry of the winning request)" : "") +
      (decidedRefundStatus === "to_refund" ? ` — CHF ${physicalRefundDue.toFixed(2)} to refund by hand` : ""));

    let invoiceNumberForWebhook: string | null = null;
    let invoiceUrlForWebhook: string | null = null;
    let approvalEmailResult: any = null;
    let declineEmailResult: any = null;

    // ── Side-effects (invoice PDF, e-mails) — non-transactional, idempotent.
    if (effectiveAction === "approve") {
      // ONE invoice: the full order (workshop + cake for a mixed order).
      let invoicePdfBase64: string | null = null;
      try { invoicePdfBase64 = await generateInvoicePdf(order, orderItems, { fulfillments: orderFulfillments }); }
      catch (e) { console.error("Invoice PDF generation error:", e); }

      const resendKeyApprove = Deno.env.get("RESEND_API_KEY");
      if (resendKeyApprove) {
        try { approvalEmailResult = await sendApprovalEmail(resendKeyApprove, order, orderItems, paymentMethodLabel, invoicePdfBase64); }
        catch (e) { console.error("Approval email error:", e); }
      }

      if (invoicePdfBase64) {
        try {
          const invoiceNum = order.invoice_number || order.order_number || "invoice";
          const pdfBytes = Uint8Array.from(atob(invoicePdfBase64), (c) => c.charCodeAt(0));
          const storagePath = `${invoiceNum}.pdf`;
          const { error: upErr } = await supabase.storage.from("invoice")
            .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });
          if (upErr) { console.error("Invoice storage upload error:", upErr); }
          else {
            await supabase.from("orders").update({ invoice_path: storagePath }).eq("id", orderId);
            invoiceNumberForWebhook = invoiceNum;
            const { data: signed } = await supabase.storage.from("invoice")
              .createSignedUrl(storagePath, 60 * 60 * 24 * 365 * 10);
            invoiceUrlForWebhook = signed?.signedUrl ?? null;
          }
        } catch (e) { console.error("Invoice storage upload error:", e); }
      }
    } else {
      // Refused. Invoice ONLY for a mixed order = the WORKSHOP part that was
      // kept (mode 'workshop_only_kept' -> workshop lines only, no express /
      // delivery / discount / reward; label "TOTAL ATELIER").
      if (fulfillmentType === "mixed") {
        try {
          const invoicePdfBase64 = await generateInvoicePdf(order, workshopItems, {
            mode: "workshop_only_kept",
            refundedAmount: physicalRefundDue,
          });
          const invoiceNum = order.invoice_number || order.order_number || "invoice";
          const pdfBytes = Uint8Array.from(atob(invoicePdfBase64), (c) => c.charCodeAt(0));
          const storagePath = `${invoiceNum}.pdf`;
          const { error: upErr } = await supabase.storage.from("invoice")
            .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });
          if (upErr) { console.error("Mixed-refuse invoice upload error:", upErr); }
          else {
            await supabase.from("orders").update({ invoice_path: storagePath }).eq("id", orderId).is("invoice_path", null);
            invoiceNumberForWebhook = invoiceNum;
            const { data: signed } = await supabase.storage.from("invoice")
              .createSignedUrl(storagePath, 60 * 60 * 24 * 365 * 10);
            invoiceUrlForWebhook = signed?.signedUrl ?? null;
          }
        } catch (e) { console.error("Mixed-refuse invoice generation error:", e); }
      }

      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey) {
        try {
          declineEmailResult = await sendDeclineEmail(resendKey, order, orderItems, {
            fulfillmentType,
            refundDue: physicalRefundDue,
          });
        } catch (e) { console.error("Decline email error:", e); }
      }
    }

    const paymentAction = effectiveAction === "approve"
      ? "Physical part accepted — payment already captured at checkout"
      : (fulfillmentType === "mixed"
          ? `Cake part refused — CHF ${physicalRefundDue.toFixed(2)} to refund by hand; workshop stays confirmed`
          : `Order refused — CHF ${physicalRefundDue.toFixed(2)} to refund by hand`);

    // Notify Make.com webhook of status change — updates the EXISTING Notion
    // row (matched via supabase_id). Skipped for workshop-only orders (never
    // sent to the production webhook, no Notion row). Mixed orders notify:
    //   accept          -> "accepted"
    //   refuse (mixed)  -> "refused_physical" (the workshop stays confirmed)
    //   refuse (cake)   -> "refused"
    if (hasPhysicalItem) {
      try {
        const webhookOrderId = order.order_number || order.id;
        const statusValue = effectiveAction === "approve"
          ? "accepted"
          : (fulfillmentType === "mixed" ? "refused_physical" : "refused");
        const webhookPayload: Record<string, unknown> = {
          order_id: webhookOrderId, supabase_id: order.id, status: statusValue,
        };
        if (effectiveAction === "reject" && fulfillmentType === "mixed") {
          webhookPayload.refund_due_amount = physicalRefundDue;
        }
        if (invoiceNumberForWebhook) webhookPayload.invoice_number = invoiceNumberForWebhook;
        if (invoiceUrlForWebhook) webhookPayload.invoice_url = invoiceUrlForWebhook;
        await fetch("https://hook.eu1.make.com/dmmtxutu1pwcu3w3al8c25gifbspag7r", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(webhookPayload),
        });
        console.log("Make.com status webhook sent:", webhookPayload);
      } catch (e) {
        console.error("Make.com status webhook error:", e);
      }
    } else {
      console.log("Workshop-only order — Make.com status webhook skipped:", order.id);
    }

    return new Response(JSON.stringify({
      success: true,
      status: decidedPV,
      orderValidation: decidedOV,
      physicalValidation: decidedPV,
      fulfillmentType,
      refundStatus: decidedRefundStatus,
      refundDueAmount: decidedRefundStatus === "to_refund" ? physicalRefundDue : 0,
      alreadyDecided,
      paymentAction,
      approvalEmailSent: !!approvalEmailResult,
      declineEmailSent: !!declineEmailResult,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error managing order:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
