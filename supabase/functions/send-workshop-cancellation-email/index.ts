import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { getLogoEmailUrl } from "../_shared/site-config.ts";

import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { workshopTitle, formatWorkshopDate, type WorkshopType } from "../_shared/workshops.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { FORCE_LIGHT_META_TAGS, brandDarkModeStyle } from "../_shared/email-darkmode.ts";

// Customer email after a partial (or full) workshop-seat cancellation.
// Read-only on orders / workshop_sessions / workshop_reservations. No emoji.
// Same Bento charter as send-workshop-email. Never touches PostFinance / Make /
// order_validation / cake emails.


function getCustomerLang(order: any): "fr" | "en" {
  return order?.lang === "en" ? "en" : "fr";
}

async function sendCancellationEmail(
  resendApiKey: string,
  order: any,
  session: any,
  reservation: any,
  opts: {
    seatsCancelled: number;
    refundAmount: number;
    nominalRefund: number;
    refundStatus: "non_required" | "pending" | "refunded" | "outside_window" | "failed";
  },
) {
  const lang = getCustomerLang(order);
  const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);

  const firstName = order.first_name || "";
  const reference = reservation.workshop_reference;
  const title = workshopTitle((reservation.workshop_type as WorkshopType) ?? "signature", lang);
  const purchased = Number(reservation.purchased_seats) || 0;
  const cancelled = Number(reservation.cancelled_seats) || 0;
  const active = purchased - cancelled;
  // 2026-09-14: the headline now says plainly that this IS a cancellation
  // (previously just "has been updated", which never confirmed a
  // cancellation happened at all) — with a distinct wording for a full vs a
  // partial cancellation, since "your workshop" would be misleading when
  // seats are still active on this same booking.
  const isFullCancellation = active <= 0;
  const cancellationHeadline = isFullCancellation
    ? tr(
        "We confirm the cancellation of your workshop.",
        "Nous confirmons l'annulation de votre workshop.",
      )
    : tr(
        "We confirm the cancellation of part of your booking.",
        "Nous confirmons l'annulation d'une partie de votre réservation.",
      );

  // 2026-09-19: never shows a CHF amount to the customer — not CHF 0, not
  // the real due amount. The refund figure is an internal admin/finance
  // detail (workshop_cancellation_log.refund_amount_requested/_completed),
  // never something the customer needs to see or reconcile by eye; showing
  // "CHF 0.00" before the manual PostFinance refund was actually done (the
  // normal state for days/weeks) read as if nothing was owed at all.
  // opts.refundAmount/nominalRefund are still received (unchanged request
  // contract with cancel-workshop-seats) but deliberately unused here now.
  let refundLine: string;
  if (opts.refundStatus === "refunded") {
    refundLine = tr(
      "Your seat has been cancelled. The corresponding refund has been processed to your original payment method.",
      "Votre place a bien été annulée. Le remboursement correspondant a été traité selon votre moyen de paiement initial.",
    );
  } else if (opts.refundStatus === "pending" || opts.refundStatus === "failed") {
    refundLine = tr(
      "Your seat has been cancelled. The corresponding refund will be processed to your original payment method.",
      "Votre place a bien été annulée. Le remboursement correspondant sera traité selon votre moyen de paiement initial.",
    );
  } else {
    // outside_window | non_required
    refundLine = tr(
      "In accordance with our cancellation conditions, this change does not give rise to a refund.",
      "Conformément à nos conditions d'annulation, cette modification ne donne pas lieu à un remboursement.",
    );
  }

  // Matches the logo rendering already used by every other Bento Cake
  // Studio customer email (manage-order's approval/decline emails,
  // send-order-received-email, send-workshop-email) — same asset, same
  // width:240px/height:auto, same position. This file and send-auth-email
  // were the two left behind on the old logo-red.png at a fixed 72px
  // height; only this one is in scope for this change.
  const logoUrl = getLogoEmailUrl();
  const subject = tr(
    "Update to your Workshop booking – Bento Cake Studio",
    "Mise à jour de votre réservation Workshop – Bento Cake Studio",
  );

  const rowCell = (label: string, value: string) =>
    `<tr style="border-bottom:1px solid #D4C89A;">
      <td class="bcs-label" style="padding:10px 14px;color:#7A6540;font-size:13px;width:55%;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${label}</td>
      <td class="bcs-text" style="padding:10px 14px;color:#351E13;font-size:13px;font-weight:700;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${value}</td>
    </tr>`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${FORCE_LIGHT_META_TAGS}<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
${brandDarkModeStyle()}
</head>
<body style="margin:0;padding:0;background-color:#78020C!important;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#78020C" class="bcs-outer" style="background-color:#78020C!important;background-image:linear-gradient(#78020C,#78020C)!important;">
  <tr><td align="center" style="padding:0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;margin:0 auto;">
  <tr><td style="padding:0 20px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFF9DB" class="bcs-card" style="background-color:#FFF9DB!important;background-image:linear-gradient(#FFF9DB,#FFF9DB)!important;">
  <tr><td>
      <div style="padding:36px 40px 0;text-align:center;">
        <img src="${logoUrl}" alt="Bento Cake Studio" style="width:240px;height:auto;display:block;margin:0 auto 28px;" />
      </div>

      <div class="bcs-text" style="padding:0 40px 36px;">
        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 12px;">
          ${tr("Hello", "Bonjour")} ${firstName},
        </p>

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 24px;">
          ${cancellationHeadline}
        </p>

        <p class="bcs-title" style="color:#78020C;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;margin:0 0 8px;">
          ${tr("Booking", "Réservation")} ${reference}
        </p>
        <table style="border-collapse:collapse;width:100%;border:1px solid #D4C89A;">
          ${rowCell(tr("Workshop", "Atelier"), title)}
          ${rowCell(tr("Date", "Date"), `${formatWorkshopDate(session.workshop_date)} · ${session.workshop_time}`)}
          ${rowCell(tr("Seats purchased", "Places achetées"), String(purchased))}
          ${rowCell(tr("Seats cancelled", "Places annulées"), String(cancelled))}
          ${rowCell(tr("Seats remaining", "Places restantes"), String(active))}
        </table>

        <div class="bcs-callout" style="border-left:3px solid #78020C;background-color:#FFFFFF!important;background-image:linear-gradient(#FFFFFF,#FFFFFF)!important;padding:14px 18px;margin:24px 0 0;">
          <p style="color:#351E13;font-size:14px;line-height:1.7;margin:0;">
            ${refundLine}
          </p>
        </div>

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:28px 0 0;">
          ${tr("Thank you for your understanding,", "Merci pour votre compréhension,")}<br>
          <strong>Bento Cake Studio</strong>
        </p>
      </div>
  </td></tr>
  </table>
  </td></tr>
  <tr><td bgcolor="#78020C" class="bcs-spacer" style="height:24px;line-height:24px;font-size:1px;background-color:#78020C!important;background-image:linear-gradient(#78020C,#78020C)!important;">&nbsp;</td></tr>
  </table>
  </td></tr>
  </table>
</body>
</html>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "contact@bentocakestudio.ch", to: [order.email], subject, html }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    console.error("Workshop cancellation email send failed:", data);
    throw new Error(`Resend error: ${JSON.stringify(data)}`);
  }
  console.log("Workshop cancellation email sent:", data.id);
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }

  try {
    const { reservation_id, seats_cancelled, refund_amount, nominal_refund, refund_status } = await req.json();
    if (!reservation_id) throw new Error("reservation_id is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const { data: reservation, error: resErr } = await supabase
      .from("workshop_reservations").select("*").eq("id", reservation_id).single();
    if (resErr || !reservation) throw new Error("Workshop reservation not found");

    const { data: session, error: sessErr } = await supabase
      .from("workshop_sessions").select("*").eq("id", reservation.workshop_session_id).single();
    if (sessErr || !session) throw new Error("Workshop session not found");

    const { data: order, error: orderErr } = await supabase
      .from("orders").select("*").eq("id", reservation.order_id).single();
    if (orderErr || !order) throw new Error("Order not found");

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) throw new Error("RESEND_API_KEY not configured");

    const result = await sendCancellationEmail(resendKey, order, session, reservation, {
      seatsCancelled: Number(seats_cancelled) || 0,
      refundAmount: Number(refund_amount) || 0,
      nominalRefund: Number(nominal_refund) || 0,
      refundStatus: (refund_status ?? "non_required"),
    });

    return new Response(JSON.stringify({ success: true, id: result.id }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error in send-workshop-cancellation-email:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      status: 500,
    });
  }
});
