import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { getPostFinanceCredentials, pfFetch } from "../_shared/postfinance.ts";
import { getPaymentPageUrl } from "../_shared/postfinance-transactions.ts";
import { getSiteBaseUrl } from "../_shared/site-config.ts";
import { alertTime, sendTechnicalAlert } from "../_shared/admin-alert.ts";
import { GIFT_CARD_MAX, GIFT_CARD_MIN, GIFT_MERCHANT_PREFIX } from "../_shared/gift-cards.ts";
import { corsHeaders } from "../_shared/cors.ts";

// F37 (03.11.2026) — « Bon cadeau » page: starts the PostFinance payment of
// a gift voucher. Public (the buyer does not need an account).
//
// The amount is chosen freely by the buyer, CHF 20 to 500, whole francs or
// cents. The voucher row is created « pending » first (its id is the
// PostFinance merchantReference « GIFT-<id> »), then the transaction with
// IMMEDIATE capture — no administrator decision for a voucher. Activation
// (code, balance, email) happens only in finalizeGiftCard, after PostFinance
// says COMPLETED: confirm-gift-card-payment (thank-you page) or the webhook.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(cors, { error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => ({}));
  const lang = body?.lang === "en" ? "en" : "fr";
  const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);

  const amount = Math.round(Number(String(body?.amount ?? "").replace(",", ".")) * 100) / 100;
  const buyerName = clean(body?.buyerName, 120);
  const buyerEmail = clean(body?.buyerEmail, 254).toLowerCase();
  const recipientName = clean(body?.recipientName, 80) || null;
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 200) || null : null;

  if (!Number.isFinite(amount) || amount < GIFT_CARD_MIN || amount > GIFT_CARD_MAX) {
    return json(cors, { error: tr(`Choose an amount between CHF ${GIFT_CARD_MIN} and ${GIFT_CARD_MAX}.`, `Choisissez un montant entre CHF ${GIFT_CARD_MIN} et ${GIFT_CARD_MAX}.`), reason: "input" }, 400);
  }
  if (!buyerName) return json(cors, { error: tr("Please enter your name.", "Merci d'indiquer votre nom."), reason: "input" }, 400);
  if (!EMAIL_RE.test(buyerEmail)) return json(cors, { error: tr("Please enter a valid email address.", "Merci d'indiquer une adresse email valide."), reason: "input" }, 400);
  if (body?.acceptTerms !== true) return json(cors, { error: tr("Please accept the gift card conditions.", "Merci d'accepter les conditions des bons cadeaux."), reason: "input" }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });

  const { data: card, error: insErr } = await supabase.from("gift_cards")
    .insert({ initial_amount: amount, buyer_name: buyerName, buyer_email: buyerEmail, recipient_name: recipientName, message, lang, source: "online" })
    .select("id").single();
  if (insErr || !card) {
    console.error("create-gift-card-payment: insert failed:", insErr);
    return json(cors, { error: tr("We couldn't start the payment. Please try again.", "Nous n'avons pas pu démarrer le paiement. Merci de réessayer."), reason: "server" }, 500);
  }

  const site = getSiteBaseUrl();
  const credentials = getPostFinanceCredentials();
  let transaction: { id: number };
  try {
    transaction = await pfFetch(credentials, "/payment/transactions", "POST", {
      currency: "CHF",
      language: lang === "en" ? "en-US" : "fr-CH",
      customerEmailAddress: buyerEmail,
      merchantReference: `${GIFT_MERCHANT_PREFIX}${card.id}`,
      successUrl: `${site}/bon-cadeau/merci?gc=${card.id}`,
      failedUrl: `${site}/bon-cadeau?payment=failed`,
      // Immediate capture: a voucher needs no acceptance by the team.
      completionBehavior: "COMPLETE_IMMEDIATE",
      lineItems: [{
        uniqueId: "gift-card",
        name: lang === "en" ? "Bento Cake Studio gift card" : "Bon cadeau Bento Cake Studio",
        quantity: 1,
        amountIncludingTax: amount,
        type: "PRODUCT",
      }],
      metaData: { gift_card_id: card.id, buyer_name: buyerName },
    }) as { id: number };
  } catch (e) {
    console.error("create-gift-card-payment: transaction create failed:", e);
    await supabase.from("gift_cards").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", card.id).eq("status", "pending");
    await sendTechnicalAlert({
      subject: `Échec création transaction PostFinance — bon cadeau ${card.id}`,
      lines: [`Bon cadeau : ${card.id}`, `Montant : CHF ${amount}`, `Heure : ${alertTime()}`, `Erreur : ${e instanceof Error ? e.message : String(e)}`],
    });
    return json(cors, { error: tr("We couldn't start the payment. Please try again.", "Nous n'avons pas pu démarrer le paiement. Merci de réessayer."), reason: "payment_init" }, 502);
  }

  const { error: txErr } = await supabase.from("gift_cards")
    .update({ postfinance_transaction_id: String(transaction.id), updated_at: new Date().toISOString() }).eq("id", card.id);
  if (txErr) {
    // The webhook still finds the voucher through merchantReference GIFT-<id>.
    console.error(`create-gift-card-payment: could not save transaction ${transaction.id} for ${card.id}:`, txErr);
  }

  try {
    const paymentPageUrl = await getPaymentPageUrl(credentials, transaction.id);
    return json(cors, { paymentPageUrl, giftCardId: card.id });
  } catch (e) {
    console.error("create-gift-card-payment: payment page URL failed:", e);
    return json(cors, { error: tr("The payment page could not open. Please try again.", "La page de paiement n'a pas pu s'ouvrir. Merci de réessayer."), reason: "payment_page" }, 502);
  }
});
