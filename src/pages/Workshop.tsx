import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Clock, Users, MapPin, Check } from "lucide-react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { submitToWeb3Forms } from "@/lib/web3forms";
import { useLang } from "@/context/LanguageContext";
import { useFieldError } from "@/lib/formErrors";

// Photos, remplace chaque import par une photo dédiée quand tu en as
import workshopHero from "@/assets/home-cat-workshops.png";
import imgSignature from "@/assets/home-cat-workshops.png";
import imgPaint from "@/assets/design-drawing-new.jpg";
import imgPrivate from "@/assets/corporate-event-2.png";

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h2 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-4xl text-center text-foreground mb-4">
    {children}
  </h2>
);

const workshops = [
  {
    emoji: "",
    title: "Signature Workshop",
    titleFr: "Atelier Signature",
    image: imgSignature,
    tagline: "Learn the basics of Bento Cake decorating.",
    taglineFr: "Découvrez les bases de la décoration du Bento Cake.",
    features: [
      "Cake already baked and filled",
      "Learn piping techniques",
      "Buttercream basics",
      "Decorate your own cake",
      "Take it home",
    ],
    featuresFr: [
      "Gâteau déjà cuit et garni",
      "Apprenez les techniques de pochage",
      "Les bases de la crème au beurre",
      "Décorez votre propre gâteau",
      "Repartez avec votre création",
    ],
    meta: [
      { icon: Clock, label: "Duration", labelFr: "Durée" },
      { icon: Users, label: "Participants", labelFr: "Participants" },
      { icon: MapPin, label: "Geneva", labelFr: "Genève" },
    ],
    ctaLabel: "Book Now",
    ctaLabelFr: "Réserver",
    ctaTo: "/contact",
  },
  {
    emoji: "",
    title: "Paint Workshop",
    titleFr: "Atelier Peinture",
    image: imgPaint,
    tagline: "Turn your cake into edible art.",
    taglineFr: "Transformez votre gâteau en œuvre d'art comestible.",
    features: [
      "Ready-to-decorate cake",
      "Edible paint",
      "Creative designs",
      "Perfect for beginners",
    ],
    featuresFr: [
      "Gâteau prêt à décorer",
      "Peinture comestible",
      "Créations originales",
      "Idéal pour les débutants",
    ],
    meta: [
      { icon: Clock, label: "Duration", labelFr: "Durée" },
      { icon: Users, label: "Participants", labelFr: "Participants" },
      { icon: MapPin, label: "Geneva", labelFr: "Genève" },
    ],
    ctaLabel: "Book Now",
    ctaLabelFr: "Réserver",
    ctaTo: "/contact",
  },
];

const privateWorkshop = {
  emoji: "",
  title: "Private & Custom Workshops",
  titleFr: "Ateliers privés et sur mesure",
  image: imgPrivate,
  tagline: "Looking for something tailored?",
  taglineFr: "Vous cherchez une expérience sur mesure ?",
  perfectFor: [
    "Corporate Events",
    "Birthdays",
    "Bridal Showers",
    "Student Groups",
    "Hen Parties",
    "Team Building",
    "Brand Events",
  ],
  perfectForFr: [
    "Événements d'entreprise",
    "Anniversaires",
    "Fêtes prénuptiales",
    "Groupes d'étudiants",
    "Enterrements de vie de jeune fille",
    "Team building",
    "Événements de marque",
  ],
  note: "Every workshop is customised to your needs.",
  noteFr: "Chaque atelier est personnalisé selon vos envies.",
  ctaLabel: "Request a Quote",
  ctaLabelFr: "Demander un devis",
  ctaTo: "/contact",
};

const pwPhoneRegex = /^[+\d][\d\s().\-/]{6,}$/;

const privateSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required").max(150),
  email: z.string().trim().email("Please enter a valid email address").max(255),
  phone: z.string().trim().regex(pwPhoneRegex, "Please enter a valid phone number"),
  occasion: z.string().trim().max(150).optional(),
  participants: z.string().trim().min(1, "Number of participants is required").max(50),
  preferredDate: z.string().trim().max(100).optional(),
  message: z.string().trim().min(1, "Please tell us about your event").max(2000),
});
type PrivateData = z.infer<typeof privateSchema>;

const PrivateWorkshopDialog = ({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) => {
  const { t } = useLang();
  const fe = useFieldError();
  const [submitted, setSubmitted] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PrivateData>({ resolver: zodResolver(privateSchema) });

  const handleClose = (v: boolean) => {
    if (!v) setTimeout(() => { setSubmitted(false); reset(); }, 250);
    onOpenChange(v);
  };

  const onSubmit = async (data: PrivateData) => {
    try {
      await submitToWeb3Forms(
        {
          "First and last name": data.fullName,
          "Email address": data.email,
          "Phone number": data.phone,
          "Occasion": data.occasion || "(not provided)",
          "Number of participants": data.participants,
          "Preferred date": data.preferredDate || "(not provided)",
          "Message": data.message,
        },
        { subject: "Private Workshop enquiry, Bento Cake Studio" }
      );
      setSubmitted(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Something went wrong. Please try again.", "Une erreur s'est produite. Veuillez réessayer."));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        {submitted ? (
          <div className="text-center py-10">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="text-3xl text-primary">✓</span>
            </div>
            <h3 className="font-sans uppercase tracking-[0.105em] text-xl font-semibold text-foreground mb-3">{t("Thank you", "Merci")}</h3>
            <p className="text-muted-foreground leading-relaxed max-w-md mx-auto">
              {t("Thank you for your enquiry. We will get back to you shortly with a personalised proposal for your private workshop.", "Merci pour votre demande. Nous reviendrons vers vous très prochainement avec une proposition personnalisée pour votre atelier privé.")}
            </p>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-sans uppercase tracking-[0.105em] text-xl text-foreground">
                {t("Private & Custom Workshops", "Ateliers privés et sur mesure")}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground leading-relaxed pt-1">
                {t("Tell us about your event and we will get back to you with a personalised proposal.", "Parlez-nous de votre événement et nous reviendrons vers vous avec une proposition personnalisée.")}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2 text-left">
              <div className="space-y-1.5">
                <Label htmlFor="pw-name">{t("First and last name", "Prénom et nom")} <span className="text-destructive">*</span></Label>
                <Input id="pw-name" {...register("fullName")} />
                {errors.fullName && <p className="text-sm text-destructive">{fe(errors.fullName.message)}</p>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="pw-email">{t("Email address", "Adresse e-mail")} <span className="text-destructive">*</span></Label>
                  <Input id="pw-email" type="email" {...register("email")} />
                  {errors.email && <p className="text-sm text-destructive">{fe(errors.email.message)}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-phone">{t("Phone number", "Numéro de téléphone")} <span className="text-destructive">*</span></Label>
                  <Input id="pw-phone" type="tel" {...register("phone")} />
                  {errors.phone && <p className="text-sm text-destructive">{fe(errors.phone.message)}</p>}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="pw-occasion">{t("Occasion", "Occasion")} <span className="text-muted-foreground">{t("(optional)", "(optionnel)")}</span></Label>
                  <Input id="pw-occasion" placeholder={t("Birthday, team building…", "Anniversaire, team building…")} {...register("occasion")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pw-participants">{t("Number of participants", "Nombre de participants")} <span className="text-destructive">*</span></Label>
                  <Input id="pw-participants" {...register("participants")} />
                  {errors.participants && <p className="text-sm text-destructive">{fe(errors.participants.message)}</p>}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw-date">{t("Preferred date", "Date souhaitée")} <span className="text-muted-foreground">{t("(optional)", "(optionnel)")}</span></Label>
                <Input id="pw-date" placeholder={t("e.g. mid-March, a weekend…", "ex. mi-mars, un week-end…")} {...register("preferredDate")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw-message">{t("Tell us about your event", "Parlez-nous de votre événement")} <span className="text-destructive">*</span></Label>
                <Textarea id="pw-message" rows={4} {...register("message")} />
                {errors.message && <p className="text-sm text-destructive">{fe(errors.message.message)}</p>}
              </div>
              <Button type="submit" disabled={isSubmitting} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-6 text-[13px] font-medium uppercase tracking-[0.105em] rounded-none">
                {isSubmitting ? t("Sending…", "Envoi…") : t("Send my enquiry", "Envoyer ma demande")}
              </Button>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

const Workshop = () => {
  const { t } = useLang();
  const fe = useFieldError();
  const [privateOpen, setPrivateOpen] = useState(false);
  useEffect(() => {
    document.title = t("Workshops – Bento Cake Studio", "Ateliers – Bento Cake Studio");
    return () => {
      document.title = "Bento Cake Studio Geneva";
    };
  }, [t]);

  return (
    <Layout overlayHero>
      {/* Hero */}
      <section className="relative min-h-[80vh] w-full overflow-hidden">
        <img
          src={workshopHero}
          alt={t("Cake decorating workshop at Bento Cake Studio", "Atelier de décoration de gâteaux au Bento Cake Studio")}
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-foreground/40" />
        <div className="relative min-h-[80vh] flex flex-col items-center justify-center text-center px-4">
          <h1 className="font-sans uppercase tracking-[0.105em] text-3xl md:text-5xl text-cream leading-tight mb-6 max-w-4xl">
            {t("WORKSHOP", "ATELIER")}
          </h1>
          <p className="text-cream/95 text-base md:text-lg font-light max-w-2xl mb-10">
            {t("Learn to decorate your own Bento Cake in a fun and creative experience. Whether you're joining one of our public workshops or booking a private event, we'll guide you every step of the way.", "Apprenez à décorer votre propre Bento Cake au cours d'une expérience à la fois ludique et créative. Que vous participiez à l'un de nos ateliers publics ou que vous réserviez un événement privé, nous vous accompagnons à chaque étape.")}
          </p>
          <Button
            onClick={() =>
              document.getElementById("experiences")?.scrollIntoView({ behavior: "smooth" })
            }
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-10 py-6 text-[14px] font-medium uppercase tracking-[0.105em] rounded-none"
          >
            {t("BOOK A WORKSHOP", "RÉSERVER UN ATELIER")}
          </Button>
        </div>
      </section>

      {/* Choose your experience */}
      <section id="experiences" className="py-20 bg-background">
        <div className="container mx-auto px-4">
          <SectionTitle>{t("CHOOSE YOUR EXPERIENCE", "CHOISISSEZ VOTRE EXPÉRIENCE")}</SectionTitle>
          <p className="text-center text-muted-foreground text-sm max-w-2xl mx-auto mb-14">
            {t("Three ways to get creative and take home something you made yourself.", "Trois façons de laisser libre cours à votre créativité et de repartir avec une création faite de vos mains.")}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {workshops.map((w) => (
              <div key={w.title} className="border border-border/60 flex flex-col bg-card">
                <div className="aspect-[4/3] overflow-hidden">
                  <img src={w.image} alt={t(w.title, w.titleFr)} className="w-full h-full object-cover" />
                </div>
                <div className="p-7 flex flex-col flex-1">
                  <h3 className="font-sans uppercase tracking-[0.105em] text-base font-semibold text-foreground mb-3">
                    {t(w.title, w.titleFr)}
                  </h3>
                  <p className="text-sm text-foreground/75 mb-5">{t(w.tagline, w.taglineFr)}</p>
                  <ul className="space-y-2.5 mb-6">
                    {w.features.map((f, i) => (
                      <li key={f} className="flex items-start gap-2.5 text-sm text-foreground/80">
                        <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" strokeWidth={2} />
                        <span>{t(f, w.featuresFr[i])}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="space-y-2 mb-7 mt-auto">
                    {w.meta.map((m) => (
                      <div key={m.label} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                        <m.icon className="w-4 h-4 text-primary" strokeWidth={1.5} />
                        <span>{t(m.label, m.labelFr)}</span>
                      </div>
                    ))}
                  </div>
                  <Button
                    asChild
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-[13px] font-medium uppercase tracking-[0.105em] rounded-none"
                  >
                    <Link to={w.ctaTo}>{t(w.ctaLabel, w.ctaLabelFr)}</Link>
                  </Button>
                </div>
              </div>
            ))}

            <div className="border border-border/60 flex flex-col bg-card">
              <div className="aspect-[4/3] overflow-hidden">
                <img src={privateWorkshop.image} alt={t(privateWorkshop.title, privateWorkshop.titleFr)} className="w-full h-full object-cover" />
              </div>
              <div className="p-7 flex flex-col flex-1">
                <h3 className="font-sans uppercase tracking-[0.105em] text-base font-semibold text-foreground mb-3">
                  {t(privateWorkshop.title, privateWorkshop.titleFr)}
                </h3>
                <p className="text-sm text-foreground/75 mb-5">{t(privateWorkshop.tagline, privateWorkshop.taglineFr)}</p>
                <p className="text-[13px] font-semibold uppercase tracking-[0.105em] text-foreground mb-3">
                  {t("Perfect for", "Idéal pour")}
                </p>
                <ul className="space-y-2 mb-6">
                  {privateWorkshop.perfectFor.map((p, i) => (
                    <li key={p} className="text-sm text-foreground/80">{t(p, privateWorkshop.perfectForFr[i])}</li>
                  ))}
                </ul>
                <p className="text-sm text-foreground/75 italic mb-7 mt-auto">
                  {t(privateWorkshop.note, privateWorkshop.noteFr)}
                </p>
                <Button
                  onClick={() => setPrivateOpen(true)}
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-[13px] font-medium uppercase tracking-[0.105em] rounded-none"
                >
                  {t("Enquire", "Nous contacter")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <PrivateWorkshopDialog open={privateOpen} onOpenChange={setPrivateOpen} />
    </Layout>
  );
};

export default Workshop;
