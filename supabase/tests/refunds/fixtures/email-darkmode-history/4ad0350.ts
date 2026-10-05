// Shared LIGHT-ONLY hardening for every BentoCake Studio email — the exact
// technique proven in send-auth-email/index.ts (2026-09-14, revised
// 2026-09-16 to drop the alternate dark palette), extracted here so every
// other template applies it identically instead of re-implementing it per
// file. See send-auth-email/index.ts's own comment for why each layer
// exists:
//   1. `color-scheme`/`supported-color-schemes` meta tags declaring `light`
//      ONLY (no `dark`) — the primary signal that tells Gmail/Outlook/Apple
//      Mail "this email has no dark variant, don't auto-invert our colors".
//   2. A `<style>` block with `@media (prefers-color-scheme: dark)`, keyed
//      off classes — reaches Gmail's mobile apps, which (unlike Gmail
//      webmail) honor an embedded <style> in <head>, including media
//      queries, and can still auto-invert on the meta tag alone. Every rule
//      inside RE-ASSERTS the exact same light-mode color, never an
//      alternate dark one — 2026-09-16: BentoCake Studio emails intentionally
//      stay visually identical in dark mode, there is no dark theme.
//   3. Explicit `bgcolor` attributes + inline `background-color` (not the
//      `background` shorthand) on every table/cell that carries a color,
//      plus a `[data-ogsc]` fallback (the attribute Gmail itself stamps on
//      elements it's about to dark-style) — belt-and-suspenders for any
//      client/situation that still tries to remap regardless.
//   4. 2026-09-16 (Yahoo Mail hardening): a live production test showed
//      Yahoo's own dark-mode engine still force-recolouring the approved
//      #FFF9DB card into khaki/olive despite layers 1-3. Added for customer
//      brand emails only (FORCE_LIGHT_META_TAGS + the `:root` rule + this
//      file's `!important` background-image:linear-gradient(<c>,<c>) on
//      every #FFF9DB/#FFFFFF surface, which forces clients that specifically
//      target flat `background-color` for inversion to treat the element as
//      already-imaged and leave it alone) + `-webkit-text-fill-color`
//      alongside every `color` so a client that only swaps the WebKit fill
//      property can't alter text either. Still the exact same light-mode
//      colors everywhere — never an alternate palette.
// Purely visual everywhere this is used — content, links, prices and send
// logic are untouched. Every class name is namespaced "bcs-" (customer/
// brand emails) or "bcs-a-" (internal admin/ops emails).

export const DARKMODE_META_TAGS =
  `<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">`;

// Stronger force-light variant — customer-facing brand emails only (kept as
// a SEPARATE constant, never changing DARKMODE_META_TAGS itself, so the
// internal admin email and every other non-customer template are untouched
// by this). "light only" is a stricter value than plain "light" that some
// clients honor more aggressively; confirmed necessary 2026-09-16 after a
// live Yahoo Mail test showed Yahoo's dark-mode engine still force-
// recolouring the approved #FFF9DB card into a muddy khaki/olive despite the
// existing "light" signal + media-query/[data-ogsc] reassertion below.
export const FORCE_LIGHT_META_TAGS =
  `<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">`;

// Brand palette (bordeaux #78020C / light butter-yellow #FFF9DB) — every customer-facing
// email: order awaiting-acceptance, order confirmed, order refused, order
// cancellation, workshop booking (pending/confirmed), workshop seat
// cancellation. 2026-09-16: every "dark mode" rule below re-asserts the
// exact same light-mode color already used inline by these templates — kept
// as a style block (not removed) only because Gmail's mobile apps need one
// present to fully suppress their own auto-invert; there is no alternate
// dark palette.
export function brandDarkModeStyle(): string {
  return `<style>
  :root { color-scheme: light only !important; supported-color-schemes: light !important; }
  @media (prefers-color-scheme: dark) {
    .bcs-outer, .bcs-spacer { background-color: #78020C !important; }
    .bcs-card { background-color: #FFF9DB !important; background-image: linear-gradient(#FFF9DB,#FFF9DB) !important; }
    .bcs-text { color: #351E13 !important; -webkit-text-fill-color: #351E13 !important; }
    .bcs-label { color: #7A6540 !important; -webkit-text-fill-color: #7A6540 !important; }
    .bcs-title { color: #78020C !important; -webkit-text-fill-color: #78020C !important; }
    .bcs-callout { background-color: #FFFFFF !important; background-image: linear-gradient(#FFFFFF,#FFFFFF) !important; }
    .bcs-row-alt { background-color: #FFF9DB !important; background-image: linear-gradient(#FFF9DB,#FFF9DB) !important; }
    .bcs-accent-bg { background-color: #78020C !important; }
    .bcs-accent-text { color: #FFF9DB !important; -webkit-text-fill-color: #FFF9DB !important; }
    .bcs-btn { background-color: #78020C !important; color: #FFF9DB !important; -webkit-text-fill-color: #FFF9DB !important; }
  }
  [data-ogsc] .bcs-outer, [data-ogsc] .bcs-spacer { background-color: #78020C !important; }
  [data-ogsc] .bcs-card { background-color: #FFF9DB !important; background-image: linear-gradient(#FFF9DB,#FFF9DB) !important; }
  [data-ogsc] .bcs-text { color: #351E13 !important; -webkit-text-fill-color: #351E13 !important; }
  [data-ogsc] .bcs-label { color: #7A6540 !important; -webkit-text-fill-color: #7A6540 !important; }
  [data-ogsc] .bcs-title { color: #78020C !important; -webkit-text-fill-color: #78020C !important; }
  [data-ogsc] .bcs-callout { background-color: #FFFFFF !important; background-image: linear-gradient(#FFFFFF,#FFFFFF) !important; }
  [data-ogsc] .bcs-row-alt { background-color: #FFF9DB !important; background-image: linear-gradient(#FFF9DB,#FFF9DB) !important; }
  [data-ogsc] .bcs-accent-bg { background-color: #78020C !important; }
  [data-ogsc] .bcs-accent-text { color: #FFF9DB !important; -webkit-text-fill-color: #FFF9DB !important; }
  [data-ogsc] .bcs-btn { background-color: #78020C !important; color: #FFF9DB !important; -webkit-text-fill-color: #FFF9DB !important; }
</style>`;
}

// Internal/admin palette — notify-order, send-contact-request, admin-alert.
// These already use a plain white/grey palette, never the bordeaux/cream
// brand: dark mode simply PINS every existing color instead of adopting a
// separate dark theme of its own, so Gmail/Apple Mail never auto-recolors
// them either. Includes the light callout backgrounds (blue/green/yellow)
// and the Accept/Decline action buttons used in the admin order-notification
// email; unused classes in a given template are harmless no-ops.
export function adminDarkModeStyle(): string {
  return `<style>
  @media (prefers-color-scheme: dark) {
    .bcs-a-bg { background-color: #f4f4f4 !important; }
    .bcs-a-card { background-color: #ffffff !important; }
    .bcs-a-item { background-color: #fafafa !important; }
    .bcs-a-text { color: #333333 !important; }
    .bcs-a-muted { color: #888888 !important; }
    .bcs-a-callout-blue { background-color: #f0f7ff !important; }
    .bcs-a-callout-green { background-color: #f0fff4 !important; }
    .bcs-a-callout-yellow { background-color: #fffbeb !important; }
    .bcs-a-btn-accept { background-color: #16a34a !important; color: #ffffff !important; }
    .bcs-a-btn-decline { background-color: #dc2626 !important; color: #ffffff !important; }
    .bcs-a-header-bg { background: linear-gradient(135deg,#1a1a1a,#333) !important; }
    .bcs-a-header-text { color: #ffffff !important; }
    .bcs-a-header-muted { color: #cccccc !important; }
    .bcs-a-danger { color: #b91c1c !important; }
  }
  [data-ogsc] .bcs-a-bg { background-color: #f4f4f4 !important; }
  [data-ogsc] .bcs-a-card { background-color: #ffffff !important; }
  [data-ogsc] .bcs-a-item { background-color: #fafafa !important; }
  [data-ogsc] .bcs-a-text { color: #333333 !important; }
  [data-ogsc] .bcs-a-muted { color: #888888 !important; }
  [data-ogsc] .bcs-a-callout-blue { background-color: #f0f7ff !important; }
  [data-ogsc] .bcs-a-callout-green { background-color: #f0fff4 !important; }
  [data-ogsc] .bcs-a-callout-yellow { background-color: #fffbeb !important; }
  [data-ogsc] .bcs-a-btn-accept { background-color: #16a34a !important; color: #ffffff !important; }
  [data-ogsc] .bcs-a-btn-decline { background-color: #dc2626 !important; color: #ffffff !important; }
  [data-ogsc] .bcs-a-header-bg { background: linear-gradient(135deg,#1a1a1a,#333) !important; }
  [data-ogsc] .bcs-a-header-text { color: #ffffff !important; }
  [data-ogsc] .bcs-a-header-muted { color: #cccccc !important; }
  [data-ogsc] .bcs-a-danger { color: #b91c1c !important; }
</style>`;
}
