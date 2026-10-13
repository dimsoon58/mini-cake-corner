import { EMAIL_ACCENT_COLOR, EMAIL_BODY_COLOR, EMAIL_FONT_STACK, EMAIL_LABEL_COLOR, EMAIL_SMALL_SIZE } from "./email-styles.ts";

// 2026-10-13 — admin « Envoyer / Renvoyer la confirmation »
// (resend-order-confirmation). Optional extras for the two confirmation
// templates (cake/mixed and workshop). Without them the templates render
// exactly as before (tested byte-for-byte), so the automatic e-mails sent at
// Accept / payment are unchanged.
//
// money: read from the accounting functions (order_confirmation_money,
// built on sales_lines + order_refund_summary) — never recalculated here.
//   total             what remains confirmed (kept lines), or the order total
//   afterCancellation true when an article / seats were cancelled or refused
//   paid / refunded   collected and refunded so far
//   toPay             still to pay (manual order awaiting payment)
//   refundDue         refund still owed to the customer
export interface ConfirmationMoney {
  total: number;
  afterCancellation: boolean;
  paid: number;
  toPay: number;
  refunded: number;
  refundDue: number;
}
export interface ConfirmationOpts {
  paymentDue?: boolean;   // manual order confirmed, to be paid on site (13.10.2026) — the order stays unpaid
  money?: ConfirmationMoney;
}

const chf = (n: number) => (Number(n) || 0).toFixed(2);

/** True when the block below has something to say (otherwise it is not rendered). */
export function showMoneyRows(opts: ConfirmationOpts): boolean {
  const m = opts.money;
  // Paiement sur place sans rien encaissé ni annulé : la phrase sous le titre suffit.
  if (m && opts.paymentDue && !m.afterCancellation && m.paid <= 0 && m.refunded <= 0) return false;
  return !!m && (m.afterCancellation || !!opts.paymentDue || m.toPay > 0 || m.refunded > 0 || m.refundDue > 0);
}

/** Déjà payé / Reste à payer / Remboursé / Remboursement à venir. */
export function moneyRowsHtml(opts: ConfirmationOpts, tr: (en: string, fr: string) => string): string {
  const m = opts.money;
  if (!m || !showMoneyRows(opts)) return "";
  const rows: [string, string, boolean][] = [];
  rows.push([tr("Already paid", "Déjà payé"), `CHF ${chf(m.paid)}`, false]);
  if (m.toPay > 0 || opts.paymentDue) rows.push([tr("Left to pay", "Reste à payer"), `CHF ${chf(m.toPay)}`, true]);
  if (m.refunded > 0) rows.push([tr("Refunded", "Remboursé"), `CHF ${chf(m.refunded)}`, false]);
  if (m.refundDue > 0) rows.push([tr("Refund in progress", "Remboursement à venir"), `CHF ${chf(m.refundDue)}`, true]);
  return `<table role="presentation" style="border-collapse:collapse;width:100%;margin:12px 0 20px;">
${rows.map(([label, value, strong]) => `          <tr style="border-bottom:1px solid ${EMAIL_ACCENT_COLOR};">
            <td class="bcs-label bcs-row-label" style="padding:10px 14px;color:${EMAIL_LABEL_COLOR};font-size:${EMAIL_SMALL_SIZE};font-family:${EMAIL_FONT_STACK};">${label}</td>
            <td class="bcs-text bcs-row-value" style="padding:10px 14px;color:${EMAIL_BODY_COLOR};font-size:${EMAIL_SMALL_SIZE};${strong ? "font-weight:700;" : ""}text-align:right;font-family:${EMAIL_FONT_STACK};">${value}</td>
          </tr>`).join("\n")}
        </table>`;
}

/** Sentence under « Votre commande … est confirmée » when the order is paid on site (wording given by Mel, 13.10.2026). */
export function paymentDueSentence(opts: ConfirmationOpts, tr: (en: string, fr: string) => string): string {
  const toPay = chf(opts.money?.toPay ?? 0);
  return tr(
    `The remaining amount of <strong>${toPay} CHF</strong> is to be paid on site.`,
    `Le montant restant de <strong>${toPay} CHF</strong> sera à régler sur place.`,
  );
}
