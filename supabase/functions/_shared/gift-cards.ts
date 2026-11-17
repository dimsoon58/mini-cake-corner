// F37 (03.11.2026) — Bons cadeaux: everything shared by
// create-gift-card-payment, confirm-gift-card-payment and postfinance-webhook.
//
// A voucher is paid with immediate capture, COMPLETE_IMMEDIATELY (unlike orders, which are only
// authorised until an administrator accepts them): no decision is needed
// to sell a voucher. finalizeGiftCard() is idempotent and safe to run
// concurrently (webhook + the thank-you page poll):
//   1. reads the REAL transaction state from PostFinance (never the webhook's);
//   2. COMPLETED / FULFILL → activates the voucher once (status pending →
//      active, guarded update), with a fresh unique code, balance = amount,
//      valid 12 months;
//      FAILED / DECLINE / VOIDED → status failed;
//   3. active → sends the buyer's email (PDF voucher attached) once, under an
//      email claim + a Resend idempotency key, then a short note to the team.

import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import { getPostFinanceCredentials } from "./postfinance.ts";
import { getTransactionState } from "./postfinance-transactions.ts";
import { getLogoEmailUrl, getSiteBaseUrl } from "./site-config.ts";
import { FORCE_LIGHT_META_TAGS, brandDarkModeStyle } from "./email-darkmode.ts";
import { sendTechnicalAlert, alertTime } from "./admin-alert.ts";

export const GIFT_CARD_MIN = 20;
export const GIFT_CARD_MAX = 500;
export const GIFT_CARD_VALIDITY_MONTHS = 12;
export const GIFT_MERCHANT_PREFIX = "GIFT-";
const FROM = "Bento Cake Studio <contact@bentocakestudio.ch>";
const TEAM_EMAILS = ["naglemelodie@gmail.com", "e.potapushina@gmail.com"];
const STUDIO_ADDRESS = "Rue Prévost-Martin 8, 1205 Genève";
// A stalled « sending » claim (function killed mid-send) may be retried after this.
const EMAIL_CLAIM_STALE_MS = 10 * 60 * 1000;

// No I, O, 0 or 1: nothing to confuse when the code is typed from a printout.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateGiftCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return `BCS-${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

// deno-lint-ignore no-explicit-any
export type GiftCardRow = Record<string, any>;

export type FinalizeResult = { status: "active" | "pending" | "failed" | "disabled" | "not_found"; emailSent: boolean };

const fmtAmount = (n: number) => (Number.isInteger(n) ? `CHF ${n}.-` : `CHF ${n.toFixed(2)}`);

/** jj.mm.aaaa, Geneva day. */
export function formatSwissDate(iso: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.day}.${p.month}.${p.year}`;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Helvetica (WinAnsi) can't draw emoji or most non-Latin characters: they
// would make pdf-lib throw. Keep Latin-1 and the usual typographic marks.
const PDF_EXTRA = new Set(["’", "‘", "“", "”", "–", "—", "…", "€", "œ", "Œ"]);
function pdfSafe(text: string): string {
  return Array.from(text.normalize("NFC")).filter((ch) => {
    const c = ch.codePointAt(0) ?? 0;
    return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || PDF_EXTRA.has(ch);
  }).join("").replace(/\s+/g, " ").trim();
}


// F40 (03.11.2026) — two kinds of voucher: « amount » (whole site) and
// « workshop » (bought for a workshop type and a number of places, usable
// on ANY workshop, workshops only). Labels shared by the PDF and the emails.
export const WORKSHOP_VOUCHER_LABELS: Record<string, { fr: string; en: string }> = {
  signature: { fr: "Signature", en: "Signature" },
  piping: { fr: "Pochage", en: "Piping" },
  paint: { fr: "Paint", en: "Paint" },
};
export function voucherWhat(card: GiftCardRow, lang: "fr" | "en"): string {
  if (card.kind === "workshop" && card.workshop_type) {
    const name = WORKSHOP_VOUCHER_LABELS[card.workshop_type]?.[lang] ?? card.workshop_type;
    const n = Number(card.workshop_places) || 1;
    return lang === "fr" ? `${name}, ${n} place${n > 1 ? "s" : ""}` : `${name}, ${n} spot${n > 1 ? "s" : ""}`;
  }
  return fmtAmount(Number(card.initial_amount));
}

/**
 * The printable voucher, base64 for a Resend attachment. Drawn like Mel's
 * design (03.11.2026): burgundy background, double cream frame, cream logo,
 * « GIFT VOUCHER / A SWEET EXPERIENCE AWAITS YOU! », three script lines
 * filled in (workshop or amount, valid until, code). French or English.
 * Fonts and logo are read from the site (public/voucher/); if they can't be
 * fetched, Helvetica is used so a voucher is never left unsent.
 */
export async function generateGiftCardPdf(card: GiftCardRow): Promise<string> {
  const lang: "fr" | "en" = card.lang === "en" ? "en" : "fr";
  const fr = lang === "fr";
  const tr = (en: string, f: string) => (fr ? f : en);
  const W = 842, H = 473.6; // 16:9, the shape of the design (1920 × 1080)
  const k = W / 1920;
  const X = (x: number) => x * k;
  const Y = (yFromTop: number) => H - yFromTop * k;

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const site = getSiteBaseUrl();
  const fetchBytes = async (path: string) => {
    try {
      const r = await fetch(`${site}/voucher/${path}`);
      return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
    } catch {
      return null;
    }
  };
  const [boldBytes, semiBytes, scriptBytes, logoBytes] = await Promise.all([
    fetchBytes("Montserrat-Bold.ttf"), fetchBytes("Montserrat-SemiBold.ttf"), fetchBytes("PinyonScript-Regular.ttf"), fetchBytes("logo-cream.png"),
  ]);
  const bold = boldBytes ? await pdf.embedFont(boldBytes, { subset: true }) : await pdf.embedFont(StandardFonts.HelveticaBold);
  const semi = semiBytes ? await pdf.embedFont(semiBytes, { subset: true }) : await pdf.embedFont(StandardFonts.Helvetica);
  const script = scriptBytes ? await pdf.embedFont(scriptBytes, { subset: true }) : await pdf.embedFont(StandardFonts.HelveticaOblique);

  const maroon = rgb(0.471, 0.027, 0.055);
  const cream = rgb(1, 0.976, 0.859);
  const page = pdf.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: maroon });
  page.drawRectangle({ x: X(108), y: Y(972), width: X(1704), height: X(864), borderColor: cream, borderWidth: X(10) });
  page.drawRectangle({ x: X(152), y: Y(940), width: X(1616), height: X(784), borderColor: cream, borderWidth: X(4) });

  type F = typeof bold;
  const center = (text: string, yTop: number, font: F, size: number) => {
    const t = pdfSafe(text);
    const sz = size * k;
    page.drawText(t, { x: (W - font.widthOfTextAtSize(t, sz)) / 2, y: Y(yTop), size: sz, font, color: cream });
  };

  if (logoBytes) {
    const logo = await pdf.embedPng(logoBytes);
    const w = X(285), h = (logo.height / logo.width) * w;
    page.drawImage(logo, { x: (W - w) / 2, y: Y(198) - h, width: w, height: h });
  } else {
    center("BENTO CAKE STUDIO", 250, bold, 44);
  }

  center(tr("GIFT VOUCHER", "BON CADEAU"), 410, bold, 74);
  center(tr("A SWEET EXPERIENCE AWAITS YOU!", "UNE DOUCE EXPÉRIENCE VOUS ATTEND !"), 476, bold, 38);
  center(tr("Enjoy a creative moment at Bento Cake Studio.", "Profitez d’un moment créatif chez Bento Cake Studio."), 580, bold, 34);

  // For whom + the buyer's few words, on one line when given.
  const forLine = [card.recipient_name ? `${tr("For", "Pour")} ${card.recipient_name}` : null, card.message ? pdfSafe(String(card.message)) : null]
    .filter(Boolean).join(" · ");
  let linesTop = 700;
  if (forLine) {
    let t = forLine;
    while (semi.widthOfTextAtSize(t, 24 * k) > X(1400) && t.length > 10) t = `${t.slice(0, -2).trimEnd()}…`;
    center(t, 636, semi, 24);
    linesTop = 712;
  }

  // Three script lines: label in script, value written on the line.
  const rows: [string, string][] = [
    [card.kind === "workshop" ? tr("Workshop:", "Workshop :") : tr("Amount:", "Montant :"), voucherWhat(card, lang)],
    [tr("Valid until:", "Valable jusqu’au :"), formatSwissDate(card.expires_at)],
    [tr("Voucher code:", "Code du bon :"), String(card.code)],
  ];
  const labelSize = 54 * k, valueSize = 30 * k, lineEnd = X(1290), gap = 68;
  const labelsW = Math.max(...rows.map(([l]) => script.widthOfTextAtSize(pdfSafe(l), labelSize)));
  const left = (W - (labelsW + X(18) + X(380))) / 2;
  rows.forEach(([label, value], i) => {
    const yTop = linesTop + i * gap;
    const l = pdfSafe(label);
    page.drawText(l, { x: left + labelsW - script.widthOfTextAtSize(l, labelSize), y: Y(yTop), size: labelSize, font: script, color: cream });
    const vx = left + labelsW + X(18);
    page.drawLine({ start: { x: vx, y: Y(yTop) - X(6) }, end: { x: Math.max(lineEnd, vx + X(380)), y: Y(yTop) - X(6) }, thickness: X(2.5), color: cream });
    page.drawText(pdfSafe(value), { x: vx + X(10), y: Y(yTop) + X(4), size: valueSize, font: i === 2 ? bold : semi, color: cream });
  });

  center(card.kind === "workshop"
    ? tr(`Value ${fmtAmount(Number(card.initial_amount))} · on the workshop of your choice at bentocakestudio.ch · not refundable`,
         `Valeur ${fmtAmount(Number(card.initial_amount))} · sur le workshop de votre choix sur bentocakestudio.ch · non remboursable`)
    : tr("To use on the whole site at bentocakestudio.ch · enter the code in the cart · not refundable",
         "À utiliser sur tout le site bentocakestudio.ch · code à saisir dans le panier · non remboursable"),
    912, semi, 17);

  const bytes = await pdf.save();
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function renderGiftCardEmail(card: GiftCardRow): { subject: string; html: string } {
  const fr = card.lang !== "en";
  const tr = (en: string, f: string) => (fr ? f : en);
  const amount = fmtAmount(Number(card.initial_amount));
  const firstName = escapeHtml(String(card.buyer_name).trim().split(/\s+/)[0] ?? "");
  const recipient = card.recipient_name ? escapeHtml(String(card.recipient_name)) : null;
  const site = getSiteBaseUrl();
  const workshop = card.kind === "workshop";
  const what = voucherWhat(card, fr ? "fr" : "en");
  const subject = workshop
    ? tr(`Your Bento Cake Studio workshop gift card: ${what}`, `Votre bon cadeau workshop Bento Cake Studio : ${what}`)
    : tr(`Your Bento Cake Studio gift card of ${amount}`, `Votre bon cadeau Bento Cake Studio de ${amount}`);
  const p = (inner: string, extra = "") => `<p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 12px;${extra}">${inner}</p>`;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${FORCE_LIGHT_META_TAGS}<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
${brandDarkModeStyle()}
</head>
<body style="margin:0;padding:0;background-color:#78020C!important;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#78020C" class="bcs-outer" style="background-color:#78020C!important;background-image:linear-gradient(#78020C,#78020C)!important;">
  <tr><td align="center" style="padding:0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;margin:0 auto;">
  <tr><td style="padding:0 20px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFF9DB" class="bcs-card" style="background-color:#FFF9DB!important;background-image:linear-gradient(#FFF9DB,#FFF9DB)!important;">
  <tr><td>
      <div class="bcs-content-pad" style="padding:36px 40px 0;text-align:center;">
        <img class="bcs-logo" src="${getLogoEmailUrl()}" alt="Bento Cake Studio" style="width:240px;height:auto;display:block;margin:0 auto 28px;" />
      </div>
      <div class="bcs-text bcs-content-pad" style="padding:0 40px 36px;">
        ${p(`${tr("Hello", "Bonjour")} ${firstName},`)}
        ${p(card.source === "manual"
          ? tr("Here is your Bento Cake Studio gift card 🤍", "Voici votre bon cadeau Bento Cake Studio 🤍")
          : tr("Thank you for your purchase! Here is your Bento Cake Studio gift card 🤍", "Merci pour votre achat ! Voici votre bon cadeau Bento Cake Studio 🤍"))}
        ${p(tr("You will find it attached as a PDF, ready to print or forward.", "Vous le trouverez en pièce jointe (PDF), prêt à imprimer ou à transmettre."), "margin-bottom:20px;")}
        <div class="bcs-callout" style="border:2px solid #78020C;background-color:#FFFFFF!important;background-image:linear-gradient(#FFFFFF,#FFFFFF)!important;padding:20px 18px;margin:0 0 20px;text-align:center;">
          <p style="color:#7A6540;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;margin:0 0 6px;">${tr("Gift card", "Bon cadeau")}${recipient ? ` ${tr("for", "pour")} ${recipient}` : ""}</p>
          <p style="color:#78020C;font-size:28px;font-weight:700;margin:0 0 10px;">${workshop ? `Workshop ${escapeHtml(what)}` : amount}</p>
          ${workshop ? `<p style="color:#351E13;font-size:13px;margin:0 0 10px;">${tr("Value", "Valeur")} ${amount}, ${tr("on the workshop of your choice", "sur le workshop de votre choix")}</p>` : ""}
          <p style="color:#78020C;font-size:20px;font-weight:700;letter-spacing:0.08em;margin:0 0 8px;">${escapeHtml(String(card.code))}</p>
          <p style="color:#351E13;font-size:13px;margin:0;">${tr("Valid until", "Valable jusqu'au")} <strong>${formatSwissDate(card.expires_at)}</strong></p>
        </div>
        ${p(workshop
          ? tr(
            `To use it, book the workshop of your choice on <a href="${site}/workshop" style="color:#78020C;">bentocakestudio.ch</a> (Signature, Piping or Paint) and enter the code in the « Promo code » field of the cart. It can only be used on workshops; if the workshop costs more, the difference is paid by card, and any remaining balance stays on the code until it expires.`,
            `Pour l'utiliser, réservez le workshop de votre choix sur <a href="${site}/workshop" style="color:#78020C;">bentocakestudio.ch</a> (Signature, Pochage ou Paint) et saisissez le code dans le champ « Code promo » du panier. Il est valable uniquement sur les workshops ; si le workshop coûte plus, la différence se paie par carte, et le solde éventuel reste sur le code jusqu'à son expiration.`,
          )
          : tr(
          `To use it, choose a cake or a workshop on <a href="${site}" style="color:#78020C;">bentocakestudio.ch</a> and enter the code in the « Promo code » field of the cart. It can be used on the whole site; any remaining balance stays on the code until it expires.`,
          `Pour l'utiliser, choisissez un gâteau ou un workshop sur <a href="${site}" style="color:#78020C;">bentocakestudio.ch</a> et saisissez le code dans le champ « Code promo » du panier. Il est valable sur tout le site ; le solde éventuel reste sur le code jusqu'à son expiration.`,
        ))}
        <p style="color:#351E13;font-size:13px;line-height:1.7;margin:20px 0 0;border-top:1px solid #78020C;padding-top:16px;">
          ${tr(
            "Valid 12 months from the purchase date. Not refundable and not exchangeable for cash. Keep this email: the code is all you need.",
            "Valable 12 mois à partir de la date d'achat. Non remboursable et non échangeable contre des espèces. Gardez cet email : le code suffit pour utiliser le bon.",
          )}
        </p>
        ${p(`${tr("See you soon,", "À très bientôt,")}<br><strong>Bento Cake Studio</strong> 🤍`, "margin-top:24px;")}
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
  return { subject, html };
}

// deno-lint-ignore no-explicit-any
async function activate(supabase: any, card: GiftCardRow): Promise<GiftCardRow | null> {
  const paidAt = new Date();
  const expires = new Date(paidAt);
  expires.setMonth(expires.getMonth() + GIFT_CARD_VALIDITY_MONTHS);
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase.from("gift_cards")
      .update({
        status: "active", code: generateGiftCode(), balance: card.initial_amount,
        paid_at: paidAt.toISOString(), expires_at: expires.toISOString(), updated_at: paidAt.toISOString(),
      })
      .eq("id", card.id).eq("status", "pending")
      .select("*").maybeSingle();
    if (!error) {
      if (data) return data;
      // Someone else activated it (or it is no longer pending): re-read.
      const { data: fresh } = await supabase.from("gift_cards").select("*").eq("id", card.id).maybeSingle();
      return fresh ?? null;
    }
    // 23505 = the random code already exists: draw another one.
    if ((error as { code?: string }).code !== "23505") throw new Error(`Gift card activation failed: ${error.message}`);
  }
  throw new Error("Gift card activation failed: no free code after 5 attempts");
}

// deno-lint-ignore no-explicit-any
async function sendVoucherEmail(card: GiftCardRow, idempotencyKey: string): Promise<void> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) throw new Error("RESEND_API_KEY not configured");
  if (!card.buyer_email) throw new Error("Pas d'adresse email pour ce bon");
  const { subject, html } = renderGiftCardEmail(card);
  const pdf = await generateGiftCardPdf(card);
  const fr = card.lang !== "en";
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({
      from: FROM, to: [card.buyer_email], subject, html,
      attachments: [{ filename: `${fr ? "Bon-cadeau" : "Gift-card"}_${card.code}.pdf`, content: pdf }],
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`Resend ${resp.status}: ${data?.message ?? JSON.stringify(data).slice(0, 300)}`);
}

/** Admin « Renvoyer l'email » (F39): sends again, whatever was sent before. */
// deno-lint-ignore no-explicit-any
export async function resendGiftCardEmail(supabase: any, card: GiftCardRow): Promise<void> {
  await sendVoucherEmail(card, `gift-card-${card.id}-resend-${Date.now()}`);
  await supabase.from("gift_cards").update({ email_status: "sent", email_sent_at: new Date().toISOString(), email_error: null }).eq("id", card.id);
}

// deno-lint-ignore no-explicit-any
export async function sendEmailOnce(supabase: any, card: GiftCardRow, opts: { notifyTeam?: boolean } = {}): Promise<boolean> {
  if (card.email_status === "sent") return true;
  const staleBefore = new Date(Date.now() - EMAIL_CLAIM_STALE_MS).toISOString();
  const { data: claimed } = await supabase.from("gift_cards")
    .update({ email_status: "sending", email_claimed_at: new Date().toISOString(), email_attempts: Number(card.email_attempts ?? 0) + 1 })
    .eq("id", card.id).eq("status", "active")
    .or(`email_status.in.(pending,error),and(email_status.eq.sending,email_claimed_at.lt.${staleBefore})`)
    .select("*").maybeSingle();
  if (!claimed) return false; // already sent, or being sent right now

  try {
    await sendVoucherEmail(claimed, `gift-card-${claimed.id}`);
    await supabase.from("gift_cards").update({ email_status: "sent", email_sent_at: new Date().toISOString(), email_error: null }).eq("id", claimed.id);
    if (opts.notifyTeam !== false) await notifyTeam(claimed);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`gift card ${claimed.id}: email failed:`, msg);
    await supabase.from("gift_cards").update({ email_status: "error", email_error: msg.slice(0, 500) }).eq("id", claimed.id);
    await sendTechnicalAlert({
      subject: `Bon cadeau payé mais email non envoyé : ${claimed.code}`,
      lines: [`Code : ${claimed.code}`, `Montant : ${fmtAmount(Number(claimed.initial_amount))}`, `Acheteur : ${escapeHtml(claimed.buyer_email)}`, `Heure : ${alertTime()}`, `Erreur : ${escapeHtml(msg)}`],
    });
    return false;
  }
}

async function notifyTeam(card: GiftCardRow): Promise<void> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return;
  const rows = [
    ["Montant", fmtAmount(Number(card.initial_amount))],
    ...(card.kind === "workshop" ? [["Workshop", voucherWhat(card, "fr")]] : []),
    ["Code", String(card.code)],
    ["Acheteur", `${card.buyer_name}, ${card.buyer_email}`],
    ["Pour", card.recipient_name ?? "pas indiqué"],
    ["Valable jusqu'au", formatSwissDate(card.expires_at)],
  ].map(([k, v]) => `<tr><td style="padding:4px 12px;color:#7A6540;font-size:13px;">${k}</td><td style="padding:4px 12px;color:#351E13;font-size:14px;font-weight:600;">${escapeHtml(String(v))}</td></tr>`).join("");
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": `gift-card-team-${card.id}` },
      body: JSON.stringify({
        from: FROM, to: TEAM_EMAILS,
        subject: `🎁 Bon cadeau vendu : ${fmtAmount(Number(card.initial_amount))}`,
        html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Helvetica,Arial,sans-serif;"><h2 style="color:#78020C;font-size:18px;">Bon cadeau vendu</h2><table style="border-collapse:collapse;">${rows}</table></body></html>`,
      }),
    });
  } catch (e) {
    console.error("gift card team notification failed:", e);
  }
}

/** Idempotent: brings a voucher to its final state and sends its email once. */
// deno-lint-ignore no-explicit-any
export async function finalizeGiftCard(supabase: any, id: string): Promise<FinalizeResult> {
  const { data: row, error } = await supabase.from("gift_cards").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Failed to load gift card: ${error.message}`);
  if (!row) return { status: "not_found", emailSent: false };
  let card: GiftCardRow = row;

  if (card.status === "pending") {
    if (!card.postfinance_transaction_id) return { status: "pending", emailSent: false };
    const state = String(await getTransactionState(getPostFinanceCredentials(), card.postfinance_transaction_id) ?? "").toUpperCase();
    if (state === "COMPLETED" || state === "FULFILL") {
      card = (await activate(supabase, card)) ?? card;
    } else if (state === "FAILED" || state === "DECLINE" || state === "VOIDED") {
      await supabase.from("gift_cards").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "pending");
      return { status: "failed", emailSent: false };
    } else {
      // AUTHORIZED (capture in progress), PROCESSING, CONFIRMED… → not yet.
      return { status: "pending", emailSent: false };
    }
  }

  if (card.status !== "active") return { status: card.status, emailSent: false };
  const emailSent = await sendEmailOnce(supabase, card);
  return { status: "active", emailSent: emailSent || card.email_status === "sent" };
}
