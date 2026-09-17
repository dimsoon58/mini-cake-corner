// Shared design tokens for every customer-facing email in this codebase —
// the single source of truth for the "one design system" pass (2026-09-19).
// Every template already shares the same outer shell (maroon #78020C
// background, cream #FFF9DB card, Montserrat font, logo, dark-mode
// hardening via email-darkmode.ts) — these constants pin down the specific
// values that had drifted between templates: section-title size (used to
// be small-caps at 11px, now the SAME size as body text, just uppercase +
// bold), and give every file one place to pull the same numbers from
// instead of re-typing them.
//
// Deliberately NOT a set of render functions — every template keeps
// building its own HTML strings (safer, smaller diffs, and inline styles
// stay exactly where email clients need them). This file only fixes the
// NUMBERS so they can never quietly drift apart again.

// Body/row/table text — the one base size used everywhere now (was a mix
// of 13/14/15px across templates).
export const EMAIL_BODY_SIZE = "15px";
// Secondary/small print (footnotes, address lines, disclaimers) — the one
// smaller size used everywhere now (was a mix of 11/12/13px).
export const EMAIL_SMALL_SIZE = "13px";
export const EMAIL_LINE_HEIGHT = "1.7";

export const EMAIL_FONT_STACK = "'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif";

export const EMAIL_BODY_COLOR = "#351E13";
export const EMAIL_LABEL_COLOR = "#7A6540";
export const EMAIL_ACCENT_COLOR = "#78020C";
export const EMAIL_CARD_BG = "#FFF9DB";

// Section titles ("ORDER DETAILS", "PICKUP DETAILS", "WORKSHOP DETAILS", …):
// uppercase + bold, but the SAME size as body text — never a small caption
// and never a big heading. Used as a plain inline-style string wherever a
// template renders one of these labels.
export const EMAIL_SECTION_TITLE_STYLE =
  `color:${EMAIL_ACCENT_COLOR};font-family:${EMAIL_FONT_STACK};font-size:${EMAIL_BODY_SIZE};font-weight:700;letter-spacing:0.06em;text-transform:uppercase;margin:24px 0 8px;`;

// Product/item names ("BENTO CAKE", "DOT CAKES", "WORKSHOP SIGNATURE", …):
// always bold + uppercase, same base size, never a separate "heading" size.
export const EMAIL_PRODUCT_NAME_STYLE =
  `margin:0 0 12px;color:${EMAIL_BODY_COLOR};font-size:${EMAIL_BODY_SIZE};font-weight:700;text-transform:uppercase;`;

// Bordered blocks (item cards, detail tables, summary tables): square
// corners everywhere, same border colour/width, same card background.
export const EMAIL_CARD_STYLE =
  `background-color:${EMAIL_CARD_BG}!important;background-image:linear-gradient(${EMAIL_CARD_BG},${EMAIL_CARD_BG})!important;border:1px solid ${EMAIL_ACCENT_COLOR};border-radius:0;margin:12px 0;`;
