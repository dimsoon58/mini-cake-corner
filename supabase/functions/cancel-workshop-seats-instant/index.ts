// Copie de production récupérée le 05.10.2026 (retour-production-F26.zip), identique au code
// déployé sauf « Authentification de Make ». Destinée au seul scénario Make 7425367 ; à supprimer
// le jour de l'arrêt de 7425367.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

// ── Authentification de Make (audit 05.10.2026, v2) ─────────────────────
// Fonction appelée UNIQUEMENT par Make (scénario 7425367). Deux preuves
// seulement, comparées à temps constant à des valeurs gardées côté serveur :
//   1. en-tête « x-make-function-secret » = secret dédié MAKE_FUNCTIONS_SECRET
//      (au moins 32 caractères ; ajouté dans les modules Make lors de la
//      transition coordonnée) ;
//   2. clé service_role EXACTE du projet (Authorization: Bearer … ou apikey)
//      = SUPABASE_SERVICE_ROLE_KEY.
// Tout le reste est refusé (403) avant de lire la requête : clé publique
// (sb_publishable_…, ancienne clé anon), jeton d'une personne connectée,
// clé « sb_secret_… » quelconque, jeton se disant « service_role » mais
// différent de la clé du projet. Le préfixe ou le rôle d'un jeton ne sont
// jamais une preuve. Les journaux indiquent la preuve utilisée, jamais la clé.
function makeSafeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function makeCallerRefusal(req: Request, fn: string): Response | null {
  const dedicated = Deno.env.get("MAKE_FUNCTIONS_SECRET") ?? "";
  const given = req.headers.get("x-make-function-secret") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const apikey = (req.headers.get("apikey") ?? "").trim();
  let via = "refused";
  if (dedicated.length >= 32 && makeSafeEqual(given, dedicated)) via = "dedicated_secret";
  else if (serviceKey && (makeSafeEqual(bearer, serviceKey) || makeSafeEqual(apikey, serviceKey))) via = "service_role_key";
  console.log(`[${fn}] make_auth=${via}`);
  if (via !== "refused") return null;
  return new Response(JSON.stringify({ error: "Caller not allowed", reason: "make_auth" }), {
    status: 403, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const refused = makeCallerRefusal(req, "cancel-workshop-seats-instant");
  if (refused) return refused;

  const adminPin = Deno.env.get("ADMIN_ORDER_PIN") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  if (!adminPin || !supabaseUrl) {
    return json({ error: "Server cancellation configuration is incomplete" }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const upstream = await fetch(`${supabaseUrl}/functions/v1/cancel-workshop-seats`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, pin: adminPin }),
  });

  const upstreamText = await upstream.text();
  let cancellation: Record<string, unknown> | null = null;
  try {
    cancellation = upstreamText ? JSON.parse(upstreamText) : null;
  } catch {
    cancellation = null;
  }

  if (!upstream.ok) {
    return new Response(upstreamText, {
      status: upstream.status,
      headers: { ...corsHeaders, "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
    });
  }

  return json({
    ...(cancellation ?? {}),
    email_notification: {
      success: true,
      delegated_to: "cancel-workshop-seats",
    },
  });
});
