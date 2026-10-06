// Accès équipe (F23, 2026-10-05) : administratrices OU employée.
//
// Les administratrices (Mel, Eli) passent par requireAdmin, exactement comme
// avant (liste d'emails + session PIN F16) : rien ne change pour elles.
// Une employée (Nahya) est reconnue par sa session Supabase Auth ET une
// ligne active de staff_access (même email, même identifiant de compte) ;
// elle n'a jamais le PIN administrateur. Chaque fonction ouverte à
// l'employée demande un droit précis (« today.view », « orders.view »…) et
// renvoie ses réponses passées par stripFinancial : aucun prix, total,
// frais, remise, cagnotte, montant encaissé ou remboursé, aucune facture,
// aucun lien ou jeton de paiement ni d'action. Seul « payé / non payé »
// reste (paymentPaid). Les fonctions réservées aux administratrices
// continuent d'utiliser requireAdmin seul : une employée y reçoit 401.

import { requireAdmin, type AdminCaller } from "./admin-auth.ts";

export type StaffPermission =
  | "today.view" | "production.view" | "production.update" | "orders.view" | "planning.view"
  | "team.self" | "leave.self" | "manual_orders.draft";

export type StaffCaller =
  | { role: "admin"; email: string; admin: AdminCaller }
  | { role: "employee"; email: string; userId: string; memberId: string; memberName: string | null; permissions: StaffPermission[] };

type Client = {
  auth: { getUser(jwt: string): Promise<{ data: { user: { id?: string; email?: string | null } | null }; error: unknown }> };
  rpc?: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

/** Employée connectée (sans vérifier de droit précis), sinon null. */
export async function employeeCaller(req: Request, supabase: Client): Promise<Extract<StaffCaller, { role: "employee" }> | null> {
  const h = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  const jwt = h.slice(7).trim();
  if (!jwt || typeof supabase.rpc !== "function") return null;
  try {
    const { data, error } = await supabase.auth.getUser(jwt);
    const u = data?.user;
    if (error || !u?.email || !u.id) return null;
    const { data: row, error: e2 } = await supabase.rpc("staff_lookup", { p_email: u.email.toLowerCase(), p_user: u.id });
    if (e2 || !row) return null;
    const r = row as { memberId: string; memberName: string | null; email: string; permissions: StaffPermission[] };
    return { role: "employee", email: r.email, userId: u.id, memberId: r.memberId, memberName: r.memberName ?? null, permissions: r.permissions ?? [] };
  } catch (e) {
    console.error("employeeCaller failed:", e);
    return null;
  }
}

/**
 * Administratrice (toujours autorisée, comme avant) ou employée ayant le
 * droit demandé. null = refusé (répondre 401).
 */
export async function requireStaff(req: Request, supabase: Client, permission: StaffPermission, options: { body?: unknown } = {}): Promise<StaffCaller | null> {
  const admin = await requireAdmin(req, supabase as Parameters<typeof requireAdmin>[1], { body: options.body });
  if (admin) return { role: "admin", email: admin.email, admin };
  const emp = await employeeCaller(req, supabase);
  if (!emp || !emp.permissions.includes(permission)) return null;
  return emp;
}

// ── Aucune donnée financière pour l'employée ─────────────────────────────
// Une clé est supprimée, à toute profondeur, dès qu'un de ses mots
// (découpage snake_case et camelCase, pluriel compris) est financier :
// delivery_fee, unitPrice, manualRefunds, invoiceUrl, actionToken…
const FINANCIAL_WORDS = new Set([
  "price", "pricing", "total", "subtotal", "amount", "fee", "cost", "tarif", "discount", "rebate", "surcharge", "reward", "cashback",
  "point", "voucher", "coupon", "commission", "payout", "refund", "refunded", "collected", "revenue", "invoice", "receipt",
  "postfinance", "wallee", "transaction", "token", "secret", "balance", "net", "gross", "vat", "tva", "iban", "currency", "quote",
  "capture", "deposit", "gesture", "sale", "cash", "payment", "partner", "calculated", "adjustment", "extrasprice",
]);
// Exceptions : clés utiles sans montant.
const KEEP = new Set(["payment_status", "paymentStatus"]);
const keyWords = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
export const isFinancialKey = (k: string) => !KEEP.has(k) && keyWords(k).some((w) => FINANCIAL_WORDS.has(w));

const isPaid = (s: unknown) => s === "paid" || s === "refunded";

/**
 * Copie sans aucune donnée financière. payment_status / paymentStatus est
 * remplacé par « paid » / « unpaid » (et paymentPaid : booléen) ; le statut
 * de remboursement disparaît.
 */
export function stripFinancial<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== "object") return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === "payment_status" || k === "paymentStatus") { out[k] = x == null ? x : isPaid(x) ? "paid" : "unpaid"; out.paymentPaid = x == null ? null : isPaid(x); continue; }
      if (k === "refund_status" || k === "refundStatus") continue;
      if (isFinancialKey(k)) continue;
      out[k] = walk(x);
    }
    return out;
  };
  return walk(value) as T;
}

/** Réponse JSON pour l'appelant : intacte pour une administratrice, sans montants pour l'employée. */
export function forCaller<T>(caller: StaffCaller, body: T): T {
  return caller.role === "admin" ? body : stripFinancial(body);
}
