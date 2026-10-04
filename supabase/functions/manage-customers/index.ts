import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { adminPinOk, requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getSiteBaseUrl } from "../_shared/site-config.ts";

// Admin > Clients (lot C). One entry point for the list, the customer page,
// creation / edit, manual merge, re-linking an order and closing alerts.
// Every rule (matching, merge safety, statistics from the lot 1–3 registers,
// test orders excluded) lives in SQL (migration F8); this function checks
// who calls, validates the input shape and forwards.
//
// Read actions (admin session):   list, get, account_status, newsletter_brevo
// Write actions (session + PIN):  save, merge, relink_order, resolve_alert,
//   reward_credit (F20), account_invite, account_resend, password_reset,
//   login_email_change (F20)
//
// Nothing here changes an order's content, its payment or its historical
// contact details. F20 (2026-10-05):
//   - reward_credit adds a lot to the EXISTING reward system (same balance,
//     same Make → Notion sync), once per idempotency key;
//   - the account actions go through Supabase Auth: the invitation,
//     activation and password-reset e-mails are the existing ones (Send
//     Email Hook → send-auth-email); changing the login e-mail sends none.
//     Each action is logged on the record (result included) and the same
//     action cannot be repeated within 60 s (no double e-mail);
//   - newsletter_brevo only READS the Brevo contact (date added to the list).

const READ = new Set(["list", "get", "account_status", "newsletter_brevo"]);
const WRITE = new Set(["save", "merge", "relink_order", "resolve_alert",
  "reward_credit", "account_invite", "account_resend", "password_reset", "login_email_change"]);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface Target { customerId: string; mergedInto: string | null; contactEmail: string | null; firstName: string | null; lastName: string | null;
  phone: string | null; profileId: string | null; loginEmail: string | null }
type AuthUser = { id: string; email?: string; email_confirmed_at?: string | null; confirmed_at?: string | null; invited_at?: string | null;
  last_sign_in_at?: string | null; created_at?: string; new_email?: string | null };

/** État du compte de connexion, à partir de Supabase Auth. */
function accountState(u: AuthUser | null) {
  if (!u) return { state: "missing" as const };
  const confirmed = u.email_confirmed_at ?? u.confirmed_at ?? null;
  return {
    state: confirmed ? "active" as const : u.invited_at ? "invited" as const : "unconfirmed" as const,
    loginEmail: u.email ?? null, confirmedAt: confirmed, invitedAt: u.invited_at ?? null,
    lastSignInAt: u.last_sign_in_at ?? null, createdAt: u.created_at ?? null, pendingNewEmail: u.new_email ?? null,
  };
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

class InputError extends Error {}
const uuid = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new InputError(`${field} invalide`);
  return v;
};
const text = (v: unknown, max = 300): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

function sqlError(cors: Record<string, string>, e: { code?: string; message?: string }) {
  if (e?.code === "P0001") return json(cors, { error: e.message, reason: "refused" }, 409);
  if (e?.code === "P0002") return json(cors, { error: e.message, reason: "not_found" }, 404);
  if (e?.code === "P0004") {
    const id = /\(([0-9a-f-]{36})\)/i.exec(e.message ?? "")?.[1] ?? null;
    return json(cors, { error: "Une autre fiche utilise déjà cet email.", reason: "email_exists", existingId: id }, 409);
  }
  console.error("manage-customers SQL error:", e);
  return json(cors, { error: "Erreur inattendue. Réessayez.", reason: "server" }, 500);
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
    const admin = await requireAdmin(req, supabase);
    if (!admin) return json(cors, { error: "Admin sign-in required", reason: "auth" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    if (!READ.has(action) && !WRITE.has(action)) return json(cors, { error: "Action inconnue", reason: "input" }, 400);
    if (WRITE.has(action)) {
      // PIN validé pour la session (F16) ou saisi avec la demande.
      if (!adminPinOk(admin, body?.pin)) return json(cors, { error: "Code PIN incorrect", reason: "pin" }, 403);
    }

    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw Object.assign(new Error("sql"), { sql: error });
      return data;
    };

    let data: unknown;
    switch (action) {
      case "list": {
        const sort = String(body.sort ?? "last_order");
        if (!["name", "last_order", "orders", "net", "created"].includes(sort)) throw new InputError("Tri inconnu");
        data = await rpc("admin_customer_list", {
          p_search: text(body.search, 100),
          p_sort: sort,
          p_desc: body.desc !== false,
          p_page: Math.max(1, Math.floor(Number(body.page) || 1)),
          p_size: Math.min(100, Math.max(1, Math.floor(Number(body.size) || 25))),
          p_include_tests: body.includeTests === true,
        });
        break;
      }
      case "get":
        data = await rpc("admin_customer_detail", { p_customer: uuid(body.customerId, "Client") });
        if (!data) return json(cors, { error: "Client introuvable", reason: "not_found" }, 404);
        break;
      case "save": {
        const id = body.customerId ? uuid(body.customerId, "Client") : null;
        const email = text(body.email, 200);
        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new InputError("Email invalide");
        data = { customerId: await rpc("admin_customer_save", {
          p_id: id,
          p_first: text(body.firstName, 100),
          p_last: text(body.lastName, 100),
          p_email: email,
          p_phone: text(body.phone, 40),
          p_company: text(body.company, 200),
          p_address: text(body.address, 500),
          p_notes: text(body.notes, 5000),
          p_by: admin.email,
          p_allow_same_email: body.allowSameEmail === true,
        }) };
        break;
      }
      case "merge":
        data = await rpc("merge_customers", {
          p_keep: uuid(body.keepId, "Fiche conservée"),
          p_absorb: uuid(body.absorbId, "Fiche fusionnée"),
          p_by: admin.email,
        });
        break;
      case "relink_order":
        await rpc("relink_order_customer", {
          p_order: uuid(body.orderId, "Commande"),
          p_customer: uuid(body.customerId, "Client"),
          p_by: admin.email,
        });
        data = { ok: true };
        break;
      case "resolve_alert": {
        const id = Number(body.alertId);
        if (!Number.isInteger(id) || id <= 0) throw new InputError("Alerte invalide");
        await rpc("resolve_customer_alert", { p_id: id, p_by: admin.email });
        data = { ok: true };
        break;
      }
      // ── F20 : cagnotte ──
      case "reward_credit": {
        const amount = Number(String(body.amount ?? "").replace(/[’'\s]/g, "").replace(",", "."));
        if (!Number.isFinite(amount) || amount <= 0) throw new InputError("Montant invalide");
        const reason = text(body.reason, 300);
        if (!reason) throw new InputError("Motif obligatoire");
        const key = text(body.idempotencyKey, 100);
        if (!key) throw new InputError("Clé de requête manquante");
        data = await rpc("admin_reward_credit", {
          p_customer: uuid(body.customerId, "Client"), p_amount: Math.round(amount * 100) / 100, p_reason: reason, p_by: admin.email, p_key: key,
        });
        break;
      }
      // ── F20 : newsletter (lecture Brevo) ──
      case "newsletter_brevo": {
        const t = await rpc("admin_customer_account_target", { p_customer: uuid(body.customerId, "Client") }) as Target | null;
        if (!t) return json(cors, { error: "Client introuvable", reason: "not_found" }, 404);
        const email = t.loginEmail ?? t.contactEmail;
        const key = Deno.env.get("BREVO_API_KEY"), list = Number(Deno.env.get("BREVO_LIST_ID"));
        if (!email) { data = { found: false, reason: "no_email" }; break; }
        if (!key) { data = { found: false, reason: "not_configured" }; break; }
        const r = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email.trim().toLowerCase())}`, { headers: { "api-key": key, Accept: "application/json" } });
        if (r.status === 404) { data = { found: false, reason: "not_in_brevo", email }; break; }
        if (!r.ok) { data = { found: false, reason: "brevo_error", status: r.status }; break; }
        const c = await r.json();
        data = { found: true, email, createdAt: c.createdAt ?? null, modifiedAt: c.modifiedAt ?? null,
          inList: Array.isArray(c.listIds) && c.listIds.includes(list), emailBlacklisted: c.emailBlacklisted === true };
        break;
      }
      // ── F20 : compte de connexion ──
      case "account_status": {
        const t = await rpc("admin_customer_account_target", { p_customer: uuid(body.customerId, "Client") }) as Target | null;
        if (!t) return json(cors, { error: "Client introuvable", reason: "not_found" }, 404);
        if (!t.profileId) { data = { state: "none", contactEmail: t.contactEmail }; break; }
        const { data: u, error } = await supabase.auth.admin.getUserById(t.profileId);
        if (error) console.error("manage-customers getUserById:", error);
        data = { ...accountState((u?.user ?? null) as AuthUser | null), contactEmail: t.contactEmail };
        break;
      }
      case "account_invite":
      case "account_resend":
      case "password_reset":
      case "login_email_change": {
        const t = await rpc("admin_customer_account_target", { p_customer: uuid(body.customerId, "Client") }) as Target | null;
        if (!t || t.mergedInto) return json(cors, { error: "Client introuvable ou fusionné", reason: "not_found" }, 404);
        const site = getSiteBaseUrl();
        let user: AuthUser | null = null;
        if (t.profileId) {
          const { data: u } = await supabase.auth.admin.getUserById(t.profileId);
          user = (u?.user ?? null) as AuthUser | null;
        }
        const st = accountState(user);
        // Vérifications AVANT tout envoi.
        let email = "";
        if (action === "account_invite") {
          if (t.profileId) throw new InputError("Ce client a déjà un compte.");
          email = (text(body.email, 200) ?? t.contactEmail ?? "").toLowerCase();
          if (!EMAIL_RE.test(email)) throw new InputError("Email de connexion invalide (renseignez l'email de contact ou saisissez-en un).");
        } else {
          if (!t.profileId || !user) throw new InputError("Ce client n'a pas de compte.");
          email = (user.email ?? "").toLowerCase();
          if (action === "account_resend" && st.state === "active") throw new InputError("Le compte est déjà activé : envoyez plutôt un lien de réinitialisation.");
          if (action === "password_reset" && st.state !== "active") throw new InputError("Le compte n'est pas encore activé : renvoyez plutôt l'activation.");
          if (action === "login_email_change") {
            email = (text(body.email, 200) ?? "").toLowerCase();
            if (!EMAIL_RE.test(email)) throw new InputError("Nouvel email de connexion invalide");
            if (email === (user.email ?? "").toLowerCase()) throw new InputError("C'est déjà l'email de connexion.");
          }
        }
        const eventId = await rpc("customer_account_action_begin", {
          p_customer: t.customerId, p_kind: action,
          p_detail: action === "login_email_change" ? { from: user?.email ?? null, to: email } : { email },
          p_by: admin.email,
        }) as number;
        const finish = (result: "ok" | "error", message: string) => rpc("customer_account_action_finish", { p_event: eventId, p_result: result, p_message: message });
        try {
          let message = "";
          if (action === "account_invite") {
            const { data: inv, error } = await supabase.auth.admin.inviteUserByEmail(email, {
              data: { first_name: t.firstName ?? "", last_name: t.lastName ?? "", phone: t.phone ?? "" },
              redirectTo: `${site}/reset-password`,
            });
            if (error) throw error;
            const linked = inv?.user?.id ? await rpc("customer_attach_profile", { p_customer: t.customerId, p_profile: inv.user.id, p_by: admin.email }) : null;
            message = `Invitation envoyée à ${email}.${linked === "other_record" ? " Le compte a été rattaché à une autre fiche : voir l'alerte." : ""}`;
          } else if (action === "account_resend") {
            if (st.state === "invited") {
              const { error } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo: `${site}/reset-password` });
              if (error) throw error;
              message = `Invitation renvoyée à ${email}.`;
            } else {
              const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${site}/login?confirmed=true` } });
              if (error) throw error;
              message = `E-mail d'activation renvoyé à ${email}.`;
            }
          } else if (action === "password_reset") {
            const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${site}/reset-password` });
            if (error) throw error;
            message = `Lien de réinitialisation envoyé à ${email}.`;
          } else {
            const { error } = await supabase.auth.admin.updateUserById(t.profileId!, { email, email_confirm: true });
            if (error) throw error;
            await rpc("admin_profile_set_email", { p_profile: t.profileId, p_email: email });
            message = `Email de connexion changé : ${user?.email ?? "—"} → ${email}. L'email de contact de la fiche n'a pas changé. Aucun e-mail envoyé.`;
          }
          await finish("ok", message);
          data = { ok: true, message };
        } catch (e) {
          const raw = (e as { message?: string })?.message ?? String(e);
          const message = /already.*registered|already been registered|email.*exists|duplicate/i.test(raw)
            ? "Un autre compte utilise déjà cet email."
            : /rate limit|security purposes|seconds/i.test(raw) ? "Trop de demandes rapprochées : réessayez dans une minute." : `Échec : ${raw}`;
          await finish("error", message);
          return json(cors, { error: message, reason: "auth" }, 409);
        }
        break;
      }
    }
    return json(cors, { success: true, data });
  } catch (error) {
    if (error instanceof InputError) return json(cors, { error: error.message, reason: "input" }, 400);
    const sql = (error as { sql?: { code?: string; message?: string } })?.sql;
    if (sql) return sqlError(cors, sql);
    console.error("manage-customers error:", error);
    return json(cors, { error: "Erreur inattendue. Réessayez.", reason: "server" }, 500);
  }
});
