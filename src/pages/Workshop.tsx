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
import { useLang } from "@/context/LanguageContext";
import { useFieldError } from "@/lib/formErrors";
import { PrivateWorkshopDialog } from "@/components/PrivateWorkshopDialog";

// Photos, remplace chaque import par une photo dédiée quand tu en as
import workshopHero from "@/assets/home-cat-workshops.jpg";
import imgSignature from "@/assets/workshop-signature.jpg";
import imgPaint from "@/assets/workshop-paint.png";
import imgPrivate from "@/assets/workshop-private.jpg";

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h2 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-4xl text-center text-foreground mb-12">
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
      "Frost your cake",
      "Learn piping techniques",
      "Buttercream basics",
      "Decorate your own cake",
      "Take it home",
    ],
    featuresFr: [
      "Glacez votre gâteau",
      "Apprenez les techniques de pochage",
      "Les bases de la crème au beurre",
      "Décorez votre propre gâteau",
      "Repartez avec votre création",
    ],
    meta: [
      { icon: Clock, label: "2 hours", labelFr: "2 heures" },
      { icon: Users, label: "8 people", labelFr: "8 personnes" },
      { icon: MapPin, label: "Geneva", labelFr: "Genève" },
    ],
    price: "CHF 85",
    objectPosition: "70% center",
    ctaLabel: "Book Now",
    ctaLabelFr: "Réserver",
    ctaTo: "/workshop-booking?type=signature",
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
      { icon: Clock, label: "2 hours", labelFr: "2 heures" },
      { icon: Users, label: "10 people", labelFr: "10 personnes" },
      { icon: MapPin, label: "Geneva", labelFr: "Genève" },
    ],
    price: "CHF 65",
    ctaLabel: "Book Now",
    ctaLabelFr: "Réserver",
    ctaTo: "/workshop-booking?type=paint",
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
      <section className="relative min-h-[55vh] md:min-h-[80vh] w-full overflow-hidden">
        <img
          src={workshopHero}
          alt={t("Cake decorating workshop at Bento Cake Studio", "Atelier de décoration de gâteaux au Bento Cake Studio")}
          className="absolute inset-0 w-full h-full object-cover [object-position:65%_center] md:object-center"
        />
        <div className="absolute inset-0 bg-foreground/40" />
        <div className="relative min-h-[55vh] md:min-h-[80vh] flex flex-col items-center justify-center text-center px-4">
          <h1 className="font-sans uppercase tracking-[0.105em] text-3xl md:text-5xl text-cream leading-tight mb-6 max-w-4xl">
            {t("WORKSHOP", "ATELIERS")}
          </h1>
          <p className="text-cream/95 text-sm md:text-base font-light max-w-2xl mb-10">
            {t("Decorate your own Bento Cake at one of our creative workshops or during a private experience.", "Décorez votre propre Bento Cake lors de nos ateliers créatifs ou d'une expérience privée.")}
          </p>
          <Button
            onClick={() =>
              document.getElementById("experiences")?.scrollIntoView({ behavior: "smooth" })
            }
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-10 py-2.5 text-[14px] font-medium uppercase tracking-[0.105em] rounded-none"
          >
            {t("BOOK A WORKSHOP", "RÉSERVER VOTRE ATELIER")}
          </Button>
        </div>
      </section>

      {/* Choose your experience */}
      <section id="experiences" className="py-20 bg-background">
        <div className="container mx-auto px-4">
          <SectionTitle>{t("CHOOSE YOUR EXPERIENCE", "CHOISISSEZ VOTRE EXPÉRIENCE")}</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {workshops.map((w) => (
              <div key={w.title} className="border border-border/60 flex flex-col bg-card">
                <div className="aspect-[4/3] overflow-hidden">
                  <img src={w.image} alt={t(w.title, w.titleFr)} className="w-full h-full object-cover" style={w.objectPosition ? { objectPosition: w.objectPosition } : undefined} />
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
                  {w.price && (
                    <p className="text-sm text-foreground/60 mb-4 text-right tracking-wide">{t("From", "Dès")} {w.price} <span className="text-xs">{t("/ person", "/ personne")}</span></p>
                  )}
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
