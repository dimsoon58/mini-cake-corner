import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { finalizeGiftCard } from "../_shared/gift-cards.ts";
import { corsHeaders } from "../_shared/cors.ts";

// F37 (03.11.2026) — called by the « Merci » page after PostFinance
// (polled for a few seconds) and safe to call any number of times: the
// real transaction state is read from PostFinance, the voucher is activated
// and its email sent once (finalizeGiftCard). Public: the id is a random UUID
// only the buyer has (success URL). Never returns the code itself — the code
// travels by email only.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const maskEmail = (email: string) => {
  const [user, domain] = email.split("@");
  if (!domain) return email;
  return `${user.slice(0, 2)}${"•".repeat(Math.max(user.length - 2, 1))}@${domain}`;
};

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(cors, { error: "Method not allowed" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const id = String(body?.id ?? "");
    if (!UUID_RE.test(id)) return json(cors, { error: "Bon cadeau introuvable", reason: "not_found" }, 404);
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
    const result = await finalizeGiftCard(supabase, id);
    if (result.status === "not_found") return json(cors, { error: "Bon cadeau introuvable", reason: "not_found" }, 404);
    const { data: card } = await supabase.from("gift_cards").select("initial_amount, buyer_email").eq("id", id).maybeSingle();
    return json(cors, {
      status: result.status,
      emailSent: result.emailSent,
      amount: card ? Number(card.initial_amount) : null,
      email: card ? maskEmail(String(card.buyer_email)) : null,
    });
  } catch (e) {
    console.error("confirm-gift-card-payment error:", e);
    return json(cors, { error: "Erreur inattendue. Réessayez.", reason: "server" }, 500);
  }
});
