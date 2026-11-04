import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { getPostFinanceCredentials, pfFetch } from "../_shared/postfinance.ts";
import { getPaymentPageUrl, getTransactionState } from "../_shared/postfinance-transactions.ts";
import { finalizePaymentAttempt, PAYMENT_LINK_MERCHANT_PREFIX } from "../_shared/payment-links.ts";
import { getSiteBaseUrl } from "../_shared/site-config.ts";
import { alertTime, sendTechnicalAlert } from "../_shared/admin-alert.ts";
import { corsHeaders } from "../_shared/cors.ts";

// F41 (04.11.2026) — page publique /payer/<jeton> d'une commande manuelle.
// Public (le client n'a pas de compte) : le jeton aléatoire du lien est la
// seule clé. Ne renvoie que le numéro, le prénom et les montants.
//   get    : état du lien et solde restant
//   start  : solde recalculé maintenant → transaction PostFinance
//            (COMPLETE_DEFERRED) → URL de la page de paiement
//   status : retour de PostFinance (?a=<tentative>) : finalise et renvoie l'état

const TOKEN_RE = /^[A-Za-z0-9]{20,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const r2 = (n: unknown) => Math.round(Number(n ?? 0) * 100) / 100;

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(cors, { error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "get");
    const token = String(body?.token ?? "");
    if (!TOKEN_RE.test(token)) return json(cors, { error: "Lien introuvable", reason: "not_found" }, 404);
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });

    const { data: link } = await supabase.from("order_payment_links").select("*").eq("token", token).maybeSingle();
    if (!link) return json(cors, { error: "Lien introuvable", reason: "not_found" }, 404);

    const view = async () => {
      const { data: o } = await supabase.from("orders")
        .select("id, order_number, first_name, lang, total_amount, payment_status, order_validation, order_failure_reason, is_draft").eq("id", link.order_id).maybeSingle();
      const { data: pays } = await supabase.from("manual_order_payments").select("amount").eq("order_id", link.order_id).eq("status", "recorded");
      const paid = r2((pays ?? []).reduce((s: number, p: { amount: number }) => s + Number(p.amount), 0));
      const total = r2(o?.total_amount);
      const cancelled = !o || o.order_validation === "cancelled" || o.order_validation === "rejected" || !!o.order_failure_reason;
      const fullyPaid = o?.payment_status === "paid";
      const { data: l2 } = await supabase.from("order_payment_links").select("status").eq("id", link.id).maybeSingle();
      return {
        orderNumber: o?.order_number ?? null,
        firstName: o?.first_name ?? null,
        lang: o?.lang === "en" ? "en" : "fr",
        total,
        paid: fullyPaid ? total : paid,
        balance: fullyPaid ? 0 : Math.max(r2(total - paid), 0),
        state: fullyPaid ? "paid" : cancelled ? "cancelled" : l2?.status === "active" ? "open" : l2?.status ?? "disabled",
      };
    };

    if (action === "get") return json(cors, { data: await view() });

    if (action === "status") {
      const attemptId = String(body?.attempt ?? "");
      if (!UUID_RE.test(attemptId)) return json(cors, { data: { ...(await view()), attempt: null } });
      const { data: att } = await supabase.from("order_payment_attempts").select("id").eq("id", attemptId).eq("link_id", link.id).maybeSingle();
      const result = att ? await finalizePaymentAttempt(supabase, att.id) : null;
      return json(cors, { data: { ...(await view()), attempt: result ? { status: result.status, emailSent: !!result.emailSent } : null } });
    }

    if (action === "start") {
      const { data: begin, error: bErr } = await supabase.rpc("payment_link_begin", { p_token: token });
      if (bErr) {
        const m = String(bErr.message ?? "");
        const reason = m.includes("link_paid") ? "paid" : m.includes("link_disabled") || m.includes("link_unpayable") ? "closed" : "error";
        if (reason === "error") console.error("pay-order-link: begin failed:", bErr);
        return json(cors, { error: reason, reason, data: await view() }, reason === "error" ? 500 : 409);
      }
      if (begin?.in_progress) return json(cors, { error: "in_progress", reason: "in_progress" }, 409);

      const credentials = getPostFinanceCredentials();
      // Même tentative récente, même montant : on rouvre sa page si elle attend encore.
      if (begin?.reuse) {
        const st = String(await getTransactionState(credentials, begin.transaction_id) ?? "").toUpperCase();
        if (st === "PENDING" || st === "CREATE" || st === "CONFIRMED") {
          return json(cors, { data: { paymentPageUrl: await getPaymentPageUrl(credentials, begin.transaction_id), attemptId: begin.attempt_id } });
        }
        if (st === "AUTHORIZED" || st === "PROCESSING" || st === "COMPLETED" || st === "FULFILL") {
          await finalizePaymentAttempt(supabase, begin.attempt_id);
          return json(cors, { error: "in_progress", reason: "in_progress", data: await view() }, 409);
        }
        // Échouée : on la clôt et on en crée une nouvelle.
        await supabase.rpc("payment_attempt_update", { p_attempt_id: begin.attempt_id, p_status: "failed", p_detail: st || "expirée" });
        const again = await supabase.rpc("payment_link_begin", { p_token: token });
        if (again.error || !again.data?.attempt_id || again.data?.reuse) return json(cors, { error: "error", reason: "error" }, 500);
        Object.assign(begin, again.data, { reuse: false });
      }

      const site = getSiteBaseUrl();
      const lang = begin.lang === "en" ? "en" : "fr";
      let tx: { id: number };
      try {
        tx = await pfFetch(credentials, "/payment/transactions", "POST", {
          currency: "CHF",
          language: lang === "en" ? "en-US" : "fr-CH",
          ...(String(begin.email ?? "").trim() ? { customerEmailAddress: String(begin.email).trim() } : {}),
          merchantReference: `${PAYMENT_LINK_MERCHANT_PREFIX}${begin.attempt_id}`,
          successUrl: `${site}/payer/${token}?a=${begin.attempt_id}`,
          failedUrl: `${site}/payer/${token}?payment=failed`,
          // Même réglage que les commandes du site : autorisation, puis débit
          // seulement après vérification du solde en base.
          completionBehavior: "COMPLETE_DEFERRED",
          lineItems: [{
            uniqueId: "balance",
            name: lang === "en" ? `Order ${begin.order_number}: balance` : `Commande ${begin.order_number} : solde`,
            quantity: 1,
            amountIncludingTax: r2(begin.amount),
            type: "PRODUCT",
          }],
          metaData: { order_id: begin.order_id, payment_attempt_id: begin.attempt_id },
        }) as { id: number };
      } catch (e) {
        console.error("pay-order-link: transaction create failed:", e);
        await supabase.rpc("payment_attempt_update", { p_attempt_id: begin.attempt_id, p_status: "failed", p_detail: "Création PostFinance impossible" });
        await sendTechnicalAlert({
          subject: `Échec création transaction PostFinance — lien ${begin.order_number}`,
          lines: [`Commande : ${begin.order_number}`, `Montant : CHF ${r2(begin.amount)}`, `Heure : ${alertTime()}`, `Erreur : ${e instanceof Error ? e.message : String(e)}`],
        });
        return json(cors, { error: "payment_init", reason: "payment_init" }, 502);
      }
      await supabase.rpc("payment_attempt_update", { p_attempt_id: begin.attempt_id, p_status: "pending", p_tx: String(tx.id) });
      try {
        return json(cors, { data: { paymentPageUrl: await getPaymentPageUrl(credentials, tx.id), attemptId: begin.attempt_id } });
      } catch (e) {
        console.error("pay-order-link: payment page URL failed:", e);
        return json(cors, { error: "payment_page", reason: "payment_page" }, 502);
      }
    }

    return json(cors, { error: "Action inconnue", reason: "input" }, 400);
  } catch (e) {
    console.error("pay-order-link error:", e);
    return json(cors, { error: "Erreur inattendue. Réessayez.", reason: "server" }, 500);
  }
});
