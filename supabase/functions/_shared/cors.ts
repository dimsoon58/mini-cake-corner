// Dynamic CORS helper — restricts browser-initiated cross-origin requests to
// known origins instead of using the wildcard "*".
//
// Why dynamic: CORS restricts browser requests only, not server-to-server
// calls. The real protection for Edge Functions is the Supabase `apikey`
// header (anon key) and JWT auth — CORS is defence-in-depth. A wildcard
// would still require valid auth, but it allows any site to make authed
// requests on behalf of a logged-in user via the browser. Restricting to
// known origins prevents that.
//
// ALLOWED_ORIGINS includes:
//  - The production domain (reads from SITE_BASE_URL env var at call time)
//  - The current GitHub Pages preview (kept until the domain is live)
//  - localhost for local development
//
// The webhook function (postfinance-webhook) uses its own static corsHeaders
// because PostFinance calls it server-to-server — CORS is irrelevant there.

const STATIC_ALLOWED = new Set([
  "https://dimsoon58.github.io",  // GitHub Pages preview — remove after domain migration
  "http://localhost:8080",
  "http://localhost:5173",
  "http://localhost:3000",
]);

function getAllowedOrigins(): Set<string> {
  const origins = new Set(STATIC_ALLOWED);
  const siteUrl = Deno.env.get("SITE_BASE_URL");
  if (siteUrl) {
    try { origins.add(new URL(siteUrl).origin); } catch { /* ignore bad value */ }
  }
  return origins;
}

const CORS_HEADERS_BASE = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Returns CORS headers for the given request. */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = getAllowedOrigins();
  // Allow when origin is in our list, or when there is no Origin header
  // (server-to-server call — CORS doesn't apply).
  const allowOrigin = !origin || allowed.has(origin) ? (origin || "*") : "null";
  return { ...CORS_HEADERS_BASE, "Access-Control-Allow-Origin": allowOrigin };
}

/** Shortcut for OPTIONS preflight response. */
export function handleOptions(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { headers: corsHeaders(req) });
}
