import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Layout from "@/components/Layout";
import { useLang } from "@/context/LanguageContext";
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
  customer4, customer5, customer7,
  customer9, customer10, customer11,
  customer12, customer13, customer15, customer3,
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

const testimonials = [
  { text: "Avec grand plaisir ! on vient de le goûter c'est un délice 🥰", photo: comment26 },
  { text: "Bonjour c'était seulement pour vous remercier du travail que vous avez fait, le gâteau etait très bon en plus d'être très joli. Je reviendrai sûrement vers vous pour une autre commande prochainement. Merci encore 😌", photo: comment7 },
  { text: "Merci encore il etait innncroyablement bon", photo: comment27 },
  { text: "Thank you so much for the cake! It was delicious! The best bento cake I ever had! All my guests liked it so much! 🥰", photo: comment8 },
  { text: "I got the cake thank youuu it looks super cute", photo: comment28 },
  { text: "Bonjour, Je tiens à vous remercier pour le gâteau, il était délicieux et visuellement parfait 😊", photo: comment9 },
  { text: "Il était excellent 🙌🙌", photo: comment29 },
  { text: "Bonjour, je tenais à vous faire un retour pour vos gâteaux — Ils étaient aussi beaux que bons, vraiment incroyables. Merci d'avoir rendu notre fête encore plus belle grâce à vos talents culinaires. 😄🥰❤️", photo: comment10 },
  { text: "Merci beaucoup pour le gateau il est magnifique vraiment je m'attendais pas à quelque chose d'aussi beau", photo: comment30 },
  { text: "Merci beaucoup !! Il est magnifique", photo: comment31 },
  { text: "Hi! Just wanted to say that we loved the cake!:)) it was so good, we devoured it in 5mins 😊 thanks once again 💜", photo: comment11 },
  { text: "Merci encore pour le gateau! Il etait trop beau et bonnnn 🥰", photo: comment32 },
  { text: "Bonsoir ! C'était pour vous dire que le red velvet était délicieux une tuerie 🤭", photo: comment12 },
  { text: "Merci mille fois! Ils etaient magnifiques et delicieux", photo: comment33 },
  { text: "Merci! Le gâteau était délicieux! 🙏 🌟", photo: comment13 },
  { text: "Super merci bcp le gâteau est trop mignon 🥰", photo: comment34 },
  { text: "j'ai adoré merci beaucoup les filles!!! top ce que vous faites", photo: comment14 },
  { text: "Bonjour, j'espère que vous allez bien ! Merci encore pour le gâteau, il était délicieux 😍", photo: comment35 },
  { text: "Merci! Adoré ma surprise! 😍", photo: comment15 },
  { text: "c'était succulentissime merci beaucoup pour le service, je recommanderai sans hésiter 🥰😘", photo: comment36 },
  { text: "Merci beaucoup, le gâteau est top au visu déjà je suis super contente !", photo: comment37 },
  { text: "Il est DÉLICIEUX ! WOW. On est choqué. Genre il est juste délicieux. Beau travail et bon travail !", photo: comment16 },
  { text: "Bonjour merci pour les gâteaux ils étaient super!", photo: comment38 },
  { text: "Coucou TROP bien !!! On vient de tout finir ! Ma famille a adoré ! Tu risques de recevoir beaucoup de commandes pour tous les évènements 🤣🤣 joyeux noel ! 🎅🤍✨🎄", photo: comment17 },
  { text: "Je viens de goûter et puis c'est un vrai délice merci beaucoup. La génoise est juste parfaite", photo: comment39 },
  { text: "Fantastique vraiment. Aussi bon qu'il est beau. C'était génial. Ma soeur et les invités adorent !!! Merci encore vraiment. J'adore ce que tu fais et j'espère que tu t'amuses à les faire.", photo: comment18 },
  { text: "C'était délicieux merci beaucoup!!!", photo: comment40 },
  { text: "Hey thanks sooo much for the lovely cake ! It was just the perfect size and so yummy ! Loved it x", photo: comment19 },
  { text: "Encore merci pour le gâteau, il était incroyable!!", photo: comment41 },
  { text: "Merci pour le gateau, mes invitées ont beaucoup aimé! Il y en avait presque plus à la fin", photo: comment42 },
  { text: "Oh my god. The cake is breathtaking. It's so so so pretty. And the taste — oh my god so so so good. No egg taste. Not too sweet but just the flavor. WOW. Sincèrement merci beaucoup", photo: comment21 },
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
  // Was missing entirely — the empty-state branch below calls t(...) without
  // this component ever calling useLang() itself, a real "Cannot find name
  // 't'" crash risk (not just a type error) whenever photos is empty.
  const { t } = useLang();
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
              className={`flex-shrink-0 overflow-hidden ${contain ? "h-52 w-[16rem]" : "h-64 w-56"}`}
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
  const mobileVideoRef = useRef<HTMLVideoElement>(null);
  const { t, lang } = useLang();

  // iOS Safari ignores the `autoplay` HTML attribute unless we also call
  // .play() programmatically after mount with muted=true already set.
  useEffect(() => {
    const v = mobileVideoRef.current;
    if (!v) return;
    v.muted = true;
    v.play().catch(() => {/* autoplay blocked by browser/device policy, silent */});
  }, []);

  const scrollDiscover = (dir: "left" | "right") => {
    discoverRef.current?.scrollBy({ left: dir === "left" ? -360 : 360, behavior: "smooth" });
  };

  // Testimonials state
  const [testimonialPage, setTestimonialPage] = useState(0);
  const [modalPhoto, setModalPhoto] = useState<string | null>(null);
  const [cardsPerPage, setCardsPerPage] = useState(() => {
    if (typeof window === "undefined") return 3;
    if (window.innerWidth >= 1024) return 3;
    if (window.innerWidth >= 640) return 2;
    return 1;
  });

  useEffect(() => {
    const update = () => {
      const cpp = window.innerWidth >= 1024 ? 3 : window.innerWidth >= 640 ? 2 : 1;
      setCardsPerPage(cpp);
      setTestimonialPage(0);
    };
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!modalPhoto) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setModalPhoto(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalPhoto]);

  const totalTestimonialPages = Math.ceil(testimonials.length / cardsPerPage);

  return (
    <Layout overlayHero>
      {/* Hero Section */}
      <section className="relative text-primary-foreground overflow-hidden min-h-[65vh] md:min-h-0 md:aspect-video">
        {/* Mobile video */}
        <video
          ref={mobileVideoRef}
          className="absolute inset-0 w-full h-full object-cover scale-[1.01] block md:hidden"
          poster={heroPoster}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
        >
          <source src={`${import.meta.env.BASE_URL}hero-mobile.mp4`} type="video/mp4" />
        </video>
        {/* Desktop video */}
        <video
          className="absolute inset-0 w-full h-full object-cover scale-[1.01] hidden md:block"
          src={heroVideo}
          poster={heroPoster}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
        />
        <div className="absolute inset-0 bg-foreground/15" />
        <div className="relative container mx-auto px-4 py-24 md:py-32 text-center text-cream">
          {/* Brand spec: Agrandir Bold 50px, Montserrat stands in until the Agrandir font file is provided */}
          <h1 className="font-sans font-bold text-[36px] md:text-[50px] leading-tight mb-6 max-w-4xl mx-auto">
            {t("LET THEM EAT CAKES", "LET THEM EAT CAKES")}
          </h1>
          <p className="text-sm md:text-base max-w-2xl mx-auto opacity-95 mb-10 font-light tracking-wide">
            {t("Signature whipped cream cakes, delicately crafted, beautifully designed, and irresistibly light.", "Des gâteaux signature à la crème fouettée, décorés avec finesse et incroyablement légers.")}
          </p>
          <Button
            size="lg"
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-10 py-2.5 text-[14px] font-medium tracking-[0.105em] rounded-none"
            asChild
          >
            <Link to="/catalog">{t("SHOP NOW", "COMMANDER")}</Link>
          </Button>
        </div>
      </section>

      <div className="flex flex-col">

      {/* Features Section */}
      <section className="order-2 pt-0 pb-3 md:py-8 bg-background">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-[30px] md:gap-12">
            {features.map((feature) => (
              <div key={feature.title} className="text-center flex flex-col items-center">
                <div className="h-[100px] md:h-[180px] flex items-end justify-center mb-2 md:mb-5">
                  <img
                    src={feature.image}
                    alt={feature.title}
                    className="max-h-full w-auto object-contain"
                  />
                </div>
                <h3 className="font-script font-normal text-[26px] md:text-[40px] leading-normal text-foreground mb-2 md:mb-3 whitespace-nowrap">
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
      <section className="order-1 pt-20 pb-10 bg-background">
        <div className="relative w-full px-4 sm:px-8">
          <button onClick={() => scrollDiscover("left")} aria-label="Scroll left" className="flex absolute left-2 top-1/2 -translate-y-1/2 z-10 bg-background/90 hover:bg-background p-2 shadow-md items-center justify-center">
            <ChevronLeft className="h-6 w-6 text-foreground" />
          </button>
          <div ref={discoverRef} className="flex gap-6 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {[
              { image: homeCatBento, label: "BENTO CAKES", labelFr: "BENTO CAKES", to: "/catalog" },
              { image: homeCatRectangle, label: "RECTANGLE CAKES", labelFr: "RECTANGLE CAKES", to: "/catalog#rectangle-cakes" },
              { image: homeCatDiy, label: "BENTO KITS", labelFr: "BENTO KITS", to: "/kit-bento-cake" },
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

                {/* Title button — bottom left */}
                <div className="absolute bottom-5 left-5 md:bottom-7 md:left-7">
                  <span className="block bg-primary group-hover:bg-primary/90 text-primary-foreground text-center uppercase tracking-[0.105em] text-sm font-semibold px-8 py-2.5 transition-colors">
                    {lang === "fr" ? category.labelFr : category.label}
                  </span>
                </div>
              </Link>
            ))}
          </div>
          <button onClick={() => scrollDiscover("right")} aria-label="Scroll right" className="flex absolute right-2 top-1/2 -translate-y-1/2 z-10 bg-background/90 hover:bg-background p-2 shadow-md items-center justify-center">
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

          {/* Title button — bottom center */}
          <div className="absolute inset-x-0 bottom-6 md:bottom-10 flex justify-center">
            <span className="inline-block bg-primary group-hover:bg-primary/90 text-primary-foreground text-center uppercase tracking-[0.105em] text-sm font-semibold px-12 py-2.5 transition-colors">
              {t("WORKSHOPS", "ATELIERS")}
            </span>
          </div>
        </Link>
      </section>

      </div>{/* end flex-col reorder wrapper */}

      {/* Customers Section */}
      <section className="pt-12 pb-6 bg-cream">
        <div className="container mx-auto px-4">
          <h2 className="font-sans text-2xl md:text-3xl text-center uppercase tracking-[0.105em] text-foreground mb-10">
            {t("OUR CUSTOMERS", "NOS CLIENTS")}
          </h2>
          <PhotoCarousel photos={customerPhotos} altPrefix="Happy customer" />
        </div>
      </section>

      {/* Testimonials Section — LOVED BY YOU */}
      <section className="pt-12 pb-12 bg-background">
        <div className="container mx-auto px-4">
          <h2 className="font-sans text-2xl md:text-3xl text-center uppercase tracking-[0.105em] text-foreground mb-2">
            {t("LOVED BY YOU", "VOS PETITS MOTS")}
          </h2>
          <p className="text-center text-sm text-foreground/55 mb-10 tracking-wide">
            {t("Sweet words from our customers", "Les doux mots de nos clients")}
          </p>

          {/* Cards grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {testimonials
              .slice(testimonialPage * cardsPerPage, (testimonialPage + 1) * cardsPerPage)
              .map((testimonial, i) => (
                <div
                  key={`${testimonialPage}-${i}`}
                  className="border border-foreground/12 bg-background p-6 flex flex-col gap-3 min-h-[180px]"
                >
                  <div className="text-amber-400 text-base tracking-widest">★★★★★</div>
                  <p className="text-foreground/75 text-sm leading-relaxed flex-1 italic">
                    "{testimonial.text}"
                  </p>
                  <div className="pt-3 border-t border-foreground/10">
                    <p className="text-[11px] text-foreground/45 uppercase tracking-[0.12em] mb-1.5">
                      {t("Bento Cake Studio customer", "Client Bento Cake Studio")}
                    </p>
                    <button
                      onClick={() => setModalPhoto(testimonial.photo)}
                      className="text-[11px] text-foreground/50 hover:text-foreground underline underline-offset-2 transition-colors"
                    >
                      {t("View original message ↗", "Voir le message original ↗")}
                    </button>
                  </div>
                </div>
              ))}
          </div>

          {/* Dot navigation */}
          <div className="flex items-center justify-center gap-3 mt-8">
            <button
              onClick={() => setTestimonialPage(p => Math.max(0, p - 1))}
              disabled={testimonialPage === 0}
              className="p-1 text-foreground/40 hover:text-foreground disabled:opacity-20 transition-colors"
              aria-label="Previous"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <div className="flex gap-1.5 flex-wrap justify-center max-w-xs">
              {Array.from({ length: totalTestimonialPages }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setTestimonialPage(i)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    i === testimonialPage
                      ? "bg-foreground scale-125"
                      : "bg-foreground/20 hover:bg-foreground/40"
                  }`}
                  aria-label={`Page ${i + 1}`}
                />
              ))}
            </div>

            <button
              onClick={() => setTestimonialPage(p => Math.min(totalTestimonialPages - 1, p + 1))}
              disabled={testimonialPage === totalTestimonialPages - 1}
              className="p-1 text-foreground/40 hover:text-foreground disabled:opacity-20 transition-colors"
              aria-label="Next"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      </section>

      {/* Screenshot modal/lightbox */}
      {modalPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setModalPhoto(null)}
        >
          <div
            className="relative max-w-sm w-full max-h-[85vh] overflow-auto bg-white"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setModalPhoto(null)}
              className="absolute top-2 right-3 text-black/50 hover:text-black text-2xl font-light z-10 leading-none"
              aria-label="Close"
            >
              ✕
            </button>
            <img
              src={modalPhoto}
              alt="Original customer message"
              className="w-full h-auto block"
            />
          </div>
        </div>
      )}

      {/* CTA Section, lace doily style */}
      <section className="pt-4 pb-16 bg-background">
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
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-10 py-2.5 text-[14px] font-medium tracking-[0.105em] rounded-none"
              asChild
            >
              <Link to="/catalog">{t("SHOP NOW", "COMMANDER")}</Link>
            </Button>
            </div>
          </div>
        </div>
      </section>

    </Layout>
  );
};

export default Index;
