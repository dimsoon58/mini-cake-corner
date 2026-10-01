import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Admin > remboursements (lot 2). One entry point for the order page block
// and the « Remboursements » section. Every rule lives in SQL (migrations
// F3 / F6): this function only checks who is calling, validates the input
// shape and forwards to the RPCs, so the admin path, Make and the workshop
// flow all go through the same checks (cap, duplicates, double click,
// decisions).
//
// Read actions (admin session):   get_order, list
// Write actions (session + PIN):  record_refund, record_decision,
//                                 void_refund, void_decision, review_refund,
//                                 date_refund, resolve_anomaly
//
// Nothing here moves money, changes payment_status / order_validation /
// production, sends an e-mail or calls Make. Refunds are made by hand in
// PostFinance (or elsewhere) and only RECORDED here.

const READ_ACTIONS = new Set(["get_order", "list"]);
const WRITE_ACTIONS = new Set([
  "record_refund", "record_decision", "void_refund", "void_decision",
  "review_refund", "date_refund", "resolve_anomaly",
]);
const METHODS = new Set(["postfinance", "twint", "bank_transfer", "cash", "other"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const zurichTodayISO = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const isISODate = (v: unknown): v is string => {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

// A refund date chosen in the admin is a calendar day: stored at noon,
// Europe/Zurich, so it can never slip to the previous/next day.
const zurichNoon = (day: string) => `${day} 12:00:00 Europe/Zurich`;

class InputError extends Error {}

const uuid = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new InputError(`${field} invalide`);
  return v;
};
const amount = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 100000 || Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) {
    throw new InputError("Montant invalide (CHF, 2 décimales au plus)");
  }
  return Math.round(n * 100) / 100;
};
const pastDay = (v: unknown, field: string): string => {
  if (!isISODate(v)) throw new InputError(`${field} invalide`);
  if (v > zurichTodayISO()) throw new InputError("La date ne peut pas être dans le futur");
  return v;
};
const text = (v: unknown, max = 500): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const requiredText = (v: unknown, field: string): string => {
  const s = text(v);
  if (!s) throw new InputError(`${field} obligatoire`);
  return s;
};
const uuidList = (v: unknown): string[] => {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > 50) throw new InputError("Articles invalides");
  return Array.from(new Set(v.map((x) => uuid(x, "Article"))));
};
const idempotencyKey = (v: unknown): string => {
  if (typeof v !== "string" || v.length < 8 || v.length > 100) throw new InputError("Clé anti-doublon manquante");
  return v;
};

// SQL errors raised by the refund functions carry a French, user-facing
// message: P0001 = rule refused, P0002 = not found, P0003 = needs the
// « geste commercial » box.
function sqlErrorResponse(cors: Record<string, string>, error: { code?: string; message?: string }) {
  const code = error?.code ?? "";
  if (code === "P0001") return json(cors, { error: error.message, reason: "refused" }, 409);
  if (code === "P0002") return json(cors, { error: error.message, reason: "not_found" }, 404);
  if (code === "P0003") return json(cors, { error: error.message, reason: "needs_gesture" }, 409);
  console.error("manage-refunds SQL error:", error);
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
    if (!READ_ACTIONS.has(action) && !WRITE_ACTIONS.has(action)) {
      return json(cors, { error: "Action inconnue", reason: "input" }, 400);
    }

    if (WRITE_ACTIONS.has(action)) {
      const adminPin = Deno.env.get("ADMIN_ORDER_PIN");
      if (!adminPin || body?.pin !== adminPin) return json(cors, { error: "Code PIN incorrect", reason: "pin" }, 403);
    }

    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw Object.assign(new Error("sql"), { sql: error });
      return data;
    };

    let data: unknown;
    switch (action) {
      case "get_order":
        data = await rpc("admin_order_refunds", { p_order_id: uuid(body.orderId, "Commande") });
        if (!data) return json(cors, { error: "Commande introuvable", reason: "not_found" }, 404);
        break;

      case "list": {
        const tab = String(body.tab ?? "");
        if (!["done", "todo", "review"].includes(tab)) throw new InputError("Onglet inconnu");
        const args: Record<string, unknown> = { p_tab: tab, p_include_tests: body.includeTests === true };
        if (tab === "done") {
          if (!isISODate(body.from) || !isISODate(body.to) || body.to < body.from) throw new InputError("Période invalide");
          args.p_from = body.from;
          args.p_to = body.to;
        }
        data = await rpc("admin_refund_list", args);
        break;
      }

      case "record_refund": {
        const method = String(body.method ?? "");
        if (!METHODS.has(method)) throw new InputError("Moyen de remboursement obligatoire");
        const rows = await rpc("ingest_refund", {
          p_order_id: uuid(body.orderId, "Commande"),
          p_amount: amount(body.amount),
          p_refunded_at: zurichNoon(pastDay(body.refundedAt, "Date du remboursement")),
          p_source: "admin",
          p_idempotency_key: idempotencyKey(body.idempotencyKey),
          p_method: method,
          p_method_detail: text(body.methodDetail, 200),
          p_reference: text(body.reference, 200),
          p_note: text(body.note),
          p_item_ids: uuidList(body.itemIds),
          p_created_by: admin.email,
          p_allow_gesture: body.allowGesture === true,
          p_confirm_distinct: body.confirmDistinct === true,
        });
        data = Array.isArray(rows) ? rows[0] : rows;
        break;
      }

      case "record_decision":
        data = await rpc("record_refund_decision", {
          p_order_id: uuid(body.orderId, "Commande"),
          p_amount: amount(body.amount),
          p_reason: requiredText(body.reason, "Motif"),
          p_source: "admin_gesture",
          p_idempotency_key: idempotencyKey(body.idempotencyKey),
          p_item_ids: uuidList(body.itemIds),
          p_by: admin.email,
        });
        break;

      case "void_refund":
        await rpc("void_refund_entry", {
          p_refund_id: uuid(body.refundId, "Remboursement"),
          p_reason: requiredText(body.reason, "Motif"),
          p_by: admin.email,
        });
        data = { ok: true };
        break;

      case "void_decision":
        await rpc("void_refund_decision", {
          p_decision_id: uuid(body.decisionId, "Décision"),
          p_reason: requiredText(body.reason, "Motif"),
          p_by: admin.email,
        });
        data = { ok: true };
        break;

      case "review_refund": {
        const decision = String(body.decision ?? "");
        if (decision !== "distinct" && decision !== "duplicate") throw new InputError("Choix de vérification invalide");
        const rows = await rpc("review_refund", {
          p_refund_id: uuid(body.refundId, "Remboursement"),
          p_decision: decision,
          p_by: admin.email,
        });
        data = Array.isArray(rows) ? rows[0] : rows;
        break;
      }

      case "date_refund":
        await rpc("set_refund_date", {
          p_refund_id: uuid(body.refundId, "Remboursement"),
          p_refunded_at: zurichNoon(pastDay(body.refundedAt, "Date du remboursement")),
          p_by: admin.email,
        });
        data = { ok: true };
        break;

      case "resolve_anomaly": {
        const id = Number(body.anomalyId);
        if (!Number.isInteger(id) || id <= 0) throw new InputError("Anomalie invalide");
        await rpc("resolve_refund_anomaly", { p_anomaly_id: id, p_by: admin.email });
        data = { ok: true };
        break;
      }
    }

    return json(cors, { success: true, data });
  } catch (error) {
    if (error instanceof InputError) return json(cors, { error: error.message, reason: "input" }, 400);
    const sql = (error as { sql?: { code?: string; message?: string } })?.sql;
    if (sql) return sqlErrorResponse(cors, sql);
    console.error("manage-refunds error:", error);
    return json(cors, { error: "Erreur inattendue. Réessayez.", reason: "server" }, 500);
  }
});
