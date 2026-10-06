import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin, safeEqual, sha256Hex } from "../_shared/admin-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Admin > PIN once per session (F16). The admin signs in as today (Supabase
// Auth, email allow-list); then:
//   { action: "unlock", pin }  → checks ADMIN_ORDER_PIN (constant time,
//                                 5 failures / 15 min → locked 15 min) and
//                                 returns a random token + its expiry. Only
//                                 the token's SHA-256 is stored, bound to
//                                 the email and the Supabase session.
//   { action: "status" }       → is the token sent (_adminSession) still
//                                 valid for this session?
//   { action: "lock" }         → revokes it (sign-out).
// The PIN itself is never stored nor returned.

const MAX_FAILURES = 5;
const WINDOW_MINUTES = 15;

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(cors, { error: "Method not allowed" }, 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
    const admin = await requireAdmin(req, supabase, { allowWithoutPinSession: true });
    if (!admin) return json(cors, { error: "Admin sign-in required", reason: "auth" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");

    if (action === "status") {
      return json(cors, { data: { active: admin.pinSession, expiresAt: admin.pinExpiresAt } });
    }

    if (action === "lock") {
      const token = typeof body?._adminSession === "string" ? body._adminSession : null;
      if (token) await supabase.rpc("admin_pin_revoke", { p_email: admin.email, p_token_hash: await sha256Hex(token), p_reason: "déconnexion" });
      return json(cors, { data: { active: false } });
    }

    if (action === "unlock") {
      const expected = Deno.env.get("ADMIN_ORDER_PIN");
      if (!expected) return json(cors, { error: "PIN admin non configuré", reason: "config" }, 500);
      const { data: failures, error: fErr } = await supabase.rpc("admin_pin_recent_failures", { p_email: admin.email, p_minutes: WINDOW_MINUTES });
      if (fErr) throw new Error(`Failed to read attempts: ${fErr.message}`);
      if (Number(failures) >= MAX_FAILURES) {
        return json(cors, { error: `Trop d'essais. Réessayez dans ${WINDOW_MINUTES} minutes.`, reason: "locked" }, 429);
      }
      const pin = typeof body?.pin === "string" ? body.pin : "";
      const ok = pin.length > 0 && safeEqual(pin, expected);
      await supabase.rpc("admin_pin_record_attempt", { p_email: admin.email, p_success: ok });
      if (!ok) {
        const left = Math.max(0, MAX_FAILURES - Number(failures) - 1);
        return json(cors, { error: left > 0 ? `Code PIN incorrect (${left} essai(s) restant(s)).` : `Code PIN incorrect. PIN bloqué ${WINDOW_MINUTES} minutes.`, reason: "pin" }, 403);
      }
      const token = randomToken();
      const hours = Number(Deno.env.get("ADMIN_PIN_SESSION_HOURS") ?? "12") || 12;
      const { data, error } = await supabase.rpc("admin_pin_open", {
        p_email: admin.email, p_session: admin.authSessionId, p_token_hash: await sha256Hex(token),
        p_hours: hours, p_user_agent: req.headers.get("user-agent") ?? "",
      });
      if (error) throw new Error(`Failed to open the PIN session: ${error.message}`);
      return json(cors, { data: { token, expiresAt: (data as { expiresAt: string }).expiresAt } });
    }

    return json(cors, { error: "Action inconnue", reason: "input" }, 400);
  } catch (error) {
    console.error("admin-pin error:", error);
    return json(cors, { error: "Erreur inattendue. Réessayez.", reason: "server" }, 500);
  }
});
