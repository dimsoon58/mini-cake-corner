import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Layout from "@/components/Layout";
import CorporateQuoteForm from "@/components/CorporateQuoteForm";

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

const sections = [
  {
    title: "VIP Reception",
    images: [
      { src: corporateEvent4, alt: "Custom cake with illustration for VIP reception" },
      { src: corporateEvent5, alt: "Catering service with custom cake at a reception" },
      { src: corporateEvent6, alt: "Cake with custom artistic design" },
    ],
  },
  {
    title: "Corporate Celebration",
    images: [
      { src: corporateEvent1, alt: "Custom cake with company logo and sparklers" },
      { src: corporateEvent2, alt: "Custom Red Velvet cake for corporate event" },
      { src: corporateEvent3, alt: "Cake with printed logo for brand launch" },
    ],
  },
  {
    title: "Charity Event",
    images: [
      { src: corporateEvent10, alt: "Elegant blue cake for charity event" },
      { src: corporateEvent11, alt: "Cake decorating workshop for team building" },
      { src: corporateEvent12, alt: "Artistic creation with vintage details for prestigious event" },
    ],
  },
  {
    title: "Corporate Gift",
    images: [
      { src: corporateEvent8, alt: "Elegant packaging with ribbon for corporate gifts" },
      { src: corporateEvent9, alt: "Assortment of custom cakes for brand event" },
      { src: corporateEvent7, alt: "Colorful custom cakes for Yuh brand partnership" },
    ],
  },
];

const ImageCarousel = ({ images }: { images: { src: string; alt: string }[] }) => {
  const [current, setCurrent] = useState(0);

  const prev = () => setCurrent((c) => (c === 0 ? images.length - 1 : c - 1));
  const next = () => setCurrent((c) => (c === images.length - 1 ? 0 : c + 1));

  return (
    <div className="relative group">
      <div className="aspect-[4/3] overflow-hidden rounded-2xl bg-muted">
        <img
          src={images[current].src}
          alt={images[current].alt}
          className="w-full h-full object-cover transition-all duration-500"
        />
      </div>

      <button
        onClick={prev}
        className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-none bg-background/80 backdrop-blur-sm border border-border shadow-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-background"
        aria-label="Previous image"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <button
        onClick={next}
        className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-none bg-background/80 backdrop-blur-sm border border-border shadow-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-background"
        aria-label="Next image"
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      {/* Dots */}
      <div className="flex justify-center gap-2 mt-3">
        {images.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className={`w-2 h-2 rounded-full transition-all ${
              i === current ? "bg-primary w-6" : "bg-muted-foreground/30"
            }`}
            aria-label={`Go to image ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
};

const CorporateEvent = () => {
  const [quoteOpen, setQuoteOpen] = useState(false);

  return (
    <Layout>
      <div className="container mx-auto px-4 py-16">
        <h1 className="font-serif text-4xl md:text-5xl text-center text-foreground mb-4">
          Corporate Events
        </h1>

        {/* CTA Section */}
        <div className="text-center mb-12 max-w-2xl mx-auto">
          <p className="text-muted-foreground text-lg mb-2">
            Interested in our corporate services?
          </p>
          <p className="text-muted-foreground text-lg mb-6">
            Let's create something special for your next corporate event.
          </p>
          <button
            onClick={() => setQuoteOpen(true)}
            className="inline-flex items-center justify-center h-11 px-10 text-base bg-primary text-primary-foreground rounded-full font-medium tracking-wide hover:bg-primary/90 transition-colors"
          >
            Get a Quote
          </button>
        </div>

        {/* Carousel sections */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          {sections.map((section) => (
            <div key={section.title}>
              <h2 className="font-serif text-2xl text-foreground mb-4 text-center">
                {section.title}
              </h2>
              <ImageCarousel images={section.images} />
            </div>
          ))}
        </div>
      </div>

      <CorporateQuoteForm open={quoteOpen} onOpenChange={setQuoteOpen} />
    </Layout>
  );
};

export default CorporateEvent;
