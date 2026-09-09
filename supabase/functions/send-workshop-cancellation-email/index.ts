import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { workshopTitle, formatWorkshopDate, type WorkshopType } from "../_shared/workshops.ts";

// Customer email after a partial (or full) workshop-seat cancellation.
// Read-only on orders / workshop_sessions / workshop_reservations. No emoji.
// Same Bento charter as send-workshop-email. Never touches PostFinance / Make /
// order_validation / cake emails.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function getCustomerLang(order: any): "fr" | "en" {
  return order?.lang === "en" ? "en" : "fr";
}

function chf(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
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

  let refundLine: string;
  if (opts.refundStatus === "refunded") {
    refundLine = tr(
      `A refund of CHF ${chf(opts.refundAmount || opts.nominalRefund)} has been issued.`,
      `Un remboursement de CHF ${chf(opts.refundAmount || opts.nominalRefund)} a été effectué.`,
    );
  } else if (opts.refundStatus === "pending") {
    refundLine = tr(
      `Your refund of CHF ${chf(opts.nominalRefund)} is being processed.`,
      `Votre remboursement de CHF ${chf(opts.nominalRefund)} est en cours de traitement.`,
    );
  } else if (opts.refundStatus === "failed") {
    refundLine = tr(
      `A refund of CHF ${chf(opts.nominalRefund)} is due for this cancellation. Bento Cake Studio will follow up to make sure it reaches you.`,
      `Un remboursement de CHF ${chf(opts.nominalRefund)} est dû pour cette annulation. Bento Cake Studio effectuera le suivi pour qu'il vous parvienne.`,
    );
  } else {
    // outside_window | non_required
    refundLine = tr(
      "In accordance with our cancellation conditions, this change does not give rise to a refund.",
      "Conformément à nos conditions d'annulation, cette modification ne donne pas lieu à un remboursement.",
    );
  }

  const logoUrl = "https://dimsoon58.github.io/mini-cake-corner/logo-red.png";
  const subject = tr(
    "Update to your Workshop booking – Bento Cake Studio",
    "Mise à jour de votre réservation Workshop – Bento Cake Studio",
  );

  const rowCell = (label: string, value: string) =>
    `<tr style="border-bottom:1px solid #D4C89A;">
      <td style="padding:10px 14px;color:#7A6540;font-size:13px;width:55%;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${label}</td>
      <td style="padding:10px 14px;color:#351E13;font-size:13px;font-weight:700;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${value}</td>
    </tr>`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#78020C;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;">

    <div style="background:#FDF8E1;margin:0 20px;">
      <div style="padding:36px 40px 0;text-align:center;">
        <img src="${logoUrl}" alt="Bento Cake Studio" style="height:72px;width:auto;display:block;margin:0 auto 28px;" />
      </div>

      <div style="padding:0 40px 36px;">
        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 12px;">
          ${tr("Hello", "Bonjour")} ${firstName},
        </p>

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 24px;">
          ${tr(
            `Your booking <strong>${reference}</strong> has been updated.`,
            `Votre réservation <strong>${reference}</strong> a été mise à jour.`,
          )}
        </p>

        <p style="color:#78020C;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;margin:0 0 8px;">
          ${tr("Booking", "Réservation")} ${reference}
        </p>
        <table style="border-collapse:collapse;width:100%;border:1px solid #D4C89A;">
          ${rowCell(tr("Workshop", "Atelier"), title)}
          ${rowCell(tr("Date", "Date"), `${formatWorkshopDate(session.workshop_date)} · ${session.workshop_time}`)}
          ${rowCell(tr("Seats purchased", "Places achetées"), String(purchased))}
          ${rowCell(tr("Seats cancelled", "Places annulées"), String(cancelled))}
          ${rowCell(tr("Seats remaining", "Places restantes"), String(active))}
        </table>

        <div style="border-left:3px solid #78020C;background:#F5EDCC;padding:14px 18px;margin:24px 0 0;">
          <p style="color:#351E13;font-size:14px;line-height:1.7;margin:0;">
            ${refundLine}
          </p>
        </div>

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:28px 0 0;">
          ${tr("Thank you for your understanding,", "Merci pour votre compréhension,")}<br>
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
    return new Response(null, { headers: corsHeaders });
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
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error in send-workshop-cancellation-email:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
