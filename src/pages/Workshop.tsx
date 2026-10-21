import { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { Clock, Users, MapPin, Check, ChevronLeft, ChevronRight } from "lucide-react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useLang } from "@/context/LanguageContext";
import { PrivateWorkshopDialog } from "@/components/PrivateWorkshopDialog";

// Photos, remplace chaque import par une photo dédiée quand tu en as
import workshopHero from "@/assets/home-cat-workshops.jpg";
import imgSignature from "@/assets/workshop-signature.jpg";
import imgPiping from "@/assets/workshop-piping.jpg";
import imgPaint from "@/assets/workshop-paint.png";
import imgPrivate from "@/assets/workshop-private.jpg";
import { useSeo } from "@/hooks/useSeo";

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h2 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-4xl text-center text-foreground mb-12">
    {children}
  </h2>
);

const workshops = [
  {
    emoji: "",
    title: "Paint Workshop",
    titleFr: "Workshop Peinture",
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
      { icon: Clock, label: "1h30", labelFr: "1h30" },
      { icon: Users, label: "10 people", labelFr: "10 personnes" },
      { icon: MapPin, label: "Geneva", labelFr: "Genève" },
    ],
    price: "CHF 65",
    ctaLabel: "Book Now",
    ctaLabelFr: "Réserver",
    ctaTo: "/workshop-booking?type=paint",
  },

  {
    emoji: "",
    title: "Piping Workshop",
    titleFr: "Workshop Pochage",
    image: imgPiping,
    tagline: "Master the art of piping and decorate your own Bento Cake.",
    taglineFr: "Maîtrisez l'art du pochage et décorez votre propre Bento Cake.",
    features: [
      "Ready-to-decorate frosted cake",
      "Learn piping techniques",
      "Explore different piping tips",
      "Create decorative borders and patterns",
      "Decorate your own cake",
      "Take it home",
    ],
    featuresFr: [
      "Gâteau glacé prêt à décorer",
      "Apprenez les techniques de pochage",
      "Explorez différentes douilles",
      "Créez des bordures et motifs décoratifs",
      "Décorez votre propre gâteau",
      "Repartez avec votre création",
    ],
    meta: [
      { icon: Clock, label: "1h30", labelFr: "1h30" },
      { icon: Users, label: "8 people", labelFr: "8 personnes" },
      { icon: MapPin, label: "Geneva", labelFr: "Genève" },
    ],
    price: "CHF 85",
    ctaLabel: "Book Now",
    ctaLabelFr: "Réserver",
    ctaTo: "/workshop-booking?type=piping",
  },

  {
    emoji: "",
    title: "Signature Workshop",
    titleFr: "Workshop Signature",
    image: imgSignature,
    tagline: "Learn the art of assembling, frosting and decorating your own Bento Cake.",
    taglineFr: "Apprenez à assembler, glacer et décorer votre propre Bento Cake.",
    features: [
      "Assemble your cake",
      "Frost your cake",
      "Learn piping techniques",
      "Buttercream basics",
      "Decorate your own cake",
      "Take it home",
    ],
    featuresFr: [
      "Assemblez votre gâteau",
      "Glacez votre gâteau",
      "Apprenez les techniques de pochage",
      "Les bases de la crème au beurre",
      "Décorez votre propre gâteau",
      "Repartez avec votre création",
    ],
    meta: [
      { icon: Clock, label: "3 hours", labelFr: "3 heures" },
      { icon: Users, label: "8 people", labelFr: "8 personnes" },
      { icon: MapPin, label: "Geneva", labelFr: "Genève" },
    ],
    price: "CHF 120",
    objectPosition: "70% center",
    ctaLabel: "Book Now",
    ctaLabelFr: "Réserver",
    ctaTo: "/workshop-booking?type=signature",
  },
];

const privateWorkshop = {
  emoji: "",
  title: "Private & Custom Workshops",
  titleFr: "Workshops privés et sur mesure",
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
  noteFr: "Chaque workshop est personnalisé selon vos envies.",
  ctaLabel: "Request a Quote",
  ctaLabelFr: "Demander un devis",
  ctaTo: "/contact",
};


// ── Workshop Carousel ────────────────────────────────────────────────────────
const WorkshopCarousel = ({
  t,
  workshops: cards,
  privateWorkshop: priv,
  setPrivateOpen,
}: {
  t: (en: string, fr: string) => string;
  workshops: {
    title: string; titleFr: string; image: string; tagline: string; taglineFr: string;
    features: string[]; featuresFr: string[];
    meta: { icon: React.ElementType; label: string; labelFr: string }[];
    price: string; ctaLabel: string; ctaLabelFr: string; ctaTo: string;
    objectPosition?: string;
  }[];
  privateWorkshop: {
    title: string; titleFr: string; image: string; tagline: string; taglineFr: string;
    perfectFor: string[]; perfectForFr: string[]; note: string; noteFr: string;
    ctaLabel: string; ctaLabelFr: string;
  };
  setPrivateOpen: (v: boolean) => void;
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const TOTAL = cards.length + 1;

  const scrollTo = (index: number) => {
    const track = trackRef.current;
    if (!track) return;
    const card = track.children[index] as HTMLElement;
    if (!card) return;
    const trackRect = track.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const offset = cardRect.left - trackRect.left + track.scrollLeft - (trackRect.width - cardRect.width) / 2;
    track.scrollTo({ left: Math.max(0, offset), behavior: "smooth" });
    setActiveIndex(index);
  };

  const prev = () => scrollTo(Math.max(0, activeIndex - 1));
  const next = () => scrollTo(Math.min(TOTAL - 1, activeIndex + 1));

  const handleScroll = () => {
    const track = trackRef.current;
    if (!track) return;
    let closest = 0;
    let minDist = Infinity;
    Array.from(track.children).forEach((child, i) => {
      const el = child as HTMLElement;
      const center = el.offsetLeft + el.offsetWidth / 2;
      const dist = Math.abs(center - (track.scrollLeft + track.offsetWidth / 2));
      if (dist < minDist) { minDist = dist; closest = i; }
    });
    setActiveIndex(closest);
  };

  return (
    <div className="relative">
      {/* Arrow prev */}
      <button
        onClick={prev}
        disabled={activeIndex === 0}
        aria-label={t("Previous", "Précédent")}
        className="absolute left-2 md:left-6 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center bg-background/90 border border-border/60 text-foreground hover:bg-card disabled:opacity-20 disabled:cursor-default transition-opacity"
      >
        <ChevronLeft className="w-5 h-5" strokeWidth={1.5} />
      </button>

      {/* Scrollable track */}
      <div className="overflow-hidden mx-[max(1rem,calc((100vw-72rem)/2))]">
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="flex gap-5 overflow-x-auto snap-x snap-mandatory pb-2"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" } as React.CSSProperties}
      >
        {cards.map((w) => (
          <div
            key={w.title}
            className="snap-start shrink-0 w-[calc(100vw-3rem)] lg:w-[calc((100%-40px)/3)] border border-border/60 flex flex-col bg-card"
          >
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

        {/* Private card */}
        <div className="snap-start shrink-0 w-[calc(100vw-3rem)] lg:w-[calc((100%-40px)/3)] border border-border/60 flex flex-col bg-card">
          <div className="aspect-[4/3] overflow-hidden">
            <img src={priv.image} alt={t(priv.title, priv.titleFr)} className="w-full h-full object-cover" />
          </div>
          <div className="p-7 flex flex-col flex-1">
            <h3 className="font-sans uppercase tracking-[0.105em] text-base font-semibold text-foreground mb-3">
              {t(priv.title, priv.titleFr)}
            </h3>
            <p className="text-sm text-foreground/75 mb-5">{t(priv.tagline, priv.taglineFr)}</p>
            <p className="text-[13px] font-semibold uppercase tracking-[0.105em] text-foreground mb-3">
              {t("Perfect for", "Idéal pour")}
            </p>
            <ul className="space-y-2 mb-6">
              {priv.perfectFor.map((p, i) => (
                <li key={p} className="text-sm text-foreground/80">{t(p, priv.perfectForFr[i])}</li>
              ))}
            </ul>
            <p className="text-sm text-foreground/75 italic mb-7 mt-auto">
              {t(priv.note, priv.noteFr)}
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

      {/* Arrow next */}
      <button
        onClick={next}
        disabled={activeIndex === TOTAL - 1}
        aria-label={t("Next", "Suivant")}
        className="absolute right-2 md:right-6 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center bg-background/90 border border-border/60 text-foreground hover:bg-card disabled:opacity-20 disabled:cursor-default transition-opacity"
      >
        <ChevronRight className="w-5 h-5" strokeWidth={1.5} />
      </button>

      {/* Dot indicators */}
      <div className="flex justify-center gap-2 mt-6">
        {Array.from({ length: TOTAL }).map((_, i) => (
          <button
            key={i}
            onClick={() => scrollTo(i)}
            aria-label={`${t("Go to", "Aller à")} ${i + 1}`}
            className={`h-1.5 rounded-full transition-all ${i === activeIndex ? "w-4 bg-primary" : "w-1.5 bg-foreground/25"}`}
          />
        ))}
      </div>
    </div>
  );
};

const Workshop = () => {
  useSeo({
    title: "Ateliers Décoration Gâteau Genève | Cake Decorating Workshops",
    description: "Participez à nos ateliers pâtisserie à Genève : bento cake, peinture, piping. Idéal pour EVJF, team building ou cadeau original. Join our Geneva cake workshops!",
    canonical: "https://bentocakestudio.ch/workshop",
  });

  const { t } = useLang();
  const [privateOpen, setPrivateOpen] = useState(false);

  return (
    <Layout overlayHero>
      {/* Hero */}
      <section className="relative min-h-[55vh] md:min-h-[80vh] w-full overflow-hidden">
        <img
          src={workshopHero}
          alt={t("Cake decorating workshop at Bento Cake Studio", "Workshop de décoration de gâteaux au Bento Cake Studio")}
          className="absolute inset-0 w-full h-full object-cover [object-position:65%_center] md:object-center"
        />
        <div className="absolute inset-0 bg-foreground/40" />
        <div className="relative min-h-[55vh] md:min-h-[80vh] flex flex-col items-center justify-center text-center px-4">
          <h1 className="font-sans uppercase tracking-[0.105em] text-3xl md:text-5xl text-cream leading-tight mb-6 max-w-4xl">
            {t("WORKSHOPS", "WORKSHOPS")}
          </h1>
          <p className="text-cream/95 text-sm md:text-base font-light max-w-2xl mb-10">
            {t("Decorate your own Bento Cake at one of our creative workshops or during a private experience.", "Décorez votre propre Bento Cake lors de nos workshops créatifs ou d'une expérience privée.")}
          </p>
          <Button
            onClick={() =>
              document.getElementById("experiences")?.scrollIntoView({ behavior: "smooth" })
            }
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-10 py-2.5 text-[14px] font-medium uppercase tracking-[0.105em] rounded-none"
          >
            {t("BOOK A WORKSHOP", "RÉSERVER VOTRE WORKSHOP")}
          </Button>
        </div>
      </section>

      {/* Choose your experience — horizontal carousel */}
      <section id="experiences" className="py-20 bg-background overflow-hidden">
        <div className="container mx-auto px-4">
          <SectionTitle>{t("CHOOSE YOUR EXPERIENCE", "CHOISISSEZ VOTRE EXPÉRIENCE")}</SectionTitle>
        </div>

        {/* Carousel wrapper — full width so cards bleed to edges on desktop */}
        <WorkshopCarousel t={t} workshops={workshops} privateWorkshop={privateWorkshop} setPrivateOpen={setPrivateOpen} />
      </section>

      <PrivateWorkshopDialog open={privateOpen} onOpenChange={setPrivateOpen} />
    </Layout>
  );
};

export default Workshop;
