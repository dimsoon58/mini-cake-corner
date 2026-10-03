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

// ── PIN once per session (F16, 2026-10-03) ─────────────────────────────
// After sign-in, the admin PIN (ADMIN_ORDER_PIN) is checked once by the
// admin-pin function, which returns a random token; only its SHA-256 is
// stored (admin_pin_sessions), bound to the admin email AND the Supabase
// session (JWT claim session_id), with an expiry. The page sends it back in
// the request body as `_adminSession`. requireAdmin still verifies the
// Supabase session + allow-list on EVERY call, then reports whether a valid
// PIN session is attached (pinSession). With the secret
// ADMIN_PIN_SESSION_REQUIRED = "true", a call without a valid PIN session is
// refused like a missing sign-in (except admin-pin itself). The PIN is never
// stored; adminPinOk() also accepts the PIN typed in the request (older
// pages), compared in constant time.

export type AdminCaller = { email: string; pinSession: boolean; pinExpiresAt: string | null; authSessionId: string };

type Client = {
  auth: { getUser(jwt: string): Promise<{ data: { user: { email?: string | null } | null }; error: unknown }> };
  rpc?: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison of two strings (no early exit on the first difference). */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** session_id claim of a JWT already verified by getUser() (payload only, no trust beyond that). */
export function jwtSessionId(jwt: string): string {
  try {
    const part = jwt.split(".")[1] ?? "";
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4)));
    return typeof json?.session_id === "string" ? json.session_id : "";
  } catch {
    return "";
  }
}

async function readSessionToken(req: Request): Promise<string | null> {
  const h = req.headers.get("x-admin-session");
  if (h) return h.trim() || null;
  if (req.method !== "POST") return null;
  try {
    const body = await req.clone().json();
    const t = body?._adminSession;
    return typeof t === "string" && t.length >= 20 && t.length <= 200 ? t : null;
  } catch {
    return null;
  }
}

export const pinSessionRequired = () => Deno.env.get("ADMIN_PIN_SESSION_REQUIRED") === "true";

export async function requireAdmin(
  req: Request,
  supabase: Client,
  options: { allowWithoutPinSession?: boolean } = {},
): Promise<AdminCaller | null> {
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const jwt = authHeader.slice("Bearer ".length).trim();
  if (!jwt) return null;
  let email: string;
  try {
    const { data, error } = await supabase.auth.getUser(jwt);
    if (error || !data?.user?.email) return null;
    email = data.user.email.toLowerCase();
    if (!ADMIN_EMAILS.includes(email)) return null;
  } catch (e) {
    console.error("requireAdmin: getUser threw:", e);
    return null;
  }

  const authSessionId = jwtSessionId(jwt);
  let pinExpiresAt: string | null = null;
  const token = await readSessionToken(req);
  if (token && typeof supabase.rpc === "function") {
    try {
      const { data, error } = await supabase.rpc("admin_pin_check", { p_email: email, p_session: authSessionId, p_token_hash: await sha256Hex(token) });
      if (!error && data) pinExpiresAt = String(data);
    } catch (e) {
      console.error("requireAdmin: admin_pin_check failed:", e);
    }
  }
  const pinSession = pinExpiresAt !== null;
  if (!pinSession && pinSessionRequired() && !options.allowWithoutPinSession) return null;
  return { email, pinSession, pinExpiresAt, authSessionId };
}

/** Protected action: a valid PIN session, or the PIN typed with the request. */
export function adminPinOk(admin: AdminCaller | null, typedPin: unknown): boolean {
  if (!admin) return false;
  if (admin.pinSession) return true;
  const pin = Deno.env.get("ADMIN_ORDER_PIN");
  return !!pin && typeof typedPin === "string" && safeEqual(typedPin, pin);
}
