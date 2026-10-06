// Références PostFinance d'une commande du site (affichées dans la fiche
// commande, comme dans Notion) : la référence de paiement « PAY-AAMMJJNN »
// (merchant reference, celle qu'on cherche dans le back-office PostFinance)
// et le numéro de transaction PostFinance. Une commande payée entièrement
// par la cagnotte n'a aucune transaction (identifiant « REWARD_ONLY »).

export interface PaymentRefs {
  reference: string | null;
  transactionId: string | null;
  rewardOnly: boolean;
}

const clean = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "") || null;

export function paymentRefs(order: { payment_reference?: unknown; postfinance_transaction_id?: unknown }): PaymentRefs {
  const tx = clean(order.postfinance_transaction_id);
  const rewardOnly = tx === "REWARD_ONLY";
  return { reference: clean(order.payment_reference), transactionId: rewardOnly ? null : tx, rewardOnly };
}
