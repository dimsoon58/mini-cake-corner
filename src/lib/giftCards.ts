import { supabase } from "@/integrations/supabase/client";

// F39 (03.11.2026) — Admin › Bons cadeaux: calls to manage-gift-cards.

export type GiftCardUse = {
  orderId: string; orderNumber: string | null; amount: number; recredited: number;
  status: "reserved" | "consumed" | "recredited"; at: string; customer: string | null;
};
export type GiftCardEvent = { action: string; amount: number | null; orderId: string | null; detail: Record<string, unknown>; actor: string | null; at: string };
export type AdminGiftCard = {
  id: string; code: string; initialAmount: number; balance: number; status: "active" | "disabled"; source: "online" | "manual";
  buyerName: string; buyerEmail: string | null; recipientName: string | null; message: string | null; note: string | null;
  lang: "fr" | "en"; kind: "amount" | "workshop"; workshopType: string | null; workshopPlaces: number | null; paidAt: string | null; expiresAt: string; createdAt: string; createdBy: string | null;
  emailStatus: string; emailSentAt: string | null; expired: boolean; uses: GiftCardUse[]; events: GiftCardEvent[];
};
export type GiftCardSummary = {
  from: string; to: string;
  sold: { count: number; amount: number }; manual: { count: number; amount: number };
  used: number; expiredUnused: number; outstanding: number; outstandingCount: number;
};
export type OrderGiftCard = {
  giftCardId: string; code: string; amount: number; recredited: number;
  status: "reserved" | "consumed" | "released" | "recredited"; balance: number; expiresAt: string;
} | null;

export class GiftCardsError extends Error {
  reason: string | null;
  constructor(message: string, reason: string | null) {
    super(message);
    this.reason = reason;
  }
}

export async function giftCardsApi<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("manage-gift-cards", { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let j: { error?: string; reason?: string } | null = null;
    try { j = await ctx?.json(); } catch { /* not JSON */ }
    if (ctx?.status === 404 && !j?.reason) throw new GiftCardsError("La fonction manage-gift-cards n'est pas encore déployée.", "not_deployed");
    throw new GiftCardsError(j?.error || "Erreur inattendue. Réessayez.", j?.reason ?? null);
  }
  if (data?.error) throw new GiftCardsError(String(data.error), data.reason ?? null);
  return (data?.data ?? null) as T;
}

/** What a voucher is right now, for the badge. */
export function giftCardState(c: Pick<AdminGiftCard, "status" | "expired" | "balance">): { label: string; cls: string } {
  if (c.status === "disabled") return { label: "Désactivé", cls: "border-border text-muted-foreground" };
  if (c.expired) return { label: "Expiré", cls: "border-amber-300 bg-amber-50 text-amber-900" };
  if (c.balance <= 0) return { label: "Utilisé", cls: "border-sky-300 bg-sky-50 text-sky-900" };
  return { label: "Actif", cls: "border-emerald-300 bg-emerald-50 text-emerald-900" };
}

export const WORKSHOP_VOUCHER_NAMES: Record<string, string> = { signature: "Signature", piping: "Pochage", paint: "Paint" };
/** « Workshop Signature, 2 places » for a workshop voucher, null otherwise. */
export function workshopVoucherLabel(c: Pick<AdminGiftCard, "kind" | "workshopType" | "workshopPlaces">): string | null {
  if (c.kind !== "workshop" || !c.workshopType) return null;
  const n = c.workshopPlaces ?? 1;
  return `Workshop ${WORKSHOP_VOUCHER_NAMES[c.workshopType] ?? c.workshopType}, ${n} place${n > 1 ? "s" : ""}`;
}

export function downloadBase64Pdf(filename: string, base64: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
