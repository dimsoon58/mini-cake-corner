import { useState, useEffect } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { Clock, Users, MapPin, Check, ChevronLeft, ChevronRight, Calendar, Info as InfoIcon, CreditCard } from "lucide-react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useLang } from "@/context/LanguageContext";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { useCart } from "@/context/CartContext";
import { PrivateWorkshopDialog } from "@/components/PrivateWorkshopDialog";
import { useWorkshopAvailability } from "@/hooks/useWorkshopAvailability";
import {
  WorkshopType,
  WorkshopSession,
  workshopInfo,
  getSessionsForType,
  spotsLeft,
  formatSessionDate,
  WORKSHOP_PRICE_PER_PERSON,
} from "@/data/workshopSessions";

// ── Stepper ──────────────────────────────────────────────────────────────────
const STEPS = [
  { icon: Calendar, labelEn: "Date", labelFr: "Date" },
  { icon: Users, labelEn: "Participants", labelFr: "Participants" },
  { icon: InfoIcon, labelEn: "Information", labelFr: "Informations" },
  { icon: CreditCard, labelEn: "Confirm", labelFr: "Confirmation" },
];

const Stepper = ({ current }: { current: number }) => (
  <div className="flex items-center justify-center gap-0 mb-10">
    {STEPS.map((s, i) => {
      const done = i < current;
      const active = i === current;
      return (
        <div key={s.labelEn} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className={`w-9 h-9 flex items-center justify-center border transition-colors
                ${done ? "bg-primary border-primary text-primary-foreground"
                  : active ? "bg-primary border-primary text-primary-foreground"
                  : "bg-background border-border text-muted-foreground"}`}
            >
              {done ? <Check className="w-4 h-4" /> : <s.icon className="w-4 h-4" />}
            </div>
            <span className={`text-[10px] uppercase tracking-wider mt-1 hidden sm:block
              ${active ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
              {s.labelEn}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`w-12 md:w-20 h-px mx-1 mt-[-14px] sm:mt-[-24px] transition-colors
              ${i < current ? "bg-primary" : "bg-border"}`} />
          )}
        </div>
      );
    })}
  </div>
);

// ── Main ──────────────────────────────────────────────────────────────────────
const WorkshopBooking = () => {
  const { t, lang } = useLang();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { addItem } = useCart();

  const typeParam = searchParams.get("type") as WorkshopType | null;
  const workshopType: WorkshopType = typeParam === "paint" ? "paint" : "signature";
  const info = workshopInfo[workshopType];
  const sessions = getSessionsForType(workshopType);

  // Server-authoritative availability. Re-read on mount and again right before
  // Add to cart; the payment step revalidates server-side once more.
  const { bySession, loading: availLoading, refresh: refreshAvailability } = useWorkshopAvailability();

  const [step, setStep] = useState(0);
  const [selectedSession, setSelectedSession] = useState<WorkshopSession | null>(null);
  const [participants, setParticipants] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);

  // Booking-level info (not per participant).
  const [comment, setComment] = useState("");
  const [hasMinor, setHasMinor] = useState<boolean | null>(null);
  const [minorConsent, setMinorConsent] = useState(false);
  const [minorError, setMinorError] = useState<string | null>(null);

  useEffect(() => {
    document.title = t(
      `Book – ${info.title} – Bento Cake Studio`,
      `Réserver – ${info.titleFr} – Bento Cake Studio`
    );
  }, [info, t]);

  // Seats left for a session: live count when we have it, else the static
  // catalogue capacity as a safe fallback.
  const remainingFor = (sessionId: string, fallback: number): number => {
    const row = bySession[sessionId];
    if (!row) return fallback;
    if (!row.is_open) return 0;
    return row.remaining_seats;
  };
  const sessionSelectable = (s: WorkshopSession): boolean =>
    remainingFor(s.id, spotsLeft(s)) > 0;

  const selectedRemaining = selectedSession
    ? remainingFor(selectedSession.id, spotsLeft(selectedSession))
    : 0;
  const maxAllowed = Math.max(
    1,
    Math.min(info.maxParticipants, selectedSession ? selectedRemaining : info.maxParticipants),
  );

  // Keep participants inside the allowed range whenever it shrinks.
  useEffect(() => {
    setParticipants((p) => Math.min(Math.max(1, p), maxAllowed));
  }, [maxAllowed]);

  const total = selectedSession
    ? selectedSession.pricePerPerson * participants
    : info.pricePerPerson * participants;

  // ── Step 0: choose date ───────────────────────────────────────────────────
  const Step0 = () => (
    <div>
      <h2 className="font-sans uppercase tracking-[0.105em] text-lg text-foreground mb-6">
        {t("Select a date", "Choisissez une date")}
      </h2>
      {sessions.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("No upcoming sessions available. Please check back soon.", "Aucune session à venir disponible. Revenez bientôt.")}
        </p>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => {
            const left = remainingFor(s.id, spotsLeft(s));
            const full = left <= 0;
            const selected = selectedSession?.id === s.id;
            return (
              <button
                key={s.id}
                disabled={full}
                onClick={() => setSelectedSession(s)}
                className={`w-full text-left border p-4 transition-colors flex items-center justify-between gap-4
                  ${full ? "border-border bg-muted/40 opacity-50 cursor-not-allowed"
                    : selected ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/60 bg-card"}`}
              >
                <div>
                  <p className={`text-sm font-medium capitalize ${selected ? "text-primary" : "text-foreground"}`}>
                    {formatSessionDate(s.date, lang === "fr" ? "fr" : "en")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {s.time} · {t(info.duration, info.durationFr)}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  {full ? (
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">
                      {t("Sold out", "Complet")}
                    </span>
                  ) : (
                    <>
                      <p className={`text-sm font-semibold ${left <= 2 ? "text-destructive" : "text-foreground"}`}>
                        {left === 1
                          ? t("1 spot remaining", "1 place restante")
                          : t(`${left} spots remaining`, `${left} places restantes`)}
                      </p>
                      {selected && <Check className="w-4 h-4 text-primary ml-auto mt-1" />}
                    </>
                  )}
                </div>
              </button>
            );
          })}
          {availLoading && (
            <p className="text-xs text-muted-foreground">{t("Checking availability…", "Vérification des disponibilités…")}</p>
          )}
        </div>
      )}
    </div>
  );

  // ── Step 1: participants ──────────────────────────────────────────────────
  const Step1 = () => {
    const atLimit = participants >= maxAllowed;
    const cappedBySeats = selectedSession && maxAllowed < info.maxParticipants;
    return (
      <div>
        <h2 className="font-sans uppercase tracking-[0.105em] text-lg text-foreground mb-6">
          {t("Number of participants", "Nombre de participants")}
        </h2>
        <div className="flex items-center gap-6 mb-6">
          <button
            onClick={() => setParticipants(Math.max(1, participants - 1))}
            className="w-10 h-10 border border-border flex items-center justify-center text-foreground hover:border-primary transition-colors text-xl"
          >
            −
          </button>
          <span className="text-3xl font-light text-foreground w-8 text-center">{participants}</span>
          <button
            onClick={() => setParticipants(Math.min(maxAllowed, participants + 1))}
            disabled={atLimit}
            className="w-10 h-10 border border-border flex items-center justify-center text-foreground hover:border-primary transition-colors text-xl disabled:opacity-30 disabled:hover:border-border"
          >
            +
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-2">
          {cappedBySeats
            ? t(`${maxAllowed} seat(s) left for this session.`, `${maxAllowed} place(s) restante(s) pour cette session.`)
            : t(`Maximum ${info.maxParticipants} participants per booking.`, `Maximum ${info.maxParticipants} participants par réservation.`)}
        </p>
        {participants >= info.maxParticipants && (
          <p className="text-xs text-muted-foreground mb-8">
            {t("For larger groups, please send us a quote request.", "Pour un groupe plus important, veuillez nous envoyer une demande de devis.")}{" "}
            <button
              type="button"
              onClick={() => setQuoteOpen(true)}
              className="underline underline-offset-2 text-foreground hover:text-primary"
            >
              {t("Request a quote", "Demander un devis")}
            </button>
          </p>
        )}
        {participants < info.maxParticipants && <div className="mb-8" />}
        <div className="border border-border p-4 bg-muted/30">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-muted-foreground">
              {participants} × {selectedSession?.pricePerPerson ?? info.pricePerPerson} {info.currency}
            </span>
            <span className="text-foreground font-medium">{total} {info.currency}</span>
          </div>
          <div className="border-t border-border pt-2 flex justify-between">
            <span className="font-semibold text-sm uppercase tracking-wider text-foreground">{t("Total", "Total")}</span>
            <span className="font-semibold text-foreground">{total} {info.currency}</span>
          </div>
        </div>
      </div>
    );
  };

  // ── Step 2: booking information ───────────────────────────────────────────
  // Buyer contact details (name / email / phone) are NOT collected here — they
  // belong to the checkout customer. Only booking-level info lives here.
  const Step2 = () => (
    <div>
      <h2 className="font-sans uppercase tracking-[0.105em] text-lg text-foreground mb-6">
        {t("Booking information", "Informations de réservation")}
      </h2>
      <div className="space-y-6">
        <div className="space-y-1.5">
          <Label htmlFor="bk-comment">
            {t(
              "Allergies, intolerances or important information to let us know",
              "Allergies, intolérances ou information importante à nous signaler",
            )}
            <span className="text-muted-foreground ml-1 text-xs">{t("(optional)", "(optionnel)")}</span>
          </Label>
          <Textarea
            id="bk-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            className="rounded-none"
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">
            {t(
              "Does the booking include one or more participants under 18?",
              "La réservation comprend-elle un ou plusieurs participants mineurs ?",
            )}
            <span className="text-destructive ml-1">*</span>
          </p>
          <div className="flex gap-3">
            {([["yes", true], ["no", false]] as [string, boolean][]).map(([key, val]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setHasMinor(val);
                  setMinorError(null);
                  if (!val) setMinorConsent(false);
                }}
                className={`px-5 py-2 border text-sm uppercase tracking-wider transition-colors
                  ${hasMinor === val ? "border-primary bg-primary/5 text-primary" : "border-border text-foreground hover:border-primary/60"}`}
              >
                {val ? t("Yes", "Oui") : t("No", "Non")}
              </button>
            ))}
          </div>
        </div>

        {hasMinor === true && (
          <div className="flex items-start gap-3">
            <Checkbox
              id="bk-minor-consent"
              checked={minorConsent}
              onCheckedChange={(c) => { setMinorConsent(c === true); if (c === true) setMinorError(null); }}
              className="mt-0.5"
            />
            <Label htmlFor="bk-minor-consent" className="text-xs leading-relaxed cursor-pointer font-normal">
              {t(
                "I confirm that I have the authorisation of the legal representative of the minor participant(s).",
                "Je confirme disposer de l'autorisation du représentant légal du/des participant(s) mineur(s).",
              )}
              <span className="text-destructive ml-1">*</span>
            </Label>
          </div>
        )}

        {minorError && <p className="text-xs text-destructive">{minorError}</p>}
      </div>
    </div>
  );

  // ── Step 3: summary + confirm ─────────────────────────────────────────────
  const handleAddToCart = async () => {
    if (!selectedSession) { setStep(0); return; }
    if (hasMinor === null) { setMinorError(t("Please answer this question.", "Veuillez répondre à cette question.")); setStep(2); return; }
    if (hasMinor === true && !minorConsent) {
      setMinorError(t("Please confirm this to continue.", "Veuillez confirmer pour continuer."));
      setStep(2);
      return;
    }

    setIsSubmitting(true);

    // Fresh availability check right before adding — the payment step
    // revalidates once more, server-side.
    const fresh = await refreshAvailability();
    const freshRow = fresh?.find((r) => r.id === selectedSession.id);
    const freshRemaining = freshRow
      ? (freshRow.is_open ? freshRow.remaining_seats : 0)
      : spotsLeft(selectedSession);
    if (participants > freshRemaining) {
      setIsSubmitting(false);
      toast.error(
        freshRemaining <= 0
          ? t("This session is now sold out.", "Cette session est désormais complète.")
          : t(`Only ${freshRemaining} seat(s) left for this session.`, `Il ne reste que ${freshRemaining} place(s) pour cette session.`),
      );
      setStep(0);
      return;
    }

    const unitPrice = WORKSHOP_PRICE_PER_PERSON[workshopType];
    const added = addItem({
      id: "",
      product: "workshop",
      orderDate: "",
      orderTime: "",
      size: "", sizeName: "",
      shape: "", shapeName: "",
      flavor: "", flavorName: "",
      style: "workshop", styleName: t(info.title, info.titleFr),
      baseColor: "", baseColorName: "",
      decorationColor: "", decorationColorName: "",
      cakeText: "", textColor: "", textColorName: "", textStyle: "normal",
      extras: [], extrasNames: [],
      ribbonColor: "", ribbonColorName: "",
      butterflyColor: "", butterflyColorName: "",
      candles: [],
      comment: comment.trim(),
      imageUrls: [],
      imageFiles: [],
      workshopType,
      workshopSessionId: selectedSession.id,
      workshopDate: selectedSession.date,
      workshopTime: selectedSession.time,
      workshopParticipants: participants,
      workshopUnitPrice: unitPrice,
      workshopHasMinor: hasMinor === true,
      workshopMinorConsentConfirmed: hasMinor === true ? minorConsent : false,
      total: unitPrice * participants,
    });

    setIsSubmitting(false);
    if (!added) {
      toast.error(t("Could not add the workshop to your cart. Please try again.", "Impossible d'ajouter l'atelier au panier. Veuillez réessayer."));
      return;
    }
    toast.success(t("Workshop added to your cart.", "Atelier ajouté à votre panier."));
    navigate("/cart");
  };

  const Step3 = () => (
    <div>
      <h2 className="font-sans uppercase tracking-[0.105em] text-lg text-foreground mb-6">
        {t("Booking summary", "Récapitulatif de réservation")}
      </h2>
      <div className="space-y-4">
        <div className="border border-border p-5 space-y-3 bg-card">
          <Row label={t("Workshop", "Atelier")} value={t(info.title, info.titleFr)} />
          <Row
            label={t("Date", "Date")}
            value={selectedSession
              ? `${formatSessionDate(selectedSession.date, lang === "fr" ? "fr" : "en")} · ${selectedSession.time}`
              : "—"}
          />
          <Row label={t("Duration", "Durée")} value={t(info.duration, info.durationFr)} />
          <Row label={t("Participants", "Participants")} value={String(participants)} />
          <Row
            label={t("Minor participant(s)", "Participant(s) mineur(s)")}
            value={hasMinor ? t("Yes", "Oui") : t("No", "Non")}
          />
          {comment.trim() && <Row label={t("Information", "Informations")} value={comment.trim()} />}
          <div className="border-t border-border pt-3">
            <Row label={t("Total", "Total")} value={`${total} ${info.currency}`} bold />
          </div>
        </div>

        <div className="border border-primary/30 bg-primary/5 p-4 text-sm text-foreground/80 leading-relaxed">
          {t(
            "By adding this workshop to your cart, you agree to our cancellation policy. Your contact details and payment are completed securely at checkout, together with the rest of your cart.",
            "En ajoutant cet atelier au panier, vous acceptez notre politique d'annulation. Vos coordonnées et le paiement s'effectuent de manière sécurisée au moment de la commande, avec le reste de votre panier.",
          )}
        </div>

        <Button
          onClick={handleAddToCart}
          disabled={isSubmitting}
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-3 text-[13px] font-medium uppercase tracking-[0.105em] rounded-none"
        >
          {isSubmitting
            ? t("Adding…", "Ajout en cours…")
            : t("Add to cart", "Ajouter au panier")}
        </Button>
      </div>
    </div>
  );

  const Row = ({ label, value, bold }: { label: string; value: string; bold?: boolean }) => (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={`text-right ${bold ? "font-semibold text-foreground" : "text-foreground"}`}>{value}</span>
    </div>
  );

  // ── Navigation logic ──────────────────────────────────────────────────────
  const canAdvance = () => {
    if (step === 0) return selectedSession !== null && sessionSelectable(selectedSession);
    if (step === 1) return participants >= 1 && participants <= maxAllowed;
    if (step === 2) return true; // validated on attempt
    return false;
  };

  const advance = () => {
    if (step === 2) {
      if (hasMinor === null) {
        setMinorError(t("Please answer this question.", "Veuillez répondre à cette question."));
        return;
      }
      if (hasMinor === true && !minorConsent) {
        setMinorError(t("Please confirm this to continue.", "Veuillez confirmer pour continuer."));
        return;
      }
    }
    setStep((s) => s + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const back = () => {
    setStep((s) => Math.max(0, s - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ── Layout ────────────────────────────────────────────────────────────────
  return (
    <Layout>
      <div className="min-h-screen bg-background pt-24 pb-20">
        <div className="container mx-auto px-4 max-w-5xl">
          <Link
            to="/workshop"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8 uppercase tracking-wider"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            {t("Back to Workshops", "Retour aux Ateliers")}
          </Link>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
            {/* ── Left: Workshop summary card ── */}
            <div className="lg:col-span-1 order-2 lg:order-1">
              <div className="border border-border bg-card p-6 sticky top-24">
                <h3 className="font-sans uppercase tracking-[0.105em] text-base font-semibold text-foreground mb-4">
                  {t(info.title, info.titleFr)}
                </h3>
                <p className="text-sm text-foreground/75 mb-5">{t(info.description, info.descriptionFr)}</p>
                <div className="space-y-2.5 mb-5">
                  <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                    <Clock className="w-4 h-4 text-primary" strokeWidth={1.5} />
                    <span>{t(info.duration, info.durationFr)}</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                    <Users className="w-4 h-4 text-primary" strokeWidth={1.5} />
                    <span>{t(`Max ${info.maxParticipants} people`, `Max ${info.maxParticipants} personnes`)}</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                    <MapPin className="w-4 h-4 text-primary" strokeWidth={1.5} />
                    <span>{t("Geneva", "Genève")}</span>
                  </div>
                </div>
                <div className="border-t border-border pt-4">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">{t("What's included", "Ce qui est inclus")}</p>
                  <ul className="space-y-1.5">
                    {info.includes.map((item, i) => (
                      <li key={item} className="flex items-start gap-2 text-xs text-foreground/80">
                        <Check className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" strokeWidth={2} />
                        <span>{t(item, info.includesFr[i])}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="border-t border-border pt-4 mt-4">
                  <p className="text-xs text-muted-foreground">{t("From", "À partir de")}</p>
                  <p className="text-2xl font-light text-foreground">{info.pricePerPerson} <span className="text-sm">{info.currency}</span></p>
                  <p className="text-xs text-muted-foreground">{t("per person", "par personne")}</p>
                </div>
              </div>
            </div>

            {/* ── Right: Steps ── */}
            <div className="lg:col-span-2 order-1 lg:order-2">
              <h1 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-3xl text-foreground mb-8">
                {t("Book your place", "Réservez votre place")}
              </h1>
              <Stepper current={step} />

              {/* Steps are rendered as function calls (not <StepN />) so React
                  keeps the same element tree between renders — rendering them
                  as components recreated every render was remounting the
                  inputs on each keystroke and stealing focus. */}
              <div className="min-h-[300px]">
                {step === 0 && Step0()}
                {step === 1 && Step1()}
                {step === 2 && Step2()}
                {step === 3 && Step3()}
              </div>

              {step < 3 && (
                <div className="flex justify-between mt-8 pt-6 border-t border-border">
                  <Button
                    variant="outline"
                    onClick={step === 0 ? () => navigate("/workshop") : back}
                    className="rounded-none uppercase tracking-[0.08em] text-xs"
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    {step === 0 ? t("Back", "Retour") : t("Previous", "Précédent")}
                  </Button>
                  <Button
                    onClick={advance}
                    disabled={!canAdvance()}
                    className="rounded-none bg-primary hover:bg-primary/90 text-primary-foreground uppercase tracking-[0.08em] text-xs"
                  >
                    {t("Next", "Suivant")}
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <PrivateWorkshopDialog open={quoteOpen} onOpenChange={setQuoteOpen} />
    </Layout>
  );
};

export default WorkshopBooking;
