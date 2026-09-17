// Shared "is this caller a logged-in admin?" check, used by every Edge
// Function behind the admin dashboard / order-detail page (get-order-detail,
// manage-order's PIN-gated branches, list-orders). NEVER used by the
// token-only Accept/Refuse email-link flow (manage-order's no-PIN branch,
// OrderAction.tsx) — that stays exactly as it was, no login required, so the
// one-click links in the notification email keep working unchanged.
//
// Mechanism: the frontend's shared Supabase client automatically attaches
// the signed-in user's session JWT as the Authorization header on every
// supabase.functions.invoke() call once someone is logged in (same client
// AuthContext uses for customer login — this reuses that, not a separate
// "admin account" system). We verify that JWT against Supabase Auth via
// getUser(), then check the resulting email against the same admin
// allow-list already used elsewhere to decide who receives order
// notifications (notify-order/index.ts, _shared/admin-alert.ts) — kept as
// its own copy here (Deno function, no shared module import across
// functions), update all three together if this list ever changes.
//
// A request with no session (or the anon-key JWT the client sends by
// default when signed out) simply fails getUser() with no matching user —
// same "not an admin" outcome as a wrong email, no special-casing needed.
const ADMIN_EMAILS = ["naglemelodie@gmail.com", "e.potapushina@gmail.com"];

export async function requireAdmin(
  req: Request,
  supabase: { auth: { getUser(jwt: string): Promise<{ data: { user: { email?: string | null } | null }; error: unknown }> } },
): Promise<{ email: string } | null> {
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const jwt = authHeader.slice("Bearer ".length).trim();
  if (!jwt) return null;
  try {
    const { data, error } = await supabase.auth.getUser(jwt);
    if (error || !data?.user?.email) return null;
    const email = data.user.email.toLowerCase();
    if (!ADMIN_EMAILS.includes(email)) return null;
    return { email };
  } catch (e) {
    console.error("requireAdmin: getUser threw:", e);
    return null;
  }
}
