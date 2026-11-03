import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import { GIFT_CARDS_PUBLIC } from "@/lib/featureFlags";

/**
 * Whether the gift card page and its links are shown: everyone once
 * GIFT_CARDS_PUBLIC is on, otherwise only a signed-in admin (preview).
 * Same shape as useChristmasVisible.
 */
export function useGiftCardsVisible(): { visible: boolean; preview: boolean; loading: boolean } {
  const { user, loading } = useAuth();
  if (GIFT_CARDS_PUBLIC) return { visible: true, preview: false, loading: false };
  const admin = isAdminEmail(user?.email);
  return { visible: admin, preview: admin, loading };
}
