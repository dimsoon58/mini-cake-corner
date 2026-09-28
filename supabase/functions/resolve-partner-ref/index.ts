import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_ORIGINS = new Set([
  "https://bentocakestudio.ch",
  "https://www.bentocakestudio.ch",
  "https://dimsoon58.github.io",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://bentocakestudio.ch";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ valid: false }), { status: 405, headers });
  }

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return new Response(JSON.stringify({ valid: false }), { status: 403, headers });
  }

  let token = "";
  try {
    const body = await req.json();
    token = typeof body?.token === "string" ? body.token.trim() : "";
  } catch {
    return new Response(JSON.stringify({ valid: false }), { status: 400, headers });
  }

  if (!UUID_RE.test(token)) {
    return new Response(JSON.stringify({ valid: false }), { status: 200, headers });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing Supabase server environment variables");
    return new Response(JSON.stringify({ valid: false }), { status: 500, headers });
  }

  const query = new URL(`${supabaseUrl}/rest/v1/partners`);
  query.searchParams.set("referral_token", `eq.${token}`);
  query.searchParams.set("active", "eq.true");
  query.searchParams.set("select", "name,customer_discount_rate");
  query.searchParams.set("limit", "1");

  try {
    const response = await fetch(query.toString(), {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });

    if (!response.ok) {
      console.error("Partner lookup failed", response.status, await response.text());
      return new Response(JSON.stringify({ valid: false }), { status: 500, headers });
    }

    const rows = await response.json();
    const partner = Array.isArray(rows) ? rows[0] : null;

    if (!partner) {
      return new Response(JSON.stringify({ valid: false }), { status: 200, headers });
    }

    return new Response(JSON.stringify({
      valid: true,
      partner: {
        name: partner.name,
        discountRate: Number(partner.customer_discount_rate),
      },
    }), { status: 200, headers });
  } catch (error) {
    console.error("Partner lookup error", error);
    return new Response(JSON.stringify({ valid: false }), { status: 500, headers });
  }
});
