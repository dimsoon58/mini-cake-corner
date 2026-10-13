// Centralised site URL — never hardcoded.
//
// Set the SITE_BASE_URL secret in Supabase (Dashboard → Edge Functions →
// Secrets) before going live:
//   Production : https://bentocakestudio.ch
//   Staging    : https://staging.bentocakestudio.ch
//
// The GitHub Pages fallback is kept so that the test environment (where the
// secret is not yet set) keeps working without any change.
export function getSiteBaseUrl(): string {
  return Deno.env.get("SITE_BASE_URL") ?? "https://bentocakestudio.ch";
}

export function getLogoEmailUrl(): string {
  return `${getSiteBaseUrl()}/logo-red-email.png`;
}
