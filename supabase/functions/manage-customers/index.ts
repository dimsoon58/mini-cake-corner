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
// Read actions (admin session):   list, get, account_status, newsletter_brevo,
//   email_change_preview (F21)
// Write actions (session + PIN):  save, merge, relink_order, resolve_alert,
//   reward_credit (F20), account_invite, account_resend, password_reset,
//   email_change (F21). login_email_change (F20) is replaced by email_change.
//
// Nothing here changes an order's content, its payment or its historical
// contact details. F20 (2026-10-05):
//   - reward_credit adds a lot to the EXISTING reward system (same balance,
//     same balance trigger; the Notion sync scenario is disabled, so Notion
//     is NOT updated), once per idempotency key;
//   - the account actions go through Supabase Auth: the invitation,
//     activation and password-reset e-mails are the existing ones (Send
//     Email Hook → send-auth-email); changing the login e-mail sends none.
//     Each action is logged on the record (result included) and the same
//     action cannot be repeated within 60 s (no double e-mail);
//   - newsletter_brevo only READS the Brevo contact (date added to the list).
// F21: email_change is the only way to change an existing customer's email:
//   login (Auth) → profile + record (one transaction) → existing Brevo
//   contact renamed (never created, never subscribed). Each step is logged
//   and resumable; conflicts are checked before anything is written.

const READ = new Set(["list", "get", "account_status", "newsletter_brevo", "email_change_preview"]);
const WRITE = new Set(["save", "merge", "relink_order", "resolve_alert",
  "reward_credit", "account_invite", "account_resend", "password_reset", "login_email_change", "email_change"]);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface Target { customerId: string; mergedInto: string | null; contactEmail: string | null; firstName: string | null; lastName: string | null;
  phone: string | null; profileId: string | null; loginEmail: string | null }
type AuthUser = { id: string; email?: string; email_confirmed_at?: string | null; confirmed_at?: string | null; invited_at?: string | null;
  last_sign_in_at?: string | null; created_at?: string; new_email?: string | null };

// ── F21 : « Modifier l'adresse email » ──────────────────────────────────
// Brevo : lecture d'un contact et renommage (attributes.EMAIL). Le renommage
// garde le même contact : listes, désinscription et blocage inchangés. On
// ne crée ni n'inscrit jamais de contact ici.
const BREVO = "https://api.brevo.com/v3/contacts/";
type BrevoContact = { email?: string; listIds?: number[]; emailBlacklisted?: boolean };
async function brevoGet(email: string): Promise<{ status: number; contact: BrevoContact | null }> {
  const key = Deno.env.get("BREVO_API_KEY");
  if (!key) return { status: 0, contact: null };
  const r = await fetch(`${BREVO}${encodeURIComponent(email.trim().toLowerCase())}`, { headers: { "api-key": key, Accept: "application/json" } });
  if (r.status === 404) return { status: 404, contact: null };
  if (!r.ok) return { status: r.status, contact: null };
  return { status: 200, contact: await r.json() };
}
async function brevoRename(oldEmail: string, newEmail: string): Promise<{ ok: boolean; status: number; error?: string }> {
  const key = Deno.env.get("BREVO_API_KEY");
  if (!key) return { ok: false, status: 0, error: "Brevo non configuré" };
  const r = await fetch(`${BREVO}${encodeURIComponent(oldEmail.trim().toLowerCase())}`, {
    method: "PUT", headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ attributes: { EMAIL: newEmail } }),
  });
  if (r.status === 204 || r.status === 200) return { ok: true, status: r.status };
  return { ok: false, status: r.status, error: (await r.text().catch(() => "")).slice(0, 200) };
}
const brevoState = (c: BrevoContact | null) => !c ? "aucun contact"
  : c.emailBlacklisted ? "contact bloqué (désinscrit de tous les e-mails)"
  : (c.listIds?.includes(Number(Deno.env.get("BREVO_LIST_ID"))) ? "inscrit à la newsletter" : "contact hors de la liste newsletter (désinscrit)");
const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x).map((x) => x.trim().toLowerCase()))];

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

    // Email de connexion réel (Supabase Auth) ; null sans compte.
    const authEmailOf = async (profileId: string | null): Promise<string | null> => {
      if (!profileId) return null;
      const { data: u, error } = await supabase.auth.admin.getUserById(profileId);
      if (error) console.error("manage-customers getUserById:", error);
      return u?.user?.email?.toLowerCase() ?? null;
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
        // F21 : sur une fiche existante, l'email ne change que par « Modifier l'adresse email ».
        if (id) {
          const cur = await rpc("admin_customer_account_target", { p_customer: id }) as Target | null;
          const firstEmail = !!cur && !cur.contactEmail && !cur.profileId;
          if (cur && !firstEmail && (cur.contactEmail ?? "").trim().toLowerCase() !== (email ?? "").toLowerCase()) {
            return json(cors, { error: "Pour changer l'email, utilisez « Modifier l'adresse email » (fiche, compte et Brevo ensemble).", reason: "use_email_change" }, 409);
          }
        }
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
      case "login_email_change":
        // F21 : un changement isolé de l'email de connexion laisserait la fiche et Brevo sur l'ancienne adresse.
        return json(cors, { error: "Pour changer l'email, utilisez « Modifier l'adresse email » (fiche, compte et Brevo ensemble).", reason: "use_email_change" }, 409);
      case "account_invite":
      case "account_resend":
      case "password_reset": {
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
      // ── F21 : « Modifier l'adresse email » (fiche + compte + Brevo) ──
      case "email_change_preview": {
        const t = await rpc("admin_customer_account_target", { p_customer: uuid(body.customerId, "Client") }) as Target | null;
        if (!t) return json(cors, { error: "Client introuvable", reason: "not_found" }, 404);
        const newEmail = (text(body.email, 200) ?? "").toLowerCase();
        const latest = await rpc("customer_email_change_latest", { p_customer: t.customerId });
        const authEmail = await authEmailOf(t.profileId);
        const olds = uniq([authEmail, t.loginEmail, t.contactEmail]).filter((e) => e !== newEmail);
        const brevoOld = [];
        for (const e of olds) { const g = await brevoGet(e); brevoOld.push({ email: e, status: g.status, state: g.status === 200 ? brevoState(g.contact) : null }); }
        let conflicts = null, brevoNew = null;
        if (EMAIL_RE.test(newEmail)) {
          conflicts = await rpc("customer_email_change_conflicts", { p_customer: t.customerId, p_new: newEmail });
          const g = await brevoGet(newEmail);
          brevoNew = { status: g.status, state: g.status === 200 ? brevoState(g.contact) : null };
        }
        data = { contactEmail: t.contactEmail, loginEmail: authEmail ?? t.loginEmail, profileEmail: t.loginEmail, hasAccount: !!t.profileId, newEmail: newEmail || null,
          conflicts, brevoOld, brevoNew, latest };
        break;
      }
      case "email_change": {
        const t = await rpc("admin_customer_account_target", { p_customer: uuid(body.customerId, "Client") }) as Target | null;
        if (!t || t.mergedInto) return json(cors, { error: "Client introuvable ou fusionné", reason: "not_found" }, 404);
        const key = text(body.idempotencyKey, 100);
        if (!key) throw new InputError("Clé de requête manquante");
        if (body.identityChecked !== true) throw new InputError("Confirmez avoir vérifié l'identité du client.");
        const newEmail = (text(body.email, 200) ?? "").toLowerCase();
        if (!EMAIL_RE.test(newEmail)) throw new InputError("Nouvelle adresse invalide");
        const block = (message: string, reason = "conflict") => json(cors, { error: message, reason }, 409);

        // Reprise d'une opération ouverte (même clé, ou même nouvelle adresse) : pas de nouvelles vérifications de départ.
        const latest = await rpc("customer_email_change_latest", { p_customer: t.customerId }) as { key: string; status: string; new_email: string } | null;
        const open = !!latest && ["in_progress", "partial"].includes(latest.status);
        const resuming = !!latest && ((latest.key === key && latest.status !== "blocked") || (open && latest.new_email === newEmail));
        const authEmail = await authEmailOf(t.profileId);
        if (!resuming) {
          if (uniq([t.contactEmail, t.profileId ? (authEmail ?? t.loginEmail) : null]).every((e) => e === newEmail) && t.contactEmail) {
            throw new InputError("C'est déjà l'adresse de ce client.");
          }
          // Vérifications AVANT toute écriture : rien n'est modifié si l'une échoue.
          const c = await rpc("customer_email_change_conflicts", { p_customer: t.customerId, p_new: newEmail }) as { otherCustomer: { id: string; name: string } | null; otherAccount: boolean };
          if (c.otherCustomer) return block(`Cette adresse est déjà celle d'une autre fiche (${c.otherCustomer.name || c.otherCustomer.id}). Aucune fusion automatique : rien n'a été modifié.`);
          if (c.otherAccount) return block("Cette adresse appartient déjà à un autre compte client. Rien n'a été modifié.");
          const gNew = await brevoGet(newEmail);
          if (gNew.status === 0) return block("Brevo n'est pas configuré : rien n'a été modifié.", "brevo");
          if (gNew.status === 200) return block("Un contact Brevo existe déjà avec cette adresse : à vérifier dans Brevo. Rien n'a été modifié.");
          if (gNew.status !== 404) return block(`Brevo ne répond pas (erreur ${gNew.status}) : rien n'a été modifié, réessayez plus tard.`, "brevo");
          const olds = uniq([authEmail, t.loginEmail, t.contactEmail]);
          const found = [];
          for (const e of olds) { const g = await brevoGet(e); if (g.status === 200) found.push(e); else if (g.status !== 404) return block(`Brevo ne répond pas (erreur ${g.status}) : rien n'a été modifié, réessayez plus tard.`, "brevo"); }
          if (found.length > 1) return block(`Deux contacts Brevo existent (${found.join(", ")}) : à regrouper dans Brevo d'abord. Rien n'a été modifié.`);
        }
        let op = await rpc("customer_email_change_begin", { p_customer: t.customerId, p_new: newEmail, p_key: key, p_identity: true, p_by: admin.email, p_login: authEmail }) as {
          id: string; profile_id: string | null; old_contact_email: string | null; old_login_email: string | null; new_email: string; status: string;
          steps: Record<string, string>; message: string | null;
        };
        // Même clé déjà terminée (double clic après la fin) : on renvoie le résultat, rien n'est refait.
        if (op.status === "completed") { data = { status: "completed", message: op.message, steps: op.steps, operationId: op.id, newEmail: op.new_email, resumed: true }; break; }
        // Une seule exécution à la fois (double clic, deux onglets).
        if (!(await rpc("customer_email_change_claim", { p_op: op.id }))) {
          return json(cors, { error: "Cette modification est déjà en cours d'exécution : attendez quelques secondes puis rechargez la fiche.", reason: "busy" }, 409);
        }
        const step = async (name: "auth" | "db" | "brevo", result: "ok" | "error" | "not_needed", message: string | null) => {
          op = await rpc("customer_email_change_step", { p_op: op.id, p_step: name, p_result: result, p_message: message }) as typeof op;
        };
        const LABEL: Record<string, string> = { auth: "email de connexion (compte)", db: "email de contact (fiche) et profil du compte", brevo: "contact Brevo" };
        const report = () => {
          const done = Object.keys(LABEL).filter((k) => op.steps[k] === "ok").map((k) => LABEL[k]);
          const skipped = Object.keys(LABEL).filter((k) => op.steps[k] === "not_needed").map((k) => `${LABEL[k]} (rien à faire)`);
          const remaining = Object.keys(LABEL).filter((k) => op.steps[k] === "pending" || op.steps[k] === "error").map((k) => LABEL[k] + (op.steps[`${k}_message`] ? ` — ${op.steps[`${k}_message`]}` : ""));
          return { done, skipped, remaining };
        };
        const finish = async () => {
          const r = report();
          const status = r.remaining.length === 0 ? "completed" : r.done.length === 0 ? "blocked" : "partial";
          const message = status === "completed"
            ? `Adresse remplacée par ${op.new_email}. Mis à jour : ${[...r.done, ...r.skipped].join(", ")}.`
            : `${r.done.length ? `Mis à jour : ${r.done.join(", ")}. ` : "Rien n'a été modifié. "}Reste à faire : ${r.remaining.join(" ; ")}. Relancez « Reprendre » : les étapes déjà faites ne sont pas refaites.`;
          await rpc("customer_email_change_finish", { p_op: op.id, p_status: status, p_message: message });
          return { status, message, steps: op.steps, operationId: op.id, newEmail: op.new_email, ...r };
        };
        const partial = (res: { message: string }) => json(cors, { success: false, data: res, error: res.message, reason: "partial" }, 409);

        try {
        // 1. Email de connexion (même compte : cagnotte, avantages et historique inchangés).
        if (op.steps.auth === "pending" || op.steps.auth === "error") {
          const { data: u } = await supabase.auth.admin.getUserById(op.profile_id!);
          if ((u?.user?.email ?? "").toLowerCase() === op.new_email) await step("auth", "ok", null);
          else {
            const { error } = await supabase.auth.admin.updateUserById(op.profile_id!, { email: op.new_email, email_confirm: true });
            if (error) {
              const raw = error.message ?? String(error);
              await step("auth", "error", /already|exists|registered|duplicate/i.test(raw) ? "adresse déjà utilisée par un autre compte" : raw.slice(0, 160));
              return partial(await finish());
            }
            await step("auth", "ok", null);
          }
        }
        // 2. Fiche + profil (une transaction).
        if (op.steps.db === "pending" || op.steps.db === "error") {
          try { await rpc("customer_email_change_apply_db", { p_op: op.id }); await step("db", "ok", null); }
          catch (e) {
            const m = (e as { sql?: { message?: string } })?.sql?.message ?? "erreur de la base";
            await step("db", "error", m.slice(0, 160));
            return partial(await finish());
          }
        }
        // 3. Brevo : renommer le contact existant (jamais créé, jamais inscrit).
        if (op.steps.brevo === "pending" || op.steps.brevo === "error") {
          const olds = uniq([op.old_login_email, op.old_contact_email, t.loginEmail]).filter((e) => e !== op.new_email);
          const states = [];
          let unavailable: number | null = null;
          for (const e of olds) { const g = await brevoGet(e); if (g.status === 200) states.push({ e, c: g.contact }); else if (g.status !== 404) unavailable = g.status; }
          const gNew = await brevoGet(op.new_email);
          if (unavailable !== null || gNew.status === 0 || (gNew.status !== 200 && gNew.status !== 404)) {
            await step("brevo", "error", gNew.status === 0 ? "Brevo non configuré" : `Brevo ne répond pas (erreur ${unavailable ?? gNew.status})`);
          } else if (states.length === 0 && gNew.status === 200) {
            await step("brevo", "ok", `déjà à jour (${brevoState(gNew.contact)})`);
          } else if (states.length === 0) {
            await step("brevo", "not_needed", "aucun contact Brevo : rien créé, aucune inscription");
          } else if (states.length > 1 || gNew.status === 200) {
            await step("brevo", "error", "plusieurs contacts Brevo pour ce client : à regrouper dans Brevo, puis reprendre");
          } else {
            const r = await brevoRename(states[0].e, op.new_email);
            if (r.ok) await step("brevo", "ok", `contact renommé, ${brevoState(states[0].c)} (inchangé)`);
            else await step("brevo", "error", `Brevo a refusé le changement (erreur ${r.status})`);
          }
        }
        } catch (e) {
          // Erreur imprévue (réseau…) : on enregistre l'état exact et on libère le verrou.
          console.error("manage-customers email_change:", e);
          return partial(await finish());
        }
        const res = await finish();
        if (res.status !== "completed") return partial(res);
        data = res;
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
