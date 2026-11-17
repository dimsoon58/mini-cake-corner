import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GIFT_CARD_CODE_RE, useCart } from "@/context/CartContext";
import { useLang } from "@/context/LanguageContext";
import { formatChf } from "@/lib/money";

// F35 (03.11.2026) — « Code promo » in the cart summary (influencer codes).
// The code is checked by resolve-partner-ref, then carried to the payment
// like a partner link; create-postfinance-payment re-checks it and computes
// the real discount. Display only here.
// F38 (03.11.2026) — the same field also takes a gift voucher
// (BCS-XXXX-XXXX), checked by check-gift-card. A voucher can be combined
// with a promo code or a partner link (it is a means of payment).

const formatDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
};

export default function PromoCodeBox({ discountAmount, welcomeAvailable }: { discountAmount: number; welcomeAvailable: boolean }) {
  const { t } = useLang();
  const { partnerReferral, applyPromoCode, removePartnerReferral, giftCard, applyGiftCard, removeGiftCard, items } = useCart();
  const workshopTotal = items.filter((i) => i.product === "workshop").reduce((sum, i) => sum + (Number(i.total) || 0), 0);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async () => {
    const typed = code.trim().toUpperCase();
    if (!typed || busy) return;
    setError(null);

    if (GIFT_CARD_CODE_RE.test(typed)) {
      if (giftCard) { setError(t("A gift card is already applied. Remove it to use another one.", "Un bon cadeau est déjà appliqué. Retirez-le pour en utiliser un autre.")); return; }
      setBusy(true);
      const res = await applyGiftCard(typed);
      setBusy(false);
      if (res.ok) { setCode(""); return; }
      const reason = "reason" in res ? res.reason : "unknown";
      setError(
        reason === "expired" ? t("This gift card has expired.", "Ce bon cadeau a expiré.")
          : reason === "empty" ? t("This gift card has no balance left.", "Ce bon cadeau n'a plus de solde.")
          : reason === "disabled" ? t("This gift card is no longer valid.", "Ce bon cadeau n'est plus valable.")
          : reason === "error" ? t("The code couldn't be checked. Please try again.", "Le code n'a pas pu être vérifié. Réessayez.")
          : t("Unknown code.", "Code inconnu."),
      );
      return;
    }

    if (partnerReferral) {
      setError(t("A promo code is already applied: one per order.", "Un code promo est déjà appliqué : un seul par commande."));
      return;
    }
    setBusy(true);
    const res = await applyPromoCode(typed);
    setBusy(false);
    if (res.ok) { setCode(""); return; }
    const reason = "reason" in res ? res.reason : "invalid";
    setError(
      reason === "expired" ? t("This code has expired.", "Ce code a expiré.")
        : reason === "not_started" ? t("This code is not valid yet.", "Ce code n'est pas encore valable.")
        : reason === "error" ? t("The code couldn't be checked. Please try again.", "Le code n'a pas pu être vérifié. Réessayez.")
        : t("Unknown code.", "Code inconnu."),
    );
  };

  // Field shown while something can still be added: a voucher, or (without
  // a partner link / code) a promo code.
  const showField = !giftCard || !partnerReferral;

  return (
    <div className="space-y-2">
      {/* A promo code is active: show it with a way to remove it (the customer
          chooses between the code and the welcome discount, never both). */}
      {partnerReferral?.code && (
        <div className="space-y-1 text-xs text-muted-foreground">
          {discountAmount <= 0 && (
            <p className="text-amber-800">
              {t("This code doesn't apply to the items in your cart.", "Ce code ne s'applique à aucun article de votre panier.")}
            </p>
          )}
          {welcomeAvailable && (
            <p>
              {t(
                "The code replaces your -10% welcome discount (they can't be combined). Remove the code to use the welcome discount instead.",
                "Le code remplace votre rabais de bienvenue de -10 % (non cumulables). Retirez le code pour utiliser le rabais de bienvenue.",
              )}
            </p>
          )}
          <button type="button" onClick={removePartnerReferral} className="underline hover:text-foreground">
            {t(`Remove the code ${partnerReferral.code}`, `Retirer le code ${partnerReferral.code}`)}
          </button>
        </div>
      )}

      {giftCard && (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>
            {t(
              `${giftCard.kind === "workshop" ? "Workshop gift card" : "Gift card"} ${giftCard.code}: CHF ${formatChf(giftCard.balance)} available${giftCard.expiresAt ? `, valid until ${formatDate(giftCard.expiresAt)}` : ""}.`,
              `${giftCard.kind === "workshop" ? "Bon cadeau workshop" : "Bon cadeau"} ${giftCard.code} : CHF ${formatChf(giftCard.balance)} disponible${giftCard.expiresAt ? `, valable jusqu'au ${formatDate(giftCard.expiresAt)}` : ""}.`,
            )}
          </p>
          {giftCard.kind === "workshop" && (
            <p className={workshopTotal > 0 ? "" : "text-amber-800"}>
              {workshopTotal > 0
                ? t("Valid on workshops only.", "Valable uniquement sur les workshops.")
                : t("This gift card is valid on workshops only: add a workshop to your cart to use it.", "Ce bon est valable uniquement sur les workshops : ajoutez un workshop à votre panier pour l'utiliser.")}
            </p>
          )}
          <button type="button" onClick={removeGiftCard} className="underline hover:text-foreground">
            {t("Remove the gift card", "Retirer le bon cadeau")}
          </button>
        </div>
      )}

      {showField && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void apply(); }}>
          <Input
            value={code}
            onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }}
            placeholder={giftCard ? t("Promo code", "Code promo") : partnerReferral ? t("Gift card code", "Code du bon cadeau") : t("Promo code or gift card", "Code promo ou bon cadeau")}
            aria-label={t("Promo code or gift card", "Code promo ou bon cadeau")}
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={20}
            className="h-9 rounded-none uppercase"
          />
          <Button type="submit" variant="outline" size="sm" className="h-9 rounded-none" disabled={busy || !code.trim()}>
            {busy ? t("Checking…", "Vérification…") : t("Apply", "Appliquer")}
          </Button>
        </form>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
