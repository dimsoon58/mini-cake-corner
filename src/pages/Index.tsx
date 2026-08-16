import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Layout from "@/components/Layout";
import { useLang } from "@/context/LanguageContext";
import logoCream from "@/assets/logo-cream.png";
import homeCatBento from "@/assets/home-cat-bento.jpg";
import homeCatDots from "@/assets/home-cat-dots.jpg";
import homeCatDiy from "@/assets/home-cat-diy.jpg";
import homeCatWorkshops from "@/assets/home-cat-workshops.jpg";
import homeCatRectangle from "@/assets/home-cat-rectangle.jpg";
import heroPoster from "@/assets/hero-poster.jpg";
import heroVideo from "@/assets/hero-video.mp4";
import featureCake from "@/assets/feature-cake.png";
import featurePipingBag from "@/assets/feature-piping-bag.png";
import featureWhisk from "@/assets/feature-whisk.png";
import customer1 from "@/assets/customer-1.jpg";
import customer2 from "@/assets/customer-2.jpg";
import customer3 from "@/assets/customer-3.jpg";
import customer4 from "@/assets/customer-4.jpg";
import customer5 from "@/assets/customer-5.jpg";
import customer6 from "@/assets/customer-6.jpg";
import customer7 from "@/assets/customer-7.jpg";
import customer8 from "@/assets/customer-8.jpg";
import customer9 from "@/assets/customer-9.jpg";
import customer10 from "@/assets/customer-10.jpg";
import customer11 from "@/assets/customer-11.jpg";
import customer12 from "@/assets/customer-12.jpg";
import customer13 from "@/assets/customer-13.jpg";
import customer14 from "@/assets/customer-14.jpg";
import customer15 from "@/assets/customer-15.jpg";
import customer16 from "@/assets/customer-16.jpg";
import customer17 from "@/assets/customer-17.jpg";
import customer18 from "@/assets/customer-18.jpg";
import customer19 from "@/assets/customer-19.jpg";
import customer20 from "@/assets/customer-20.jpg";
import customer21 from "@/assets/customer-21.jpg";
import customer22 from "@/assets/customer-22.jpg";
import customer23 from "@/assets/customer-23.jpg";
import customer24 from "@/assets/customer-24.jpg";
import customer25 from "@/assets/customer-25.jpg";
import customer26 from "@/assets/customer-26.jpg";
import customer27 from "@/assets/customer-27.jpg";
import customer28 from "@/assets/customer-28.jpg";
import customer29 from "@/assets/customer-29.jpg";
import customer30 from "@/assets/customer-30.jpg";
import customer31 from "@/assets/customer-31.jpg";
import customer32 from "@/assets/customer-32.jpg";
import customer33 from "@/assets/customer-33.jpg";
import customer34 from "@/assets/customer-34.jpg";
import comment7 from "@/assets/comment-7.png";
import comment8 from "@/assets/comment-8.png";
import comment9 from "@/assets/comment-9.png";
import comment10 from "@/assets/comment-10.png";
import comment11 from "@/assets/comment-11.png";
import comment12 from "@/assets/comment-12.png";
import comment13 from "@/assets/comment-13.png";
import comment14 from "@/assets/comment-14.png";
import comment15 from "@/assets/comment-15.png";
import comment16 from "@/assets/comment-16.png";
import comment17 from "@/assets/comment-17.png";
import comment18 from "@/assets/comment-18.png";
import comment19 from "@/assets/comment-19.png";
import comment21 from "@/assets/comment-21.png";
import comment26 from "@/assets/comment-26.png";
import comment27 from "@/assets/comment-27.png";
import comment28 from "@/assets/comment-28.png";
import comment29 from "@/assets/comment-29.png";
import comment30 from "@/assets/comment-30.png";
import comment31 from "@/assets/comment-31.png";
import comment32 from "@/assets/comment-32.png";
import comment33 from "@/assets/comment-33.png";
import comment34 from "@/assets/comment-34.png";
import comment35 from "@/assets/comment-35.png";
import comment36 from "@/assets/comment-36.png";
import comment37 from "@/assets/comment-37.png";
import comment38 from "@/assets/comment-38.png";
import comment39 from "@/assets/comment-39.png";
import comment40 from "@/assets/comment-40.png";
import comment41 from "@/assets/comment-41.png";
import comment42 from "@/assets/comment-42.png";

const customerPhotos = [
  customer3, customer4, customer5,
  customer7, customer9, customer10,
  customer11, customer12, customer13, customer15,
  customer16, customer17, customer18, customer19, customer20,
  customer21, customer22, customer23, customer24, customer25,
  customer26, customer27, customer28, customer29,
  customer30, customer32, customer33, customer34,
];

// Placeholder array for customer comment images, add imports here later
const customerCommentPhotos: string[] = [
  comment26, comment7, comment27, comment8, comment28,
  comment9, comment29, comment10, comment30, comment31,
  comment11, comment32, comment12, comment33, comment13,
  comment34, comment14, comment35, comment15, comment36,
  comment37, comment16, comment38, comment17, comment39,
  comment18, comment40, comment19, comment41, comment42,
  comment21,
];

/* Original hand-drawn brand illustrations, cropped from the Canva design */
const features = [
  {
    title: "Personalised",
    titleFr: "Personnalisé",
    description: "Your perfect cake, from flavours to decoration.",
    descFr: "Des saveurs à la décoration, personnalisez chaque détail de votre gâteau.",
    image: featureCake,
  },
  {
    title: "Whipped Cream Cakes",
    titleFr: "Gâteaux à la crème fouettée",
    description: "Light, fluffy and delicious.",
    descFr: "Léger, aérien et délicieux.",
    image: featurePipingBag,
  },
  {
    title: "Fresh ingredients",
    titleFr: "Ingrédients frais",
    description: "Made with fresh ingredients. No preservatives.",
    descFr: "Préparés avec des ingrédients frais, sans conservateurs.",
    image: featureWhisk,
  },
];

const PhotoCarousel = ({ photos, altPrefix, contain = false }: { photos: string[]; altPrefix: string; contain?: boolean }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: "left" | "right") => {
    if (!scrollRef.current) return;
    const scrollAmount = 320;
    scrollRef.current.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  };

  if (photos.length === 0) {
    return (
      <p className="text-center text-muted-foreground italic">{t("Coming soon...", "Bientôt disponible...")}</p>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => scroll("left")}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-background/80 hover:bg-background rounded-none p-2 shadow-md -ml-4"
      >
        <ChevronLeft className="h-6 w-6 text-foreground" />
      </button>
      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto scrollbar-hide scroll-smooth px-4"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {photos.map((photo, index) => (
            <div
              key={index}
              className={`flex-shrink-0 h-80 overflow-hidden ${contain ? "w-[26rem]" : "w-72"}`}
            >
              <img
                src={photo}
                alt={`${altPrefix} ${index + 1}`}
                className={`w-full h-full ${contain ? "object-contain" : "object-cover"}`}
              />
            </div>
        ))}
      </div>
      <button
        onClick={() => scroll("right")}
        className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-background/80 hover:bg-background rounded-none p-2 shadow-md -mr-4"
      >
        <ChevronRight className="h-6 w-6 text-foreground" />
      </button>
    </div>
  );
};

const Index = () => {
  const discoverRef = useRef<HTMLDivElement>(null);
  const { t, lang } = useLang();

  const scrollDiscover = (dir: "left" | "right") => {
    discoverRef.current?.scrollBy({ left: dir === "left" ? -360 : 360, behavior: "smooth" });
  };

  return (
    <Layout overlayHero>
      {/* Hero Section */}
      <section className="relative text-primary-foreground overflow-hidden min-h-[80vh]">
        <video
          className="absolute inset-0 w-full h-full object-cover"
          style={{ objectPosition: "center 40%" }}
          src={heroVideo}
          poster={heroPoster}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
        />
        <div className="absolute inset-0 bg-foreground/30" />
        <div className="relative container mx-auto px-4 py-24 md:py-32 text-center text-cream">
          {/* Brand spec: Agrandir Bold 50px, Montserrat stands in until the Agrandir font file is provided */}
          <h1 className="font-sans font-bold text-[36px] md:text-[50px] leading-tight mb-6 max-w-4xl mx-auto">
            {t("LET THEM EAT CAKE", "LET THEM EAT CAKE")}
          </h1>
          <p className="text-base md:text-lg max-w-2xl mx-auto opacity-95 mb-10 font-light tracking-wide">
            {t("Signature whipped cream cakes, delicately crafted, beautifully designed, and irresistibly light.", "Des gâteaux signature à la crème fouettée, décorés avec finesse et incroyablement légers.")}
          </p>
          <Button
            size="lg"
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-10 py-6 text-[14px] font-medium tracking-[0.105em] rounded-none"
            asChild
          >
            <Link to="/catalog">{t("SHOP NOW", "COMMANDER")}</Link>
          </Button>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            {features.map((feature) => (
              <div key={feature.title} className="text-center flex flex-col items-center">
                <div className="h-[180px] md:h-[210px] flex items-end justify-center mb-6">
                  <img
                    src={feature.image}
                    alt={feature.title}
                    className="max-h-full w-auto object-contain"
                  />
                </div>
                <h3 className="font-script font-normal text-[32px] md:text-[40px] leading-normal text-foreground mb-3 whitespace-nowrap">
                  {lang === "fr" ? feature.titleFr : feature.title}
                </h3>
                <p className="text-sm text-foreground/80 leading-relaxed max-w-[230px]">
                  {lang === "fr" ? feature.descFr : feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Discover Section, category cards */}
      <section className="py-20 bg-background">
        <div className="relative w-full px-4 sm:px-8">
          <button onClick={() => scrollDiscover("left")} aria-label="Scroll left" className="hidden md:flex absolute left-2 top-1/2 -translate-y-1/2 z-10 bg-background/80 hover:bg-background p-2 shadow-md items-center justify-center">
            <ChevronLeft className="h-6 w-6 text-foreground" />
          </button>
          <div ref={discoverRef} className="flex gap-6 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {[
              { image: homeCatBento, label: "BENTO CAKES", labelFr: "BENTO CAKES", to: "/catalog" },
              { image: homeCatRectangle, label: "RECTANGLE CAKES", labelFr: "RECTANGLE CAKES", to: "/catalog#rectangle-cakes" },
              { image: homeCatDiy, label: "DIY KITS", labelFr: "DIY KITS", to: "/kit-bento-cake" },
              { image: homeCatDots, label: "DOT CAKES", labelFr: "DOT CAKES", to: "/dot-cakes" },
            ].map((category) => (
              <Link
                key={category.label}
                to={category.to}
                className="relative snap-start flex-shrink-0 w-[80%] sm:w-[46%] lg:w-[calc((100%-3rem)/3)] aspect-square overflow-hidden group"
              >
                <img
                  src={category.image}
                  alt={category.label}
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-x-0 bottom-0 p-8">
                  <p className="text-cream uppercase tracking-[0.105em] text-lg md:text-xl font-medium mb-4 drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
                    {lang === "fr" ? category.labelFr : category.label}
                  </p>
                  <span className="inline-block bg-primary group-hover:bg-primary/90 text-primary-foreground text-center uppercase tracking-[0.105em] text-sm font-medium px-8 py-2.5 transition-colors">
                    {t("DISCOVER", "DÉCOUVRIR")}
                  </span>
                </div>
              </Link>
            ))}
          </div>
          <button onClick={() => scrollDiscover("right")} aria-label="Scroll right" className="hidden md:flex absolute right-2 top-1/2 -translate-y-1/2 z-10 bg-background/80 hover:bg-background p-2 shadow-md items-center justify-center">
            <ChevronRight className="h-6 w-6 text-foreground" />
          </button>
        </div>

        {/* Workshops banner, full browser width, no side margins */}
        <Link
          to="/workshop"
          className="relative block mt-8 w-full aspect-[16/9] md:aspect-[16/5] overflow-hidden group"
        >
          <img
            src={homeCatWorkshops}
            alt="Workshops"
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-0 flex flex-col items-center justify-end text-center px-4 pb-8 md:pb-10">
            <p className="text-cream uppercase tracking-[0.105em] text-lg md:text-xl font-medium mb-4 drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
              {t("WORKSHOPS", "ATELIERS")}
            </p>
            <span className="inline-block bg-primary group-hover:bg-primary/90 text-primary-foreground text-center uppercase tracking-[0.105em] text-sm font-medium px-12 py-2.5 transition-colors">
              {t("DISCOVER", "DÉCOUVRIR")}
            </span>
          </div>
        </Link>
      </section>

      {/* Customers Section */}
      <section className="py-20 bg-cream">
        <div className="container mx-auto px-4">
          <h2 className="font-sans text-4xl md:text-5xl text-center tracking-[0.105em] text-foreground mb-16">
            {t("OUR CUSTOMERS", "NOS CLIENTS")}
          </h2>
          <PhotoCarousel photos={customerPhotos} altPrefix="Happy customer" />
        </div>
      </section>

      {/* Customer Comments Section */}
      <section className="py-16 bg-background">
        <div className="container mx-auto px-4">
          <h2 className="font-sans text-4xl md:text-5xl text-center tracking-[0.105em] text-foreground mb-6">
            {t("CUSTOMER COMMENTS", "AVIS CLIENTS")}
          </h2>
          <PhotoCarousel photos={customerCommentPhotos} altPrefix="Customer comment" contain />
        </div>
      </section>

      {/* CTA Section, lace doily style */}
      <section className="py-16 bg-background">
        <div className="w-full px-4 sm:px-6">
          <div className="w-full border-[3px] border-primary p-1.5">
            <div className="text-center border border-primary px-8 py-16 md:px-16">
            <h2 className="font-script font-normal text-4xl md:text-5xl text-foreground mb-6">
              {t("Ready to order your perfect cake?", "Prêt à créer votre gâteau idéal ?")}
            </h2>
            <p className="text-sm md:text-base text-foreground/80 mb-10 max-w-md mx-auto">
              {t("Browse our collection and personalise your cake in just a few steps.", "Parcourez notre collection et personnalisez votre gâteau en quelques étapes.")}
            </p>
            <Button
              size="lg"
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-10 py-6 text-[14px] font-medium tracking-[0.105em] rounded-none"
              asChild
            >
              <Link to="/catalog">{t("SHOP NOW", "COMMANDER")}</Link>
            </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-primary text-primary-foreground py-12">
        <div className="container mx-auto px-4 text-center">
            <img
              src={logoCream}
              alt="Bento Cake Studio"
              className="h-12 md:h-14 w-auto mx-auto mb-6"
            />
            <p className="text-sm opacity-90 mb-4">
              {t("© 2026 Bento Cake Studio SNC. All rights reserved.", "© 2026 Bento Cake Studio SNC. Tous droits réservés.")}
            </p>
            <p className="text-sm opacity-70 mb-4">
              <Link to="/legal" className="underline hover:opacity-100">
                {t("Terms and Conditions & Privacy Policy", "Conditions générales et politique de confidentialité")}
              </Link>
            </p>
            <p className="text-sm opacity-70">
              <Link to="/newsletter" className="underline hover:opacity-100">
                {t("Subscribe to newsletter", "S'abonner à la newsletter")}
              </Link>
            </p>
        </div>
      </footer>
    </Layout>
  );
};

export default Index;
