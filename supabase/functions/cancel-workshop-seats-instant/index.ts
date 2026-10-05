// Copie de production récupérée le 05.10.2026 (retour-production-F26.zip), identique au code
// déployé sauf la « Garde d'appelant ». Destinée au seul scénario Make 7425367 ; à supprimer
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

// ── Garde d'appelant (audit 05.10.2026) ─────────────────────────────────
// Fonction appelée UNIQUEMENT par Make (scénario 7425367). « Verify JWT » doit
// rester ACTIVÉ : la passerelle Supabase a donc déjà vérifié la signature du
// jeton, et on peut lire son rôle sans le revérifier.
//   - « authenticated » (un client ou une admin connectés au site) : REFUSÉ —
//     l'admin passe par cancel-order-item / cancel-workshop-seats, jamais ici ;
//   - « service_role » (ou clé secrète sb_secret_) : accepté ;
//   - « anon » (ancienne clé anon) : accepté tant que MAKE_CALLER_STRICT n'est
//     pas « true », pour ne pas casser Make avant d'avoir confirmé, dans les
//     journaux, la clé utilisée par sa connexion. Chaque appel journalise le
//     rôle (jamais la clé).
function callerRole(req: Request): string {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const token = bearer || (req.headers.get("apikey") ?? "").trim();
  if (!token) return "none";
  if (token.startsWith("sb_secret_")) return "service_role";
  if (token.startsWith("sb_publishable_")) return "anon";
  const part = token.split(".")[1];
  if (!part) return "unknown";
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")));
    return typeof payload?.role === "string" ? payload.role : "unknown";
  } catch {
    return "unknown";
  }
}
function callerRefusal(req: Request, fn: string): Response | null {
  const role = callerRole(req);
  const strict = (Deno.env.get("MAKE_CALLER_STRICT") ?? "") === "true";
  const allowed = role === "service_role" || (!strict && role === "anon");
  console.log(`[${fn}] caller_role=${role} strict=${strict} allowed=${allowed}`);
  if (allowed) return null;
  return new Response(JSON.stringify({ error: "Caller not allowed", reason: "caller_role" }), {
    status: 403, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const refused = callerRefusal(req, "cancel-workshop-seats-instant");
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
