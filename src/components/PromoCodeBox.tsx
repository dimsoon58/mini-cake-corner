import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCart } from "@/context/CartContext";
import { useLang } from "@/context/LanguageContext";

// F35 (03.11.2026) — « Code promo » in the cart summary (influencer codes).
// The code is checked by resolve-partner-ref, then carried to the payment
// like a partner link; create-postfinance-payment re-checks it and computes
// the real discount. Display only here.
export default function PromoCodeBox({ discountAmount, welcomeAvailable }: { discountAmount: number; welcomeAvailable: boolean }) {
  const { t } = useLang();
  const { partnerReferral, applyPromoCode, removePartnerReferral } = useCart();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await applyPromoCode(code);
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

  // A code is active: show it with a way to remove it (the customer chooses
  // between the code and the welcome discount, never both).
  if (partnerReferral?.code) {
    return (
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
    );
  }

  // A partner link is active: no field (one benefit per order).
  if (partnerReferral) return null;

  return (
    <div className="space-y-1">
      <form
        className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); void apply(); }}
      >
        <Input
          value={code}
          onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }}
          placeholder={t("Promo code", "Code promo")}
          aria-label={t("Promo code", "Code promo")}
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={20}
          className="h-9 rounded-none uppercase"
        />
        <Button type="submit" variant="outline" size="sm" className="h-9 rounded-none" disabled={busy || !code.trim()}>
          {busy ? t("Checking…", "Vérification…") : t("Apply", "Appliquer")}
        </Button>
      </form>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
