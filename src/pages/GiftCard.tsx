import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Gift, Loader2 } from "lucide-react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useSeo } from "@/hooks/useSeo";
import { useGiftCardsVisible } from "@/hooks/useGiftCardsVisible";
import { extractFunctionErrorMessage } from "@/lib/functionErrors";

// F37 (03.11.2026) — « Bon cadeau » : the buyer chooses a free amount
// (CHF 20 – 500), their name and email, optionally the recipient's first
// name and a short message, then pays with PostFinance
// (create-gift-card-payment). The voucher (code + PDF) is emailed to the
// buyer after payment. Usable on the whole site, valid 12 months.

const MIN = 20;
const MAX = 500;
const MESSAGE_MAX = 200;

const GiftCard = () => {
  useSeo({
    title: "Bon cadeau Bento Cake Studio Genève | Gâteaux & Workshops",
    description: "Offrez un bon cadeau Bento Cake Studio : le montant de votre choix, valable 12 mois sur tout le site — bento cakes, workshops et plus, à Genève.",
    canonical: "https://bentocakestudio.ch/bon-cadeau",
  });
  const { t, lang } = useLang();
  const { user } = useAuth();
  const { visible, preview, loading } = useGiftCardsVisible();
  const [params] = useSearchParams();
  const [amount, setAmount] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [message, setMessage] = useState("");
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.email && !buyerEmail) setBuyerEmail(user.email);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  // Page cachée aux moteurs de recherche tant qu'elle n'est pas publique.
  useEffect(() => {
    if (!preview) return;
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, [preview]);

  if (loading) return <Layout><div className="min-h-[60vh]" /></Layout>;
  if (!visible) return <Navigate to="/" replace />;

  const value = Math.round(Number(amount.replace(",", ".")) * 100) / 100;
  const amountOk = Number.isFinite(value) && value >= MIN && value <= MAX;
  const shown = amountOk ? (Number.isInteger(value) ? String(value) : value.toFixed(2)) : null;
  const paymentFailed = params.get("payment") === "failed";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!amountOk) { setError(t(`Choose an amount between CHF ${MIN} and ${MAX}.`, `Choisissez un montant entre CHF ${MIN} et ${MAX}.`)); return; }
    if (!buyerName.trim()) { setError(t("Please enter your name.", "Merci d'indiquer votre nom.")); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(buyerEmail.trim())) { setError(t("Please enter a valid email address.", "Merci d'indiquer une adresse email valide.")); return; }
    if (!accept) { setError(t("Please accept the gift card conditions.", "Merci d'accepter les conditions des bons cadeaux.")); return; }
    setBusy(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("create-gift-card-payment", {
        body: { amount: value, buyerName, buyerEmail, recipientName, message, lang, acceptTerms: true },
      });
      if (fnError) throw new Error(await extractFunctionErrorMessage(fnError, t("We couldn't start the payment. Please try again.", "Nous n'avons pas pu démarrer le paiement. Merci de réessayer.")));
      if (!data?.paymentPageUrl) throw new Error(data?.error ?? t("We couldn't start the payment. Please try again.", "Nous n'avons pas pu démarrer le paiement. Merci de réessayer."));
      window.location.href = data.paymentPageUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const label = "text-[14px] font-semibold text-foreground";
  const star = <span className="text-destructive">*</span>;

  return (
    <Layout>
      {preview && (
        <div className="bg-foreground text-cream text-center text-xs tracking-[0.12em] uppercase px-4 py-2">
          {t("Preview — visible to the team only, not online yet", "Aperçu — visible uniquement par l’équipe, pas encore en ligne")}
        </div>
      )}
      <section className="container mx-auto px-4 sm:px-6 py-10 md:py-16 max-w-2xl">
        <div className="text-center mb-8">
          <Gift className="w-8 h-8 text-primary mx-auto mb-3" strokeWidth={1.5} />
          <h1 className="font-sans text-3xl md:text-4xl tracking-[0.105em] uppercase text-foreground mb-4 font-semibold">
            {t("Gift card", "Bon cadeau")}
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            {t(
              "Give a sweet moment: a Bento Cake Studio gift card, for the amount of your choice. It can be used on the whole site — cakes, workshops and more — and is valid for 12 months.",
              "Offrez un moment tout en douceur : un bon cadeau Bento Cake Studio, du montant de votre choix. Il s'utilise sur tout le site (gâteaux, workshops et plus) et il est valable 12 mois.",
            )}
          </p>
        </div>

        {paymentFailed && (
          <p role="alert" className="mb-6 border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm text-foreground">
            {t("The payment did not go through. Nothing was charged — you can try again.", "Le paiement n'a pas abouti. Rien n'a été prélevé, vous pouvez réessayer.")}
          </p>
        )}

        <form onSubmit={submit} className="space-y-6 border border-border/60 bg-background p-5 sm:p-8">
          <div className="space-y-2">
            <Label htmlFor="gc-amount" className={label}>{t("Amount (CHF)", "Montant (CHF)")} {star}</Label>
            <Input
              id="gc-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.,]/g, "")); setError(null); }}
              placeholder={t(`From ${MIN} to ${MAX}`, `De ${MIN} à ${MAX}`)}
              className="rounded-none text-lg"
            />
            <p className="text-xs text-muted-foreground">
              {t(`Any amount from CHF ${MIN} to CHF ${MAX}. For example, a workshop place costs CHF 65 to 85.`, `Le montant de votre choix, de CHF ${MIN} à CHF ${MAX}. Par exemple, une place de workshop coûte CHF 65 à 85.`)}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="gc-name" className={label}>{t("Your name", "Votre nom")} {star}</Label>
              <Input id="gc-name" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} maxLength={120} autoComplete="name" className="rounded-none" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gc-email" className={label}>{t("Your email", "Votre email")} {star}</Label>
              <Input id="gc-email" type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} maxLength={254} autoComplete="email" className="rounded-none" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-3">
            {t("The gift card (PDF) is sent to this address, so you can print it or forward it.", "Le bon cadeau (PDF) est envoyé à cette adresse : vous pouvez l'imprimer ou le transmettre.")}
          </p>

          <div className="space-y-2">
            <Label htmlFor="gc-recipient" className={label}>{t("Recipient's first name (optional)", "Prénom de la personne qui le reçoit (facultatif)")}</Label>
            <Input id="gc-recipient" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} maxLength={80} className="rounded-none" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="gc-message" className={label}>{t("A few words (optional)", "Un petit mot (facultatif)")}</Label>
            <textarea
              id="gc-message"
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX))}
              rows={3}
              placeholder={t("Happy birthday!", "Joyeux anniversaire !")}
              className="w-full border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
            />
            <p className="text-xs text-muted-foreground text-right">{message.length} / {MESSAGE_MAX}</p>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox id="gc-terms" checked={accept} onCheckedChange={(c) => { setAccept(c === true); setError(null); }} className="mt-0.5" />
            <Label htmlFor="gc-terms" className="text-sm font-normal leading-snug cursor-pointer">
              {t(
                "I accept the gift card conditions: valid 12 months from the purchase date, usable on the whole site (the remaining balance stays on the code), not refundable and not exchangeable for cash.",
                "J'accepte les conditions des bons cadeaux : valable 12 mois à partir de la date d'achat, utilisable sur tout le site (le solde reste sur le code), non remboursable et non échangeable contre des espèces.",
              )} {star}
            </Label>
          </div>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          <Button type="submit" disabled={busy} className="w-full rounded-none uppercase tracking-[0.105em]">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : shown ? t(`Pay CHF ${shown}`, `Payer CHF ${shown}`) : t("Pay", "Payer")}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            {t("Secure payment with PostFinance. The gift card is sent by email right after payment.", "Paiement sécurisé avec PostFinance. Le bon cadeau est envoyé par email juste après le paiement.")}
          </p>
        </form>
      </section>
    </Layout>
  );
};

export default GiftCard;
