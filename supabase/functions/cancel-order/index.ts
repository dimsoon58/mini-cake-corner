import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { DARKMODE_META_TAGS, brandDarkModeStyle } from "../_shared/email-darkmode.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-make-secret",
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
    .replaceAll("'", "&#039;");
}

function getCustomerLang(order: any): "fr" | "en" {
  return order?.lang === "en" ? "en" : "fr";
}

function getServerKey(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.default === "string") return parsed.default;
    const first = Object.values(parsed).find((v) => typeof v === "string");
    if (typeof first === "string") return first;
  }

  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;

  throw new Error("No Supabase server secret is configured");
}

function isAuthorized(req: Request): boolean {
  const expected = Deno.env.get("MAKE_CANCEL_SECRET") ?? "";
  const provided = req.headers.get("x-make-secret") ?? "";
  if (!expected || !provided || expected.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}

async function sendCancellationEmail(resendApiKey: string, order: any) {
  const lang = getCustomerLang(order);
  const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);
  const orderNumber = order.order_number || String(order.id).slice(0, 8).toUpperCase();
  const firstName = order.first_name || "";

  let paymentParagraph = "";
  if (order.refund_status === "to_refund") {
    paymentParagraph = `<p class="bcs-text" style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 20px;">${tr(
      "The refund will be processed within the next few business days.",
      "Le remboursement sera effectué dans les prochains jours ouvrables.",
    )}</p>`;
  }

  // Same Bento Cake Studio wordmark asset + size, wrapper structure, fonts,
  // colours and footer as every other customer-facing email in this
  // codebase (see send-order-received-email/index.ts, the reference
  // template — identical shell in manage-order's sendApprovalEmail /
  // sendDeclineEmail and send-workshop-email). Content below is otherwise
  // unchanged: same wording, same conditional refund paragraph, same esc()
  // escaping on customer-supplied fields.
  const logoUrl = "https://dimsoon58.github.io/mini-cake-corner/logo-red-email.png";
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${DARKMODE_META_TAGS}<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
${brandDarkModeStyle()}
</head>
<body style="margin:0;padding:0;background-color:#78020C;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#78020C" class="bcs-outer" style="background-color:#78020C;">
  <tr><td align="center" style="padding:0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;margin:0 auto;">
  <tr><td style="padding:0 20px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FDF8E1" class="bcs-card" style="background-color:#FDF8E1;">
  <tr><td>
      <div style="padding:36px 40px 0;text-align:center;">
        <img src="${logoUrl}" alt="Bento Cake Studio" style="width:240px;height:auto;display:block;margin:0 auto 28px;" />
      </div>

      <div class="bcs-text" style="padding:0 40px 36px;">
        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 12px;">
          ${tr("Hello", "Bonjour")} ${esc(firstName)},
        </p>

        <div class="bcs-callout" style="border-left:3px solid #78020C;background:#F5EDCC;padding:14px 18px;margin:0 0 20px;">
          <p style="color:#351E13;font-size:14px;line-height:1.7;margin:0;">
            ${tr(
              `Following your request, we confirm the cancellation of your order <strong>#${esc(orderNumber)}</strong>.`,
              `Suite à votre demande, nous confirmons l’annulation de votre commande <strong>n° ${esc(orderNumber)}</strong>.`,
            )}
          </p>
        </div>

        ${paymentParagraph}

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0;">
          ${tr("See you soon", "À bientôt")},<br>
          <strong>${tr("The Bento Cake Studio Team", "L’équipe Bento Cake Studio")}</strong> 🤍
        </p>
      </div>
  </td></tr>
  </table>
  </td></tr>
  <tr><td bgcolor="#78020C" class="bcs-spacer" style="height:24px;line-height:24px;font-size:1px;background-color:#78020C;">&nbsp;</td></tr>
  </table>
  </td></tr>
  </table>
</body>
</html>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `order-cancellation-${order.id}`,
    },
    body: JSON.stringify({
      from: "contact@bentocakestudio.ch",
      to: [order.email],
      subject: tr(`Order cancellation — #${orderNumber}`, `Annulation de votre commande — n° ${orderNumber}`),
      html,
    }),
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(`Resend error: ${JSON.stringify(data)}`);
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!Deno.env.get("MAKE_CANCEL_SECRET")) return json({ error: "Server cancellation secret is not configured" }, 503);
  if (!isAuthorized(req)) return json({ error: "Unauthorized" }, 401);

  let supabase: any = null;
  let orderId = "";
  let locked = false;

  try {
    const body = await req.json();
    orderId = String(body?.orderId || body?.order_id || "").trim();
    const cancellationReason = String(body?.cancellationReason || body?.cancellation_reason || "").trim();
    if (!orderId) return json({ error: "orderId is required" }, 400);

    supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      getServerKey(),
      { auth: { persistSession: false } },
    );

    const { data: initialOrder, error: initialError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single();

    if (initialError) {
      console.error("cancel-order initial lookup:", initialError);
      return json({
        error: "Order lookup failed",
        code: initialError.code,
        message: initialError.message,
      }, 500);
    }

    if (!initialOrder) {
      return json({ error: "Order not found" }, 404);
    }

    if (initialOrder.cancellation_status === "sent" || initialOrder.cancellation_email_sent_at) {
      return json({
        success: true,
        alreadyCancelled: true,
        orderId: initialOrder.id,
        orderNumber: initialOrder.order_number,
        orderValidation: initialOrder.order_validation,
        paymentStatus: initialOrder.payment_status,
        refundStatus: initialOrder.refund_status,
        emailId: initialOrder.cancellation_email_id,
        cancelledAt: initialOrder.cancelled_at,
      });
    }

    const { data: lockRows, error: lockError } = await supabase
      .from("orders")
      .update({ cancellation_status: "processing" })
      .eq("id", orderId)
      .or("cancellation_status.is.null,cancellation_status.eq.error")
      .select("*");
    if (lockError) throw lockError;

    if (!lockRows || lockRows.length === 0) {
      const { data: current } = await supabase.from("orders").select("*").eq("id", orderId).single();
      if (current?.cancellation_status === "sent" || current?.cancellation_email_sent_at) {
        return json({
          success: true,
          alreadyCancelled: true,
          orderId: current.id,
          orderNumber: current.order_number,
          orderValidation: current.order_validation,
          paymentStatus: current.payment_status,
          refundStatus: current.refund_status,
          emailId: current.cancellation_email_id,
          cancelledAt: current.cancelled_at,
        });
      }
      return json({ error: "Cancellation is already being processed" }, 409);
    }

    locked = true;
    const order = lockRows[0];
    const now = new Date().toISOString();
    const originalPaymentStatus = order.payment_status;
    const originalRefundStatus = order.refund_status ?? "none";
    const resultingPaymentStatus = (originalPaymentStatus === "paid" || originalPaymentStatus === "refunded")
      ? originalPaymentStatus
      : "cancelled";

    let resultingRefundStatus = originalRefundStatus;
    if (originalPaymentStatus === "refunded") {
      resultingRefundStatus = "refunded";
    } else if (originalPaymentStatus === "paid" && originalRefundStatus !== "refunded") {
      resultingRefundStatus = "to_refund";
    }

    const orderUpdate: Record<string, unknown> = {
      order_validation: "cancelled",
      payment_status: resultingPaymentStatus,
      refund_status: resultingRefundStatus,
      cancelled_at: order.cancelled_at || now,
    };
    if (cancellationReason) orderUpdate.cancellation_reason = cancellationReason;

    const { error: orderUpdateError } = await supabase
      .from("orders")
      .update(orderUpdate)
      .eq("id", orderId);
    if (orderUpdateError) throw orderUpdateError;

    const { data: cancelledItems, error: itemsError } = await supabase
      .from("order_items")
      .update({ production_status: "cancelled" })
      .eq("order_id", orderId)
      .select("id");
    if (itemsError) throw itemsError;

    if (!order.email) throw new Error("Order has no customer email");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) throw new Error("RESEND_API_KEY not configured");

    const email = await sendCancellationEmail(resendApiKey, {
      ...order,
      order_validation: "cancelled",
      payment_status: resultingPaymentStatus,
      refund_status: resultingRefundStatus,
      cancelled_at: order.cancelled_at || now,
      cancellation_reason: cancellationReason || order.cancellation_reason,
    });

    const sentAt = new Date().toISOString();
    const { error: finalUpdateError } = await supabase
      .from("orders")
      .update({
        cancellation_status: "sent",
        cancellation_email_sent_at: sentAt,
        cancellation_email_id: email?.id || null,
      })
      .eq("id", orderId);
    if (finalUpdateError) throw finalUpdateError;

    return json({
      success: true,
      alreadyCancelled: false,
      orderId,
      orderNumber: order.order_number,
      originalPaymentStatus,
      originalRefundStatus,
      paymentStatus: resultingPaymentStatus,
      refundStatus: resultingRefundStatus,
      orderValidation: "cancelled",
      itemsCancelled: cancelledItems?.length || 0,
      cancelledAt: order.cancelled_at || now,
      emailId: email?.id || null,
    });
  } catch (error) {
    console.error("cancel-order error:", error);
    if (locked && supabase && orderId) {
      try {
        await supabase.from("orders").update({ cancellation_status: "error" }).eq("id", orderId);
      } catch (_) {}
    }
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
