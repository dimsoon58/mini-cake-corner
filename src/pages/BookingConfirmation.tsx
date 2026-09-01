import { useEffect } from "react";
import type { ElementType } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Check, Calendar, Mail, ArrowRight } from "lucide-react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useLang } from "@/context/LanguageContext";
import { workshopInfo, workshopSessions, formatSessionDate, WorkshopType } from "@/data/workshopSessions";

const BookingConfirmation = () => {
  const { t, lang } = useLang();
  const [searchParams] = useSearchParams();

  const workshopType = (searchParams.get("type") ?? "signature") as WorkshopType;
  const sessionId = searchParams.get("session") ?? "";
  const participants = Number(searchParams.get("participants") ?? 1);
  const firstName = searchParams.get("name") ?? "";
  const email = searchParams.get("email") ?? "";

  const info = workshopInfo[workshopType];
  const session = workshopSessions.find(s => s.id === sessionId);
  const total = session ? session.pricePerPerson * participants : info.pricePerPerson * participants;

  useEffect(() => {
    document.title = t("Booking Confirmed – Bento Cake Studio", "Réservation confirmée – Bento Cake Studio");
  }, [t]);

  return (
    <Layout>
      <div className="min-h-screen bg-background pt-24 pb-20">
        <div className="container mx-auto px-4 max-w-xl">
          {/* Success icon */}
          <div className="flex flex-col items-center text-center mb-10">
            <div className="w-16 h-16 bg-primary/10 flex items-center justify-center mb-6">
              <Check className="w-8 h-8 text-primary" strokeWidth={2} />
            </div>
            <h1 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-3xl text-foreground mb-3">
              {t("Booking request received", "Demande de réservation reçue")}
            </h1>
            <p className="text-muted-foreground text-sm leading-relaxed max-w-sm">
              {firstName
                ? t(
                    `Thank you, ${firstName}! We've received your booking request and will send a payment link to ${email} shortly.`,
                    `Merci, ${firstName} ! Nous avons bien reçu votre demande et vous enverrons un lien de paiement à ${email} très prochainement.`
                  )
                : t(
                    "We've received your booking request and will be in touch shortly.",
                    "Nous avons bien reçu votre demande et vous contacterons très prochainement."
                  )}
            </p>
          </div>

          {/* Booking details card */}
          <div className="border border-border bg-card p-6 mb-6">
            <h2 className="font-sans uppercase tracking-[0.105em] text-sm text-foreground mb-4">
              {t("Your booking details", "Votre réservation")}
            </h2>
            <div className="space-y-3">
              <Row label={t("Workshop", "Atelier")} value={t(info.title, info.titleFr)} />
              {session && (
                <Row
                  label={t("Date", "Date")}
                  value={`${lang === "fr" ? formatSessionDate(session.date, "fr") : formatSessionDate(session.date, "en")} · ${session.time}`}
                />
              )}
              <Row label={t("Duration", "Durée")} value={t(info.duration, info.durationFr)} />
              <Row label={t("Participants", "Participants")} value={String(participants)} />
              <div className="border-t border-border pt-3">
                <Row label={t("Total", "Total")} value={`${total} ${info.currency}`} bold />
              </div>
            </div>
          </div>

          {/* Next steps */}
          <div className="border border-border bg-card p-6 mb-8">
            <h2 className="font-sans uppercase tracking-[0.105em] text-sm text-foreground mb-4">
              {t("What happens next?", "Prochaines étapes")}
            </h2>
            <div className="space-y-4">
              <Step
                icon={Mail}
                title={t("Confirmation email", "Email de confirmation")}
                desc={t(
                  "Check your inbox — we will send you a payment link to secure your spot.",
                  "Vérifiez vos emails — nous vous enverrons un lien de paiement pour confirmer votre place."
                )}
              />
              <Step
                icon={Check}
                title={t("Payment", "Paiement")}
                desc={t(
                  "Follow the link to complete your payment. Your spot is reserved once payment is received.",
                  "Suivez le lien pour effectuer votre paiement. Votre place est confirmée dès réception du règlement."
                )}
              />
              <Step
                icon={Calendar}
                title={t("See you there!", "À bientôt !")}
                desc={t(
                  "We will send you a reminder with all the details before your workshop day.",
                  "Nous vous enverrons un rappel avec tous les détails avant le jour de l'atelier."
                )}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Button asChild className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground rounded-none uppercase tracking-[0.08em] text-xs">
              <Link to="/workshop">
                {t("Back to Workshops", "Retour aux Ateliers")}
              </Link>
            </Button>
            <Button asChild variant="outline" className="flex-1 rounded-none uppercase tracking-[0.08em] text-xs">
              <Link to="/">
                {t("Go to Homepage", "Accueil")}
                <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </Layout>
  );
};

const Row = ({ label, value, bold }: { label: string; value: string; bold?: boolean }) => (
  <div className="flex justify-between gap-4 text-sm">
    <span className="text-muted-foreground shrink-0">{label}</span>
    <span className={`text-right ${bold ? "font-semibold text-foreground" : "text-foreground"}`}>{value}</span>
  </div>
);

const Step = ({ icon: Icon, title, desc }: { icon: ElementType; title: string; desc: string }) => (
  <div className="flex gap-3">
    <div className="w-7 h-7 bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
      <Icon className="w-3.5 h-3.5 text-primary" strokeWidth={2} />
    </div>
    <div>
      <p className="text-sm font-medium text-foreground mb-0.5">{title}</p>
      <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  </div>
);

export default BookingConfirmation;
