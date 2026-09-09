import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { workshopTitle, formatWorkshopDate, type WorkshopType } from "../_shared/workshops.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// orders.lang is written by Checkout.tsx directly; French is the default.
function getCustomerLang(order: any): "fr" | "en" {
  return order?.lang === "en" ? "en" : "fr";
}

function chf(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

// One order_items row for a workshop line. Every value shown comes straight
// from what was stored at checkout — nothing is recomputed, nothing is read
// from the request body.
interface WorkshopItem {
  workshop_type: string | null;
  workshop_date: string | null;
  workshop_time: string | null;
  workshop_participants: number | null;
  workshop_unit_price: number | null;
  total: number | null;
}

// "Before your workshop" static content — identical wording for every
// customer, only the language differs. No emoji, no icons.
const BEFORE_WORKSHOP = {
  fr: {
    title: "AVANT VOTRE WORKSHOP",
    sections: [
      {
        h: "Arrivée",
        p: "Nous vous recommandons d'arriver 5 minutes avant le début. Une tolérance maximale de 15 minutes de retard est accordée. Au-delà, l'accès à l'atelier peut être refusé. Le workshop se terminera dans tous les cas à l'heure initialement prévue.",
      },
      {
        h: "Participants mineurs",
        p: "Les participants de moins de 14 ans doivent être accompagnés d'un adulte. À partir de 14 ans, les mineurs peuvent participer sans accompagnateur, avec l'accord de leur représentant légal.",
      },
      {
        h: "Sécurité",
        p: "Les consignes d'hygiène et de sécurité doivent être respectées. Toute personne se présentant sous l'influence de l'alcool, de drogues ou de toute autre substance pouvant compromettre le bon déroulement ou la sécurité de l'atelier pourra se voir refuser l'accès, sans remboursement.",
      },
      {
        h: "Annulation",
        p: "Un remboursement est possible en cas d'annulation au minimum 7 jours calendaires avant le workshop. Passé ce délai, la réservation n'est plus remboursable.",
      },
      {
        h: "Photos et vidéos",
        p: "Des photos ou vidéos peuvent être réalisées pendant l'atelier. Toute utilisation ou publication permettant de vous identifier, notamment sur les réseaux sociaux de Bento Cake Studio, sera soumise à votre accord préalable. Pour un participant mineur, l'autorisation de son représentant légal pourra être requise.",
      },
    ],
    allergiesTitle: "ALLERGIES",
    allergiesP: "Si vous avez une allergie ou une intolérance alimentaire, merci de nous en informer avant votre venue.",
  },
  en: {
    title: "BEFORE YOUR WORKSHOP",
    sections: [
      {
        h: "Arrival",
        p: "We recommend arriving 5 minutes before the workshop starts. A maximum delay of 15 minutes is accepted. After this time, entry may be refused. The workshop will end at the originally scheduled time regardless of arrival time.",
      },
      {
        h: "Minor participants",
        p: "Participants under the age of 14 must be accompanied by an adult. From the age of 14, minors may attend without an accompanying adult, subject to the consent of their legal representative.",
      },
      {
        h: "Safety",
        p: "Participants must follow the hygiene and safety instructions provided during the workshop. Anyone arriving under the influence of alcohol, drugs or any other substance that may compromise the safety or proper running of the workshop may be refused entry without a refund.",
      },
      {
        h: "Cancellation",
        p: "A refund is available if the booking is cancelled at least 7 calendar days before the workshop. After this deadline, the booking is non-refundable.",
      },
      {
        h: "Photos and videos",
        p: "Photos or videos may be taken during the workshop. Any use or publication in which you can be identified, including on Bento Cake Studio's social media, will be subject to your prior consent. For a minor participant, authorisation from their legal representative may be required.",
      },
    ],
    allergiesTitle: "ALLERGIES",
    allergiesP: "If you have any food allergies or intolerances, please let us know before attending.",
  },
} as const;

async function sendWorkshopEmail(resendApiKey: string, order: any, workshopItems: WorkshopItem[]) {
  const lang = getCustomerLang(order);
  const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);

  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();
  const firstName = order.first_name || "";

  const multiple = workshopItems.length > 1;
  const workshopSubtotal = workshopItems.reduce((sum, it) => sum + (Number(it.total) || 0), 0);

  const logoUrl = "https://dimsoon58.github.io/mini-cake-corner/logo-red.png";
  const subject = tr(
    "Your Workshop Booking – Bento Cake Studio",
    "Réservation de votre workshop – Bento Cake Studio",
  );

  const rowCell = (label: string, value: string) =>
    `<tr style="border-bottom:1px solid #D4C89A;">
      <td style="padding:10px 14px;color:#7A6540;font-size:13px;width:48%;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${label}</td>
      <td style="padding:10px 14px;color:#351E13;font-size:13px;font-weight:700;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${value}</td>
    </tr>`;

  const blocks = workshopItems.map((it, i) => {
    const heading = multiple
      ? `${tr("Workshop", "Atelier")} ${i + 1}`
      : tr("Your booking", "Votre réservation");
    const title = workshopTitle((it.workshop_type as WorkshopType) ?? "signature", lang);

    return `
      <p style="color:#78020C;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;margin:${i === 0 ? "0" : "24px"} 0 8px;">
        ${heading}
      </p>
      <table style="border-collapse:collapse;width:100%;border:1px solid #D4C89A;">
        ${rowCell(tr("Workshop", "Atelier"), title)}
        ${rowCell(tr("Date", "Date"), formatWorkshopDate(it.workshop_date))}
        ${rowCell(tr("Time", "Horaire"), it.workshop_time ?? "—")}
        ${rowCell(tr("Participants", "Participants"), it.workshop_participants != null ? String(it.workshop_participants) : "—")}
        ${rowCell(tr("Price per person", "Prix par personne"), `CHF ${chf(it.workshop_unit_price)}`)}
        ${rowCell(tr("Booking total", "Total de la réservation"), `CHF ${chf(it.total)}`)}
      </table>`;
  }).join("");

  // "Before your workshop" — visually distinct block: a beige slightly
  // darker than the card, square corners, no border-radius, no emoji.
  const bw = BEFORE_WORKSHOP[lang];
  const beforeSections = bw.sections.map((s) => `
        <p style="color:#351E13;font-size:14px;font-weight:700;margin:16px 0 4px;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${s.h}</p>
        <p style="color:#351E13;font-size:13px;line-height:1.7;margin:0;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${s.p}</p>`).join("");

  const beforeWorkshopBlock = `
      <div style="background:#F3E7C3;border:1px solid #D4C89A;padding:24px 24px;margin:24px 0 0;">
        <p style="color:#78020C;font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin:0;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${bw.title}</p>
        ${beforeSections}
        <p style="color:#78020C;font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin:24px 0 4px;padding-top:20px;border-top:1px solid #D4C89A;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${bw.allergiesTitle}</p>
        <p style="color:#351E13;font-size:13px;line-height:1.7;margin:0;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${bw.allergiesP}</p>
      </div>`;

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

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 12px;">
          ${tr("Thank you for booking with Bento Cake Studio.", "Merci pour votre réservation chez Bento Cake Studio.")}
        </p>

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 24px;">
          ${tr(
            `We have received your workshop booking for order <strong>#${orderNumber}</strong>.`,
            `Nous avons bien reçu votre réservation d'atelier pour la commande <strong>n° ${orderNumber}</strong>.`,
          )}
        </p>

        ${blocks}

        <table style="border-collapse:collapse;width:100%;margin:16px 0 0;">
          <tr style="background:#78020C;">
            <td style="padding:10px 14px;color:#FDF8E1;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${tr("Workshops total", "Total ateliers")}</td>
            <td style="padding:10px 14px;color:#FDF8E1;font-size:15px;font-weight:700;text-align:right;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">CHF ${chf(workshopSubtotal)}</td>
          </tr>
        </table>

        <div style="border-left:3px solid #78020C;background:#F5EDCC;padding:14px 18px;margin:24px 0 0;">
          <p style="color:#351E13;font-size:14px;line-height:1.7;margin:0;">
            ${tr(
              "Your booking is pending validation by our team. You will receive a confirmation email as soon as it has been accepted.",
              "Votre réservation est en attente de validation par notre équipe. Vous recevrez un email de confirmation dès qu'elle aura été acceptée.",
            )}
          </p>
        </div>

        ${beforeWorkshopBlock}

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:28px 0 24px;">
          ${tr("We can't wait to welcome you to the workshop!", "Nous avons hâte de vous accueillir en atelier !")}
        </p>

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0;">
          ${tr("Thank you for your trust,", "Merci pour votre confiance,")}<br>
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
      subject,
      html,
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    console.error("Workshop email send failed:", data);
    throw new Error(`Resend error: ${JSON.stringify(data)}`);
  }
  console.log("Workshop email sent to customer:", data.id);
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { orderId } = await req.json();
    if (!orderId) throw new Error("orderId is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // orders is read, never written — this function has no side effect on
    // order_validation, payment_status, or any other order field, and it
    // never touches Make / Notion / PostFinance.
    const { data: order, error: orderError } = await supabase
      .from("orders").select("*").eq("id", orderId).single();

    if (orderError || !order) throw new Error("Order not found");

    // Re-fetch the workshop lines server-side and filter here — the request
    // body carries only orderId, never any workshop detail.
    const { data: items, error: itemsError } = await supabase
      .from("order_items")
      .select("product, workshop_type, workshop_date, workshop_time, workshop_participants, workshop_unit_price, total")
      .eq("order_id", orderId)
      .eq("product", "workshop");

    if (itemsError) throw new Error(`Failed to load order items: ${itemsError.message}`);

    const workshopItems = (items ?? []).filter((it: any) => it.product === "workshop");

    // No workshop line -> nothing to send. Exit cleanly, no Resend call.
    if (workshopItems.length === 0) {
      console.log("send-workshop-email: order has no workshop items, skipping:", orderId);
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Stable display order.
    workshopItems.sort((a: any, b: any) => {
      const d = String(a.workshop_date ?? "").localeCompare(String(b.workshop_date ?? ""));
      return d !== 0 ? d : String(a.workshop_time ?? "").localeCompare(String(b.workshop_time ?? ""));
    });

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) throw new Error("RESEND_API_KEY not configured");

    const result = await sendWorkshopEmail(resendKey, order, workshopItems);

    return new Response(JSON.stringify({ success: true, id: result.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error in send-workshop-email:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
