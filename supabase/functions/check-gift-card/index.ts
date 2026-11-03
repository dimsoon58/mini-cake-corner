import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { corsHeaders } from "../_shared/cors.ts";

// F38 (03.11.2026) — the cart's « Code promo » field: is this gift voucher
// usable, and how much is on it? Read only (gift_card_lookup): nothing is
// set aside here — the amount is reserved by create-postfinance-payment
// when the payment starts. Public. Codes are 8 random characters out of 32
// (about 10^12 combinations), so guessing one is not realistic.

const CODE_RE = /^BCS-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(cors, { error: "Method not allowed" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const code = String(body?.code ?? "").trim().toUpperCase();
    if (!CODE_RE.test(code)) return json(cors, { ok: false, reason: "unknown" });
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
    const { data, error } = await supabase.rpc("gift_card_lookup", { p_code: code });
    if (error) throw new Error(error.message);
    return json(cors, data);
  } catch (e) {
    console.error("check-gift-card error:", e);
    return json(cors, { ok: false, reason: "error" }, 500);
  }
});
