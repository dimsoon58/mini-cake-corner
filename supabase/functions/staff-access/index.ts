import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { adminPinOk, requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getSiteBaseUrl } from "../_shared/site-config.ts";
import { employeeCaller } from "../_shared/staff-auth.ts";

// Accès équipe (F23). Deux usages :
//   « me »    — n'importe quelle personne connectée : son rôle
//               (admin / employee / aucun) et ses droits, pour que le site
//               n'affiche que les sections permises. Ne donne aucun accès :
//               chaque fonction revérifie elle-même.
//   gestion   — Mel et Eli seulement (session admin + PIN) : « list »,
//               « save » (adresse, droits, actif / inactif), « invite »
//               (e-mail d'invitation Supabase Auth existant : la personne
//               choisit son mot de passe). Une adresse déjà liée à un compte
//               ne reçoit pas de nouvelle invitation. Une adresse
//               administratrice ne peut jamais devenir un accès employée.
// Aucune commande, aucun paiement n'est lu ni modifié.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ALL_EMPLOYEE = ["today.view", "production.view", "production.update", "orders.view", "planning.view", "team.self", "leave.self"];

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(cors, { error: "Method not allowed" }, 405);
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    const admin = await requireAdmin(req, supabase, { body, allowWithoutPinSession: action === "me" });

    if (action === "me") {
      if (admin) return json(cors, { data: { role: "admin", email: admin.email, pinSession: admin.pinSession } });
      const emp = await employeeCaller(req, supabase);
      if (emp) return json(cors, { data: { role: "employee", email: emp.email, memberId: emp.memberId, memberName: emp.memberName, permissions: emp.permissions } });
      return json(cors, { data: { role: null } });
    }

    if (!admin) return json(cors, { error: "Admin sign-in required", reason: "auth" }, 401);
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw Object.assign(new Error("sql"), { sql: error });
      return data;
    };
    if (action === "list") return json(cors, { data: await rpc("staff_access_list", {}) });

    // Écritures : PIN validé pour la session (F16) ou saisi avec la demande.
    if (!adminPinOk(admin, body?.pin)) return json(cors, { error: "Code PIN incorrect", reason: "pin" }, 403);
    const memberId = typeof body.memberId === "string" && UUID_RE.test(body.memberId) ? body.memberId : null;
    if (!memberId) return json(cors, { error: "Personne invalide", reason: "input" }, 400);

    if (action === "save") {
      const email = body.email == null || body.email === "" ? null : String(body.email).trim().toLowerCase();
      if (email && !EMAIL_RE.test(email)) return json(cors, { error: "Adresse email invalide", reason: "input" }, 400);
      const permissions = Array.isArray(body.permissions) ? body.permissions.map(String) : null;
      return json(cors, { data: await rpc("staff_access_save", { p_member: memberId, p_email: email, p_permissions: permissions,
        p_active: typeof body.active === "boolean" ? body.active : null, p_by: admin.email }) });
    }

    if (action === "invite") {
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return json(cors, { error: "Adresse email invalide", reason: "input" }, 400);
      const owner = await rpc("admin_auth_email_owner", { p_email: email, p_except: null }) as string | null;
      // Rien n'est enregistré ni envoyé avant la confirmation (sauf compte existant : aucun e-mail).
      if (!owner && body.confirm !== true) return json(cors, { error: "Confirmez l'envoi de l'invitation", reason: "confirm" }, 409);
      // Accès enregistré (actif, droits employée) : refusé pour une adresse administratrice.
      const saved = await rpc("staff_access_save", { p_member: memberId, p_email: email, p_permissions: ALL_EMPLOYEE, p_active: true, p_by: admin.email }) as { invited_at: string | null };
      if (owner) {
        return json(cors, { data: { invited: false, existingAccount: true,
          message: `Accès activé pour ${email}. Un compte existe déjà avec cette adresse : aucune invitation envoyée ; elle se connecte avec son mot de passe (ou « Mot de passe oublié »).` } });
      }
      const { error } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo: `${getSiteBaseUrl()}/reset-password`, data: { staff_invite: true } });
      if (error) {
        const m = error.message ?? String(error);
        return json(cors, { error: /rate limit|seconds/i.test(m) ? "Trop de demandes rapprochées : réessayez dans une minute." : `Invitation impossible : ${m}`, reason: "auth" }, 409);
      }
      await rpc("staff_access_mark_invited", { p_member: memberId, p_by: admin.email });
      return json(cors, { data: { invited: true, existingAccount: false, previouslyInvited: !!saved?.invited_at,
        message: `Invitation envoyée à ${email} : elle choisit son mot de passe depuis l'e-mail, puis se connecte sur le site.` } });
    }
    return json(cors, { error: "Action inconnue", reason: "input" }, 400);
  } catch (e) {
    const sql = (e as { sql?: { code?: string; message?: string } }).sql;
    if (sql?.code === "P0001") return json(cors, { error: sql.message, reason: "refused" }, 409);
    if (sql?.code === "P0002") return json(cors, { error: sql.message, reason: "not_found" }, 404);
    console.error("staff-access error:", e, sql);
    return json(cors, { error: "Erreur inattendue. Réessayez.", reason: "server" }, 500);
  }
});
