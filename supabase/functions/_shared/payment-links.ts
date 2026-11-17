import { getPostFinanceCredentials, pfFetch } from "./postfinance.ts";
import { getTransactionState } from "./postfinance-transactions.ts";
import { alertTime, sendTechnicalAlert } from "./admin-alert.ts";

// F41 (04.11.2026) — lien de paiement d'une commande manuelle.
//
// Chaque clic « Payer » crée une tentative (order_payment_attempts) et une
// transaction PostFinance en COMPLETE_DEFERRED (même réglage que les
// commandes du site), référence marchand « MOP-<tentative> ».
//
// finalizePaymentAttempt() est appelée par le webhook PostFinance et par la
// page /payer (retour du client), autant de fois qu'on veut :
//   AUTHORIZED  → le paiement est enregistré en base sous verrou de la
//                 commande (solde re-vérifié, places de workshop si le solde
//                 est atteint), PUIS la carte est débitée (complete-online).
//                 Si la base refuse (déjà payée, montant > solde, commande
//                 annulée, session complète), l'autorisation est annulée
//                 (void-online) : rien n'est débité.
//   COMPLETED   → (moyen de paiement débité tout de suite) le paiement est
//                 enregistré ; si la base refuse, la tentative passe « à
//                 rembourser » et l'équipe est alertée. Jamais perdu.
//   FAILED…     → tentative échouée.
// Une transaction ne peut être enregistrée qu'une fois (contrainte unique).

export const PAYMENT_LINK_MERCHANT_PREFIX = "MOP-";

const FINAL = new Set(["paid", "voided", "failed", "to_refund"]);
// Refus « métier » de record_manual_order_payment : jamais réessayés.
const REFUSALS: Record<string, string> = {
  P0010: "Commande non créée depuis l'admin",
  P0011: "Commande en brouillon",
  P0012: "Commande annulée",
  P0013: "Commande déjà payée",
  P0014: "Montant supérieur au solde restant",
  P0003: "Session de workshop fermée",
  P0004: "Session de workshop complète",
  P0007: "Accord du représentant légal manquant",
};

export type AttemptResult = {
  status: "not_found" | "pending" | "paid" | "voided" | "failed" | "to_refund";
  fullyPaid?: boolean;
  orderId?: string;
  emailSent?: boolean;
  emailWanted?: boolean;
  detail?: string | null;
};

// deno-lint-ignore no-explicit-any
type Supa = any;

async function sendConfirmationOnce(supabase: Supa, orderId: string, linkId: string): Promise<{ wanted: boolean; sent: boolean }> {
  const { data: link } = await supabase.from("order_payment_links").select("send_confirmation").eq("id", linkId).maybeSingle();
  const { data: o } = await supabase.from("orders")
    .select("payment_status, email, is_historical, manual_confirmation_status, manual_confirmation_sent_at").eq("id", orderId).maybeSingle();
  // Pas d'envoi : case décochée, commande historique, pas d'adresse, pas encore payée.
  if (!link?.send_confirmation || !o || o.payment_status !== "paid" || o.is_historical === true || !String(o.email ?? "").trim()) {
    return { wanted: false, sent: false };
  }
  if (o.manual_confirmation_status === "sent" || o.manual_confirmation_sent_at) return { wanted: true, sent: true };
  // send-manual-order-confirmation se protège elle-même contre les doubles envois.
  try {
    const { data, error } = await supabase.functions.invoke("send-manual-order-confirmation", { body: { orderId } });
    if (error || data?.error) {
      console.error(`payment-links: confirmation for ${orderId} failed:`, error ?? data?.error);
      return { wanted: true, sent: false };
    }
    return { wanted: true, sent: true };
  } catch (e) {
    console.error(`payment-links: confirmation for ${orderId} threw:`, e);
    return { wanted: true, sent: false };
  }
}

async function alertOnce(supabase: Supa, attemptId: string, subject: string, lines: string[]) {
  const { data } = await supabase.from("order_payment_attempts")
    .update({ alerted_at: new Date().toISOString() }).eq("id", attemptId).is("alerted_at", null).select("id");
  if (Array.isArray(data) && data.length === 1) await sendTechnicalAlert({ subject, lines: [...lines, `Heure : ${alertTime()}`] });
}

export async function finalizePaymentAttempt(supabase: Supa, attemptId: string): Promise<AttemptResult> {
  const { data: att, error } = await supabase.from("order_payment_attempts").select("*").eq("id", attemptId).maybeSingle();
  if (error) throw new Error(`Failed to load attempt: ${error.message}`);
  if (!att) return { status: "not_found" };
  const { data: ord } = await supabase.from("orders").select("order_number").eq("id", att.order_id).maybeSingle();
  const orderLabel = ord?.order_number ?? att.order_id;

  const done = async (status: AttemptResult["status"], detail?: string | null): Promise<AttemptResult> => {
    const { data: o } = await supabase.from("orders").select("payment_status").eq("id", att.order_id).maybeSingle();
    const fullyPaid = o?.payment_status === "paid";
    let email = { wanted: false, sent: false };
    if (status === "paid" && fullyPaid) email = await sendConfirmationOnce(supabase, att.order_id, att.link_id);
    return { status, fullyPaid, orderId: att.order_id, emailWanted: email.wanted, emailSent: email.sent, detail: detail ?? att.detail ?? null };
  };

  if (FINAL.has(att.status)) return await done(att.status);
  if (!att.transaction_id) return { status: "pending", orderId: att.order_id };

  const credentials = getPostFinanceCredentials();
  const txId = String(att.transaction_id);
  const state = String(await getTransactionState(credentials, txId) ?? "").toUpperCase();
  if (!state) return { status: "pending", orderId: att.order_id };

  const record = async () => await supabase.rpc("record_manual_order_payment", {
    p_order_id: att.order_id, p_amount: Number(att.amount), p_method: "postfinance", p_paid_at: new Date().toISOString(),
    p_note: "Lien de paiement", p_by: "lien de paiement", p_source: "payment_link", p_attempt_id: att.id, p_tx: txId,
  });

  if (state === "AUTHORIZED") {
    const { error: recErr } = await record();
    if (recErr) {
      const code = (recErr as { code?: string }).code ?? "";
      if (!REFUSALS[code]) throw new Error(`record_manual_order_payment failed (${code}): ${recErr.message}`);
      // Refus : on libère l'autorisation, rien n'est débité.
      const before = String(await getTransactionState(credentials, txId) ?? "").toUpperCase();
      if (before === "AUTHORIZED") {
        try { await pfFetch(credentials, `/payment/transactions/${txId}/void-online`, "POST"); } catch (e) { console.error(`payment-links: void ${txId} failed:`, e); }
      }
      const after = String(await getTransactionState(credentials, txId) ?? "").toUpperCase();
      if (after !== "VOIDED") return { status: "pending", orderId: att.order_id, detail: `Annulation PostFinance non confirmée (${after})` };
      await supabase.rpc("payment_attempt_update", { p_attempt_id: att.id, p_status: "voided", p_detail: REFUSALS[code] });
      if (code === "P0004" || code === "P0003" || code === "P0007") {
        await alertOnce(supabase, att.id, `Lien de paiement refusé — ${orderLabel}`, [
          `Commande : ${orderLabel}`, `Montant : CHF ${Number(att.amount).toFixed(2)}`, `Raison : ${REFUSALS[code]}`,
          "Le paiement a été annulé, rien n'a été débité. Le lien reste actif.",
        ]);
      }
      return await done("voided", REFUSALS[code]);
    }
    // Enregistré en base : on débite maintenant.
    try { await pfFetch(credentials, `/payment/transactions/${txId}/complete-online`, "POST"); } catch (e) { console.error(`payment-links: complete ${txId} failed:`, e); }
    const after = String(await getTransactionState(credentials, txId) ?? "").toUpperCase();
    if (after !== "COMPLETED" && after !== "FULFILL") return { status: "pending", orderId: att.order_id };
    await supabase.rpc("payment_attempt_update", { p_attempt_id: att.id, p_status: "paid" });
    return await done("paid");
  }

  if (state === "COMPLETED" || state === "FULFILL") {
    const { error: recErr } = await record();
    if (recErr) {
      const code = (recErr as { code?: string }).code ?? "";
      if (!REFUSALS[code]) throw new Error(`record_manual_order_payment failed (${code}): ${recErr.message}`);
      // Débité mais refusé en base (ex. déjà payé entre-temps) : à rembourser.
      await supabase.rpc("payment_attempt_update", { p_attempt_id: att.id, p_status: "to_refund", p_detail: REFUSALS[code] });
      await alertOnce(supabase, att.id, `Paiement en trop à rembourser — ${orderLabel}`, [
        `Commande : ${orderLabel}`, `Montant : CHF ${Number(att.amount).toFixed(2)}`, `Transaction PostFinance : ${txId}`,
        `Raison : ${REFUSALS[code]}`, "À rembourser dans PostFinance, puis à noter dans l'admin.",
      ]);
      return await done("to_refund", REFUSALS[code]);
    }
    await supabase.rpc("payment_attempt_update", { p_attempt_id: att.id, p_status: "paid" });
    return await done("paid");
  }

  if (state === "FAILED" || state === "DECLINE" || state === "VOIDED") {
    // Cas très rare : enregistré en base puis débit impossible.
    const { data: pay } = await supabase.from("manual_order_payments").select("id").eq("postfinance_transaction_id", txId).eq("status", "recorded").maybeSingle();
    await supabase.rpc("payment_attempt_update", { p_attempt_id: att.id, p_status: "failed", p_detail: pay ? `Enregistré mais PostFinance ${state} : à vérifier` : state });
    if (pay) {
      await alertOnce(supabase, att.id, `Lien de paiement à vérifier — ${orderLabel}`, [
        `Commande : ${orderLabel}`, `Transaction PostFinance : ${txId} (${state})`,
        "Le paiement a été enregistré en base mais PostFinance ne l'a pas débité. Vérifier et annuler la ligne à la main.",
      ]);
    }
    return await done("failed");
  }

  // CREATE, PENDING, CONFIRMED, PROCESSING…
  return { status: "pending", orderId: att.order_id };
}

/** Pour le webhook : la tentative liée à une transaction ou à sa référence « MOP-<id> ». */
export async function findAttemptId(supabase: Supa, txId: string, merchantRef: string | null): Promise<string | null> {
  const { data } = await supabase.from("order_payment_attempts").select("id").eq("transaction_id", txId).maybeSingle();
  if (data) return data.id;
  if (merchantRef?.startsWith(PAYMENT_LINK_MERCHANT_PREFIX)) {
    const id = merchantRef.slice(PAYMENT_LINK_MERCHANT_PREFIX.length);
    const { data: byRef } = await supabase.from("order_payment_attempts").select("id, transaction_id").eq("id", id).maybeSingle();
    if (!byRef) return null;
    if (!byRef.transaction_id) await supabase.rpc("payment_attempt_update", { p_attempt_id: id, p_status: "pending", p_tx: txId });
    else if (byRef.transaction_id !== txId) return null;
    return id;
  }
  return null;
}
