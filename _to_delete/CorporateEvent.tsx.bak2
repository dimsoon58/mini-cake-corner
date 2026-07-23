import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Palette, Truck, HeartHandshake, ChefHat } from "lucide-react";
import Layout from "@/components/Layout";
import CorporateQuoteForm from "@/components/CorporateQuoteForm";
import { Button } from "@/components/ui/button";

import corporateEvent1 from "@/assets/corporate-event-1.png";
import corporateEvent2 from "@/assets/corporate-event-2.png";
import corporateEvent3 from "@/assets/corporate-event-3.png";
import corporateEvent4 from "@/assets/corporate-event-4.png";
import corporateEvent5 from "@/assets/corporate-event-5.png";
import corporateEvent6 from "@/assets/corporate-event-6.png";
import corporateEvent7 from "@/assets/corporate-event-7.png";
import corporateEvent8 from "@/assets/corporate-event-8.png";
import corporateEvent9 from "@/assets/corporate-event-9.png";
import corporateEvent10 from "@/assets/corporate-event-10.png";
import corporateEvent11 from "@/assets/corporate-event-11.png";
import corporateEvent12 from "@/assets/corporate-event-12.png";
import pressLogoEleventy from "@/assets/press-logo-eleventy.png";
import pressLogoSurya from "@/assets/press-logo-surya.png";
import pressLogoAmc from "@/assets/press-logo-amc.png";
import pressLogoYuh from "@/assets/press-logo-yuh.png";

const galleryPhotos = [
  corporateEvent1, corporateEvent2, corporateEvent3, corporateEvent4,
  corporateEvent5, corporateEvent6, corporateEvent7, corporateEvent8,
  corporateEvent9, corporateEvent10, corporateEvent11, corporateEvent12,
];

const whyItems = [
  {
    icon: Palette,
    title: "Brand-Perfect Design",
    text: "Your logo, brand colours and visual identity, handcrafted into every cake, from edible prints to custom colour palettes.",
  },
  {
    icon: Truck,
    title: "Delivered Across Geneva",
    text: "Reliable delivery and on-site setup available.",
  },
  {
    icon: HeartHandshake,
    title: "Dedicated Service",
    text: "A personalised quote within 48 hours, a single point of contact, and end-to-end support from first brief to final delivery.",
  },
  {
    icon: ChefHat,
    title: "Handcrafted in Geneva",
    text: "Made fresh to order with premium ingredients, no preservatives, by our Geneva atelier.",
  },
];

const services = [
  { label: "CORPORATE GIFTS", image: corporateEvent2 },
  { label: "TEAM CELEBRATIONS", image: corporateEvent5 },
  { label: "CLIENT & VIP EVENTS", image: corporateEvent8 },
  { label: "PRODUCT LAUNCHES & BRAND EVENTS", image: corporateEvent11 },
];

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h2 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-4xl text-center text-foreground mb-14">
    {children}
  </h2>
);

const CorporateEvent = () => {
  const [quoteOpen, setQuoteOpen] = useState(false);
  const galleryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "Corporate Cakes & Events – Bento Cake Studio";
    return () => {
      document.title = "Bento Cake Studio Geneva";
    };
  }, []);

  const scrollGallery = (direction: "left" | "right") => {
    galleryRef.current?.scrollBy({
      left: direction === "left" ? -400 : 400,
      behavior: "smooth",
    });
  };

  return (
    <Layout overlayHero>
      {/* Hero, full width, full screen */}
      <section className="relative h-screen min-h-[560px] w-full overflow-hidden">
        {/* Placeholder photo, swap for the dedicated hero image when provided */}
        <img
          src={corporateEvent5}
          alt="Corporate cakes and events by Bento Cake Studio"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-foreground/40" />
        <div className="relative h-full flex flex-col items-center justify-center text-center px-4">
          <h1 className="font-sans uppercase tracking-[0.105em] text-3xl md:text-5xl text-cream leading-tight mb-6 max-w-4xl">
            CORPORATE & PRESS
          </h1>
          <p className="text-cream/95 text-base md:text-lg font-light max-w-2xl mb-10">
            Bespoke cakes, dessert tables and sweet experiences designed for
            brands, corporate events and unforgettable celebrations.
          </p>
          <Button
            onClick={() => setQuoteOpen(true)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-10 py-6 text-[14px] font-medium uppercase tracking-[0.105em] rounded-none"
          >
            REQUEST A QUOTE
          </Button>
        </div>
      </section>

      {/* Why companies choose us */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4">
          <SectionTitle>WHY COMPANIES CHOOSE BENTO CAKE STUDIO?</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-12 max-w-6xl mx-auto">
            {whyItems.map((item) => (
              <div key={item.title} className="text-center flex flex-col items-center">
                <item.icon className="w-10 h-10 text-primary mb-5" strokeWidth={1.25} />
                <h3 className="font-sans text-sm font-semibold uppercase tracking-[0.105em] text-foreground mb-3">
                  {item.title}
                </h3>
                <p className="text-sm text-foreground/75 leading-relaxed max-w-[240px]">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Our services, home-page style cards */}
      <section className="py-20 bg-background">
        <div className="w-full px-4 sm:px-8">
          <SectionTitle>OUR SERVICES</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {services.map((service) => (
              <button
                key={service.label}
                onClick={() => setQuoteOpen(true)}
                className="relative block aspect-[3/4] overflow-hidden group text-left"
              >
                <img
                  src={service.image}
                  alt={service.label}
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-foreground/20" />
                <div className="absolute left-6 bottom-6">
                  <p className="text-cream uppercase tracking-[0.105em] text-base md:text-lg font-medium drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]">
                    {service.label}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Gallery */}
      <section className="py-20 bg-cream">
        <div className="container mx-auto px-4">
          <SectionTitle>OUR CORPORATE CREATIONS</SectionTitle>
        </div>
        <div className="relative px-4">
          <button
            onClick={() => scrollGallery("left")}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 bg-background/80 hover:bg-background rounded-none p-2 shadow-md"
            aria-label="Scroll gallery left"
          >
            <ChevronLeft className="h-6 w-6 text-foreground" />
          </button>
          <div
            ref={galleryRef}
            className="flex gap-4 overflow-x-auto scroll-smooth px-4"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {galleryPhotos.map((photo, index) => (
              <div key={index} className="flex-shrink-0 w-80 h-96 overflow-hidden">
                <img
                  src={photo}
                  alt={`Corporate event ${index + 1}`}
                  className="w-full h-full object-cover"
                />
              </div>
            ))}
          </div>
          <button
            onClick={() => scrollGallery("right")}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 bg-background/80 hover:bg-background rounded-none p-2 shadow-md"
            aria-label="Scroll gallery right"
          >
            <ChevronRight className="h-6 w-6 text-foreground" />
          </button>
        </div>
      </section>

      {/* Press */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4">
          <SectionTitle>PRESS</SectionTitle>
          <p className="text-center text-muted-foreground text-sm max-w-2xl mx-auto mb-14">
            Magazine features, press articles, interviews, collaborations and
            media appearances.
          </p>
          {/* Press features: replace these placeholders with real articles —
              each card takes an image, a publication name, a title and a link. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {[1, 2, 3].map((slot) => (
              <div key={slot} className="border border-border/60 flex flex-col">
                <div className="aspect-[4/3] bg-muted/40 flex items-center justify-center">
                  <span className="text-[10px] uppercase tracking-[0.105em] text-muted-foreground/50">
                    Feature coming soon
                  </span>
                </div>
                <div className="p-5 text-center">
                  <p className="text-[11px] uppercase tracking-[0.105em] text-muted-foreground mb-1.5">
                    Publication
                  </p>
                  <p className="font-serif text-lg text-foreground/60 italic">
                    Press feature title
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trusted by */}
      <section className="py-20 bg-cream">
        <div className="container mx-auto px-4">
          <SectionTitle>TRUSTED BY</SectionTitle>
          <div className="flex flex-wrap justify-center items-center gap-x-20 gap-y-12 max-w-5xl mx-auto">
            {[
              { src: pressLogoEleventy, alt: "Eleventy" },
              { src: pressLogoSurya, alt: "Sūrya Children" },
              { src: pressLogoAmc, alt: "AMC Studio" },
              { src: pressLogoYuh, alt: "Yuh" },
            ].map((logo) => (
              <img
                key={logo.alt}
                src={logo.src}
                alt={logo.alt}
                className="h-16 md:h-20 w-auto object-contain opacity-80 hover:opacity-100 transition-opacity"
              />
            ))}
          </div>
        </div>
      </section>

      <CorporateQuoteForm open={quoteOpen} onOpenChange={setQuoteOpen} />
    </Layout>
  );
};

export default CorporateEvent;
