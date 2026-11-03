import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import { CHRISTMAS_PUBLIC } from "@/lib/featureFlags";

/**
 * Whether the Christmas collection is shown to the current visitor: everyone
 * once CHRISTMAS_PUBLIC is on, otherwise only a signed-in admin (preview).
 * `loading` is true while the session is still being restored, so the page
 * doesn't redirect an admin before her session is known.
 */
export function useChristmasVisible(): { visible: boolean; preview: boolean; loading: boolean } {
  const { user, loading } = useAuth();
  if (CHRISTMAS_PUBLIC) return { visible: true, preview: false, loading: false };
  const admin = isAdminEmail(user?.email);
  return { visible: admin, preview: admin, loading };
}
