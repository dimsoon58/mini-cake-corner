// Frontend-side admin check — purely a UX gate (redirect to /login, show
// "access denied") so a non-admin never sees the admin UI flash on screen.
// The REAL enforcement lives server-side in every admin Edge Function (see
// supabase/functions/_shared/admin-auth.ts) — this list existing here does
// not grant any access by itself. Same emails as the backend copy and the
// existing notification-recipient lists (notify-order/index.ts,
// _shared/admin-alert.ts) — keep all in sync if this ever changes.
const ADMIN_EMAILS = ["naglemelodie@gmail.com", "e.potapushina@gmail.com"];

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}
