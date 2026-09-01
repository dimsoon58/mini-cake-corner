import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Layout from "@/components/Layout";
import { useLang } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";

/* Emplacement photo elegant, en attendant les vraies images */
const PhotoSlot = ({
  className = "",
  label = "PHOTO",
  light = false,
}: {
  className?: string;
  label?: string;
  light?: boolean;
}) => (
  <div
    className={cn(
      "relative w-full overflow-hidden flex items-center justify-center",
      light ? "bg-cream/10 border border-cream/25" : "bg-accent border border-primary/10",
      className
    )}
  >
    <span
      className={cn(
        "font-sans uppercase tracking-[0.3em] text-[10px]",
        light ? "text-cream/50" : "text-primary/30"
      )}
    >
      {label}
    </span>
  </div>
);

const ArchivesSlider = () => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { t } = useLang();

  const scroll = (direction: "left" | "right") => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollBy({
      left: direction === "left" ? -320 : 320,
      behavior: "smooth",
    });
  };

  return (
    <section className="py-14 bg-cream">
      <div className="container mx-auto px-4">
        <h2 className="font-sans text-xl md:text-2xl text-center uppercase tracking-[0.105em] text-foreground mb-3">
          {t("FROM THE ARCHIVES", "DANS LES ARCHIVES")}
        </h2>
        <p className="text-center text-sm text-muted-foreground mb-8">
          {t("A few moments from the last five years.", "Quelques moments des cinq dernières années.")}
        </p>
      </div>

      <div className="relative w-full px-4 sm:px-8">
        <button
          onClick={() => scroll("left")}
          aria-label="Scroll left"
          className="flex absolute left-2 top-1/2 -translate-y-1/2 z-10 bg-background/90 hover:bg-background p-2 shadow-md items-center justify-center"
        >
          <ChevronLeft className="h-6 w-6 text-foreground" />
        </button>

        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {["2021", "2022", "2023", "2024", "2025", "2026"].map((year) => (
            <div key={year} className="snap-start flex-shrink-0 w-[52%] sm:w-[30%] lg:w-[17%]">
              <PhotoSlot className="aspect-square" label={year} />
            </div>
          ))}
        </div>

        <button
          onClick={() => scroll("right")}
          aria-label="Scroll right"
          className="flex absolute right-2 top-1/2 -translate-y-1/2 z-10 bg-background/90 hover:bg-background p-2 shadow-md items-center justify-center"
        >
          <ChevronRight className="h-6 w-6 text-foreground" />
        </button>
      </div>
    </section>
  );
};

const OurStory = () => {
  const { t } = useLang();

  /* Les trois premiers chapitres, en alternance gauche / droite sur ordinateur.
     Sur telephone le texte passe toujours avant l'image. */
  const chapters = [
    {
      id: "2021",
      title: t("2021 — HOW IT STARTED", "2021 — LE DÉBUT DE L'AVENTURE"),
      paragraphs: [
        t(
          "Bento Cake Studio began in 2021 with Mélodie Nagle and Catherine Kidasheli, two friends studying at EHL.",
          "Bento Cake Studio est né en 2021 avec Mélodie Nagle et Catherine Kidasheli, deux amies alors étudiantes à l'EHL."
        ),
        t(
          "Inspired by South Korea and its creative bento cake culture, they decided to bring the concept to Geneva. With no professional baking background, they learned along the way, combining Mélodie's passion for baking with Catherine's interest in branding and design.",
          "Inspirées par la Corée du Sud et par la créativité autour des bento cakes, elles décident d'amener le concept à Genève. Sans expérience professionnelle en pâtisserie, elles apprennent au fur et à mesure, en associant la passion de Mélodie pour la pâtisserie à l'intérêt de Catherine pour le branding et le design."
        ),
        t(
          "In December 2021, Bento Cake Studio officially launched as Geneva's first bento cake studio.",
          "En décembre 2021, Bento Cake Studio voit officiellement le jour en tant que premier studio de bento cakes à Genève."
        ),
      ],
    },
    {
      id: "first-years",
      title: t("THE FIRST YEARS", "LES PREMIÈRES ANNÉES"),
      paragraphs: [
        t(
          "What began as a project alongside their studies gradually grew. Orders increased, the studio started gaining attention in the press, and new opportunities followed. Mélodie and Catherine eventually moved into their first professional kitchen at Les Ateliers de Serge Labrosse.",
          "Ce qui avait commencé comme un projet en parallèle de leurs études grandit petit à petit. Les commandes augmentent, le studio commence à faire parler de lui dans la presse, et de nouvelles opportunités se présentent. Mélodie et Catherine s'installent alors dans leur première cuisine professionnelle aux Ateliers de Serge Labrosse."
        ),
        t(
          "Later, new professional opportunities took Catherine to Georgia, leading her to step away from the company. But the story didn't end there: still very close to Mélodie and Elizabeth, she remains a valued supporter of Bento Cake Studio to this day.",
          "Plus tard, de nouvelles opportunités professionnelles amènent Catherine à poursuivre son parcours en Géorgie et à quitter l'entreprise. Mais l'histoire ne s'arrête pas là : toujours très proche de Mélodie et Elizabeth, elle reste aujourd'hui encore un précieux soutien pour Bento Cake Studio."
        ),
        t(
          "Still studying full-time in Lausanne, Mélodie continued the journey on her own. With the constant travel between Lausanne and Geneva, keeping the kitchen became difficult, so she decided to continue on a smaller scale while completing her studies.",
          "Toujours étudiante à plein temps à Lausanne, Mélodie poursuit l'aventure seule. Avec les allers-retours constants entre Lausanne et Genève, garder la cuisine devient compliqué. Elle décide alors de poursuivre l'activité à plus petite échelle, le temps de terminer ses études."
        ),
      ],
    },
    {
      id: "2025",
      title: t("2025 — A NEW CHAPTER", "2025 — UN NOUVEAU CHAPITRE"),
      paragraphs: [
        t(
          "After graduating, Mélodie was able to dedicate more time to Bento Cake Studio.",
          "Une fois diplômée, Mélodie peut consacrer davantage de temps à Bento Cake Studio."
        ),
        t(
          "In 2025, Elizabeth joined the company, marking the beginning of a new chapter.",
          "En 2025, Elizabeth rejoint l'entreprise, marquant le début d'un nouveau chapitre."
        ),
        t(
          "Together, Mélodie and Elizabeth started imagining the future of Bento Cake Studio — with new ideas, new creations and a shared vision for what would come next.",
          "Ensemble, Mélodie et Elizabeth commencent à imaginer l'avenir de Bento Cake Studio — avec de nouvelles idées, de nouvelles créations et une vision commune pour la suite."
        ),
      ],
    },
  ];

  const chapter2026 = [
    t(
      "Five years after the first cakes, Bento Cake Studio is entering a new chapter.",
      "Cinq ans après les premiers gâteaux, Bento Cake Studio ouvre un nouveau chapitre."
    ),
    t(
      "September 2026 marks a new beginning: a new identity, new creations, new experiences and plenty of ideas still to come.",
      "Septembre 2026 marque un nouveau départ : une nouvelle identité, de nouvelles créations, de nouvelles expériences et encore beaucoup d'idées à venir."
    ),
    t(
      "And, a few years after leaving its first professional kitchen, Bento Cake Studio is returning to Les Ateliers de Serge Labrosse — back to a familiar place, but with a whole new chapter ahead.",
      "Et quelques années après avoir quitté sa première cuisine professionnelle, Bento Cake Studio retrouve les Ateliers de Serge Labrosse — un lieu familier, mais cette fois pour écrire une toute nouvelle page de son histoire."
    ),
    t(
      "A lot has changed since 2021, but our love for creating, celebrating and making every moment a little more special hasn't.",
      "Beaucoup de choses ont changé depuis 2021, mais pas notre envie de créer, de célébrer et de rendre chaque moment un peu plus spécial."
    ),
  ];

  return (
    <Layout>
      {/* Hero */}
      <section className="bg-background pt-10 pb-8 md:pt-16 md:pb-10">
        <div className="container mx-auto px-4 text-center">
          <h1 className="font-sans text-3xl md:text-5xl uppercase tracking-[0.105em] text-foreground">
            {t("OUR STORY", "NOTRE HISTOIRE")}
          </h1>
        </div>
        <div className="container mx-auto px-4 mt-8 md:mt-10">
          <PhotoSlot className="aspect-[16/7] md:aspect-[24/7] max-h-[380px]" label={t("HERO PHOTO", "PHOTO PRINCIPALE")} />
        </div>
      </section>

      {/* Chapitres en alternance */}
      <section className="bg-background pb-8">
        <div className="container mx-auto px-4">
          {chapters.map((chapter, index) => {
            const imageOnLeft = index % 2 === 1;
            return (
              <div
                key={chapter.id}
                className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-12 items-center py-8 md:py-12 border-t border-primary/10 first:border-t-0"
              >
                <div className={cn("order-1", imageOnLeft ? "md:order-2" : "md:order-1")}>
                  <h2 className="font-sans text-lg md:text-xl uppercase tracking-[0.105em] text-foreground mb-4">
                    {chapter.title}
                  </h2>
                  <div className="space-y-4">
                    {chapter.paragraphs.map((paragraph, i) => (
                      <p key={i} className="text-sm md:text-[15px] leading-relaxed text-foreground/85">
                        {paragraph}
                      </p>
                    ))}
                  </div>
                </div>
                <div className={cn("order-2", imageOnLeft ? "md:order-1" : "md:order-2")}>
                  <PhotoSlot className="aspect-[4/3] max-w-[420px] mx-auto" label={chapter.id === "first-years" ? t("PHOTO", "PHOTO") : chapter.id} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 2026, chapitre mis en avant */}
      <section className="bg-primary text-primary-foreground py-12 md:py-16">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-center">
            <div className="order-1">
              <p className="font-sans uppercase tracking-[0.3em] text-[10px] opacity-70 mb-4">
                {t("THE NEXT CHAPTER", "LA SUITE DE L'HISTOIRE")}
              </p>
              <h2 className="font-sans text-2xl md:text-3xl uppercase tracking-[0.105em] mb-6">
                {t("2026", "2026")}
              </h2>
              <div className="space-y-4">
                {chapter2026.map((paragraph, i) => (
                  <p key={i} className="text-sm md:text-[15px] leading-relaxed opacity-95">
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>
            <div className="order-2">
              <PhotoSlot className="aspect-[4/3] max-w-[420px] mx-auto" label="2026" light />
            </div>
          </div>
        </div>
      </section>

      {/* Final */}
      <section className="bg-background py-14 md:py-20">
        <div className="container mx-auto px-4 text-center">
          <p className="font-sans uppercase tracking-[0.2em] text-xs md:text-sm text-foreground mb-8">
            {t(
              "MORE CAKES. MORE CELEBRATIONS. MORE CREATIVITY.",
              "PLUS DE GÂTEAUX. PLUS DE CÉLÉBRATIONS. PLUS DE CRÉATIVITÉ."
            )}
          </p>
          <p className="font-sans text-3xl sm:text-4xl md:text-6xl uppercase tracking-[0.105em] text-foreground leading-tight">
            LET THEM EAT CAKES.
          </p>
        </div>
      </section>

      <ArchivesSlider />
    </Layout>
  );
};

export default OurStory;
