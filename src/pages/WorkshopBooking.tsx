import { useState, useEffect } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { Clock, Users, MapPin, Check, ChevronLeft, ChevronRight, Calendar, User, CreditCard } from "lucide-react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLang } from "@/context/LanguageContext";
import { toast } from "sonner";
import { submitToWeb3Forms } from "@/lib/web3forms";
import {
  WorkshopType,
  WorkshopSession,
  workshopInfo,
  getSessionsForType,
  spotsLeft,
  formatSessionDate,
} from "@/data/workshopSessions";

// ── Stepper ──────────────────────────────────────────────────────────────────
const STEPS = [
  { icon: Calendar, labelEn: "Date", labelFr: "Date" },
  { icon: Users,    labelEn: "Participants", labelFr: "Participants" },
  { icon: User,     labelEn: "Details", labelFr: "Coordonnées" },
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

  const typeParam = searchParams.get("type") as WorkshopType | null;
  const workshopType: WorkshopType = typeParam === "paint" ? "paint" : "signature";
  const info = workshopInfo[workshopType];
  const sessions = getSessionsForType(workshopType);

  const [step, setStep] = useState(0);
  const [selectedSession, setSelectedSession] = useState<WorkshopSession | null>(null);
  const [participants, setParticipants] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    allergies: "",
    notes: "",
  });
  const [errors, setErrors] = useState<Partial<typeof form>>({});

  useEffect(() => {
    document.title = t(
      `Book – ${info.title} – Bento Cake Studio`,
      `Réserver – ${info.titleFr} – Bento Cake Studio`
    );
  }, [info, t]);

  const total = selectedSession ? selectedSession.pricePerPerson * participants : info.pricePerPerson * participants;

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
            const left = spotsLeft(s);
            const full = left === 0;
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
                    {lang === "fr" ? formatSessionDate(s.date, "fr") : formatSessionDate(s.date, "en")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {s.time} · {t(info.duration, info.durationFr)}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  {full ? (
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">{t("Full", "Complet")}</span>
                  ) : (
                    <>
                      <p className={`text-sm font-semibold ${left <= 2 ? "text-destructive" : "text-foreground"}`}>
                        {left} {t("spot(s) left", "place(s) restante(s)")}
                      </p>
                      {selected && <Check className="w-4 h-4 text-primary ml-auto mt-1" />}
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  // ── Step 1: participants ──────────────────────────────────────────────────
  const Step1 = () => {
    const maxAllowed = selectedSession ? Math.min(spotsLeft(selectedSession), 6) : 6;
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
            className="w-10 h-10 border border-border flex items-center justify-center text-foreground hover:border-primary transition-colors text-xl"
          >
            +
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-8">
          {t(`Maximum ${maxAllowed} participants per booking.`, `Maximum ${maxAllowed} participants par réservation.`)}
        </p>
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

  // ── Step 2: customer details ──────────────────────────────────────────────
  const validate = () => {
    const e: Partial<typeof form> = {};
    if (!form.firstName.trim()) e.firstName = t("Required", "Requis");
    if (!form.lastName.trim()) e.lastName = t("Required", "Requis");
    if (!form.email.trim() || !/\S+@\S+\.\S+/.test(form.email)) e.email = t("Valid email required", "Email valide requis");
    if (!form.phone.trim()) e.phone = t("Required", "Requis");
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const Step2 = () => (
    <div>
      <h2 className="font-sans uppercase tracking-[0.105em] text-lg text-foreground mb-6">
        {t("Your details", "Vos coordonnées")}
      </h2>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="bk-first">{t("First name", "Prénom")} <span className="text-destructive">*</span></Label>
            <Input id="bk-first" value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} className="rounded-none" />
            {errors.firstName && <p className="text-xs text-destructive">{errors.firstName}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bk-last">{t("Last name", "Nom")} <span className="text-destructive">*</span></Label>
            <Input id="bk-last" value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} className="rounded-none" />
            {errors.lastName && <p className="text-xs text-destructive">{errors.lastName}</p>}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bk-email">{t("Email address", "Adresse e-mail")} <span className="text-destructive">*</span></Label>
          <Input id="bk-email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="rounded-none" />
          {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bk-phone">{t("Phone number", "Numéro de téléphone")} <span className="text-destructive">*</span></Label>
          <Input id="bk-phone" type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="rounded-none" />
          {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bk-allergies">
            {t("Allergies or dietary requirements", "Allergies ou restrictions alimentaires")}
            <span className="text-muted-foreground ml-1 text-xs">{t("(optional)", "(optionnel)")}</span>
          </Label>
          <Input id="bk-allergies" value={form.allergies} onChange={e => setForm(f => ({ ...f, allergies: e.target.value }))} className="rounded-none" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bk-notes">
            {t("Additional notes", "Notes supplémentaires")}
            <span className="text-muted-foreground ml-1 text-xs">{t("(optional)", "(optionnel)")}</span>
          </Label>
          <Input id="bk-notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="rounded-none" />
        </div>
      </div>
    </div>
  );

  // ── Step 3: summary + confirm ─────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!selectedSession) return;
    setIsSubmitting(true);
    try {
      await submitToWeb3Forms(
        {
          "Workshop": t(info.title, info.titleFr),
          "Date": `${formatSessionDate(selectedSession.date, lang === "fr" ? "fr" : "en")} at ${selectedSession.time}`,
          "Participants": String(participants),
          "Total": `${total} ${info.currency}`,
          "First name": form.firstName,
          "Last name": form.lastName,
          "Email": form.email,
          "Phone": form.phone,
          "Allergies": form.allergies || "—",
          "Notes": form.notes || "—",
        },
        { subject: `Workshop Booking – ${info.title} – ${form.firstName} ${form.lastName}` }
      );
      navigate(`/workshop-confirmation?type=${workshopType}&session=${selectedSession.id}&participants=${participants}&name=${encodeURIComponent(form.firstName)}&email=${encodeURIComponent(form.email)}`);
    } catch {
      toast.error(t("Something went wrong. Please try again or contact us on WhatsApp.", "Une erreur s'est produite. Veuillez réessayer ou nous contacter sur WhatsApp."));
    } finally {
      setIsSubmitting(false);
    }
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
              ? `${lang === "fr" ? formatSessionDate(selectedSession.date, "fr") : formatSessionDate(selectedSession.date, "en")} · ${selectedSession.time}`
              : "—"}
          />
          <Row label={t("Duration", "Durée")} value={t(info.duration, info.durationFr)} />
          <Row label={t("Participants", "Participants")} value={String(participants)} />
          <div className="border-t border-border pt-3">
            <Row label={t("Total", "Total")} value={`${total} ${info.currency}`} bold />
          </div>
        </div>

        <div className="border border-border p-5 space-y-3 bg-card">
          <Row label={t("Name", "Nom")} value={`${form.firstName} ${form.lastName}`} />
          <Row label={t("Email", "Email")} value={form.email} />
          <Row label={t("Phone", "Téléphone")} value={form.phone} />
          {form.allergies && <Row label={t("Allergies", "Allergies")} value={form.allergies} />}
          {form.notes && <Row label={t("Notes", "Notes")} value={form.notes} />}
        </div>

        <div className="border border-primary/30 bg-primary/5 p-4 text-sm text-foreground/80 leading-relaxed">
          {t(
            "By confirming, you agree to our cancellation policy. A payment link will be sent to your email address to complete your booking.",
            "En confirmant, vous acceptez notre politique d'annulation. Un lien de paiement sera envoyé à votre adresse e-mail pour finaliser votre réservation."
          )}
        </div>

        <Button
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-3 text-[13px] font-medium uppercase tracking-[0.105em] rounded-none"
        >
          {isSubmitting
            ? t("Sending…", "Envoi en cours…")
            : t("Confirm booking", "Confirmer la réservation")}
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
    if (step === 0) return selectedSession !== null;
    if (step === 1) return participants >= 1;
    if (step === 2) return true; // validate on attempt
    return false;
  };

  const advance = () => {
    if (step === 2 && !validate()) return;
    setStep(s => s + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const back = () => {
    setStep(s => Math.max(0, s - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ── Layout ────────────────────────────────────────────────────────────────
  return (
    <Layout>
      <div className="min-h-screen bg-background pt-24 pb-20">
        <div className="container mx-auto px-4 max-w-5xl">
          {/* Back link */}
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

              <div className="min-h-[300px]">
                {step === 0 && <Step0 />}
                {step === 1 && <Step1 />}
                {step === 2 && <Step2 />}
                {step === 3 && <Step3 />}
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
    </Layout>
  );
};

export default WorkshopBooking;
