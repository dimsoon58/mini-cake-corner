import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import { CHRISTMAS_PUBLIC } from "@/lib/featureFlags";

// 14 novembre 2026 à 09h00 heure suisse (CET = UTC+1 en novembre)
export const CHRISTMAS_LAUNCH = new Date("2026-11-14T08:00:00Z");

/**
 * Whether the Christmas collection is shown to the current visitor.
 * - After the launch date : visible to everyone.
 * - Before the launch date : visible only to signed-in admins (preview mode).
 * - `preview` is true when an admin is viewing before the launch (noindex).
 * - `launched` reflects whether the launch time has already passed.
 *
 * CHRISTMAS_PUBLIC in featureFlags.ts acts as a manual emergency override.
 */
export function useChristmasVisible(): {
  visible: boolean;
  preview: boolean;
  launched: boolean;
  loading: boolean;
} {
  const { user, loading } = useAuth();
  const launched = CHRISTMAS_PUBLIC || Date.now() >= CHRISTMAS_LAUNCH.getTime();
  const admin = isAdminEmail(user?.email);
  return {
    visible: launched || admin,
    preview: admin && !launched,
    launched,
    loading,
  };
}
