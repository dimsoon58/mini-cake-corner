import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
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
import { WORKSHOP_PRICE_PER_PERSON } from "@/data/workshopSessions";
import { cn } from "@/lib/utils";

// F37 (03.11.2026) — « Bon cadeau » : the buyer chooses a free amount
// (CHF 20 – 500), their name and email, optionally the recipient's first
// name and a short message, then pays with PostFinance
// (create-gift-card-payment). The voucher (code + PDF) is emailed to the
// buyer after payment. Usable on the whole site, valid 12 months.

const MIN = 20;
const MAX = 500;
const MESSAGE_MAX = 200;
// F40 — « Offrir un workshop »: bought for one workshop and 1–6 places;
// whoever receives it can book any workshop (workshops only).
type WorkshopKey = "piping" | "signature" | "paint";
const WORKSHOP_CHOICES: { id: WorkshopKey; fr: string; en: string }[] = [
  { id: "piping", fr: "Pochage", en: "Piping" },
  { id: "signature", fr: "Signature", en: "Signature" },
  { id: "paint", fr: "Paint", en: "Paint" },
];
const MAX_PLACES = 6;

const GiftCard = () => {
  useSeo({
    title: "Bon cadeau Bento Cake Studio Genève | Gâteaux & Workshops",
    description: "Offrez un bon cadeau Bento Cake Studio : le montant de votre choix, valable 12 mois sur tout le site, pour les bento cakes, les workshops et plus, à Genève.",
    canonical: "https://bentocakestudio.ch/bon-cadeau",
  });
  const { t, lang } = useLang();
  const { user } = useAuth();
  const { visible, preview, loading } = useGiftCardsVisible();
  const [params] = useSearchParams();
  const presetWorkshop = WORKSHOP_CHOICES.find((w) => w.id === params.get("workshop"))?.id ?? null;
  const [kind, setKind] = useState<"amount" | "workshop">(presetWorkshop ? "workshop" : "amount");
  const [workshopType, setWorkshopType] = useState<WorkshopKey>(presetWorkshop ?? "signature");
  const [places, setPlaces] = useState(1);
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

  const value = kind === "workshop"
    ? WORKSHOP_PRICE_PER_PERSON[workshopType] * places
    : Math.round(Number(amount.replace(",", ".")) * 100) / 100;
  const amountOk = kind === "workshop" || (Number.isFinite(value) && value >= MIN && value <= MAX);
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
        body: kind === "workshop"
          ? { kind, workshopType, places, buyerName, buyerEmail, recipientName, message, lang, acceptTerms: true }
          : { kind, amount: value, buyerName, buyerEmail, recipientName, message, lang, acceptTerms: true },
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
          {t("Preview, visible to the team only, not online yet", "Aperçu, visible uniquement par l’équipe, pas encore en ligne")}
        </div>
      )}
      <section className="container mx-auto px-4 py-12 max-w-2xl">
        <h1 className="font-sans text-4xl md:text-5xl text-center tracking-[0.105em] uppercase text-foreground mb-6 font-semibold">
          {t("Gift card", "Bon cadeau")}
        </h1>
        <p className="text-center text-muted-foreground mb-8 max-w-2xl mx-auto text-sm md:text-base">
          {t(
            "Give a sweet moment: a Bento Cake Studio gift card, for the amount of your choice or for a workshop. It is valid for 12 months.",
            "Offrez un moment tout en douceur : un bon cadeau Bento Cake Studio, du montant de votre choix ou pour un workshop. Il est valable 12 mois.",
          )}
        </p>

        {paymentFailed && (
          <p role="alert" className="mb-6 border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm text-foreground">
            {t("The payment did not go through. Nothing was charged, you can try again.", "Le paiement n'a pas abouti. Rien n'a été prélevé, vous pouvez réessayer.")}
          </p>
        )}

        <form onSubmit={submit} className="space-y-6 border border-border/60 bg-background p-5 sm:p-8">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("Kind of gift card", "Type de bon cadeau")}>
            {([["amount", t("An amount", "Un montant")], ["workshop", t("A workshop", "Un workshop")]] as const).map(([k, text]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => { setKind(k); setError(null); }}
                className={cn("border px-3 py-3 text-sm uppercase tracking-[0.105em] font-medium",
                  kind === k ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:border-primary")}
              >
                {text}
              </button>
            ))}
          </div>

          {kind === "amount" ? (
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
              {t(`Any amount from CHF ${MIN} to CHF ${MAX}, to use on the whole site.`, `Le montant de votre choix, de CHF ${MIN} à CHF ${MAX}, à utiliser sur tout le site.`)}
            </p>
          </div>
          ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="gc-workshop" className={label}>{t("Workshop", "Workshop")} {star}</Label>
                <select
                  id="gc-workshop"
                  value={workshopType}
                  onChange={(e) => setWorkshopType(e.target.value as WorkshopKey)}
                  className="h-10 w-full border border-input bg-background px-3 text-sm"
                >
                  {WORKSHOP_CHOICES.map((w) => (
                    <option key={w.id} value={w.id}>{t(w.en, w.fr)} (CHF {WORKSHOP_PRICE_PER_PERSON[w.id]} {t("per person", "par personne")})</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="gc-places" className={label}>{t("Spots", "Places")} {star}</Label>
                <select
                  id="gc-places"
                  value={places}
                  onChange={(e) => setPlaces(Number(e.target.value))}
                  className="h-10 w-full border border-input bg-background px-3 text-sm"
                >
                  {Array.from({ length: MAX_PLACES }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{n} {n > 1 ? t("spots", "places") : t("spot", "place")}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                `Value CHF ${value}. Whoever receives it can book the workshop of their choice (Piping, Signature or Paint): if it costs more, the difference is paid by card; any remaining balance stays on the code. Workshops only.`,
                `Valeur CHF ${value}. La personne qui le reçoit peut réserver le workshop de son choix (Pochage, Signature ou Paint) : s'il coûte plus, la différence se paie par carte ; le solde éventuel reste sur le code. Valable uniquement sur les workshops.`,
              )}
            </p>
          </div>
          )}

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
                kind === "workshop"
                  ? "I accept the gift card conditions: valid 12 months from the purchase date, usable on workshops only (the remaining balance stays on the code), not refundable and not exchangeable for cash."
                  : "I accept the gift card conditions: valid 12 months from the purchase date, usable on the whole site (the remaining balance stays on the code), not refundable and not exchangeable for cash.",
                kind === "workshop"
                  ? "J'accepte les conditions des bons cadeaux : valable 12 mois à partir de la date d'achat, utilisable uniquement sur les workshops (le solde reste sur le code), non remboursable et non échangeable contre des espèces."
                  : "J'accepte les conditions des bons cadeaux : valable 12 mois à partir de la date d'achat, utilisable sur tout le site (le solde reste sur le code), non remboursable et non échangeable contre des espèces.",
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
