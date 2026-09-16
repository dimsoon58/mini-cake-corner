// Shared dark-mode hardening for every BentoCake Studio email — the exact
// technique proven in send-auth-email/index.ts (2026-09-14), extracted here
// so every other template applies it identically instead of re-implementing
// it per file. See send-auth-email/index.ts's own comment for why each
// layer exists:
//   1. `color-scheme`/`supported-color-schemes` meta tags — the primary
//      signal that tells Gmail/Outlook/Apple Mail "this email already
//      handles dark mode, don't auto-invert our colors".
//   2. A `<style>` block with `@media (prefers-color-scheme: dark)`, keyed
//      off classes — reaches Gmail's mobile apps, which (unlike Gmail
//      webmail) honor an embedded <style> in <head>, media queries included.
//   3. Explicit `bgcolor` attributes + inline `background-color` (not the
//      `background` shorthand) on every table/cell that carries a color,
//      plus a `[data-ogsc]` fallback (the attribute Gmail itself stamps on
//      elements it's about to dark-style) — belt-and-suspenders for any
//      client/situation that still tries to remap regardless.
// Purely visual everywhere this is used — content, links, prices and send
// logic are untouched. Every class name is namespaced "bcs-" (customer/
// brand emails) or "bcs-a-" (internal admin/ops emails).

export const DARKMODE_META_TAGS =
  `<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">`;

// Brand palette (bordeaux #78020C / cream #FDF8E1) — every customer-facing
// email: order awaiting-acceptance, order confirmed, order refused, order
// cancellation, workshop booking (pending/confirmed), workshop seat
// cancellation. Same dark-mode swaps as send-auth-email: deeper bordeaux /
// warm dark brown / soft cream — never Gmail's own guess.
export function brandDarkModeStyle(): string {
  return `<style>
  @media (prefers-color-scheme: dark) {
    .bcs-outer, .bcs-spacer { background-color: #3D0208 !important; }
    .bcs-card { background-color: #241209 !important; }
    .bcs-text { color: #F3E9D2 !important; }
    .bcs-label { color: #C9B98A !important; }
    .bcs-title { color: #E2909B !important; }
    .bcs-callout { background-color: #3D2E12 !important; }
    .bcs-row-alt { background-color: #33240F !important; }
    .bcs-accent-bg { background-color: #3D0208 !important; }
    .bcs-accent-text { color: #F3E9D2 !important; }
    .bcs-btn { background-color: #A3141F !important; color: #FDF8E1 !important; }
  }
  [data-ogsc] .bcs-outer, [data-ogsc] .bcs-spacer { background-color: #3D0208 !important; }
  [data-ogsc] .bcs-card { background-color: #241209 !important; }
  [data-ogsc] .bcs-text { color: #F3E9D2 !important; }
  [data-ogsc] .bcs-label { color: #C9B98A !important; }
  [data-ogsc] .bcs-title { color: #E2909B !important; }
  [data-ogsc] .bcs-callout { background-color: #3D2E12 !important; }
  [data-ogsc] .bcs-row-alt { background-color: #33240F !important; }
  [data-ogsc] .bcs-accent-bg { background-color: #3D0208 !important; }
  [data-ogsc] .bcs-accent-text { color: #F3E9D2 !important; }
  [data-ogsc] .bcs-btn { background-color: #A3141F !important; color: #FDF8E1 !important; }
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
