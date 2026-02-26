import { useState } from "react";
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

const corporateEvents = [
  { id: 1, image: corporateEvent1, title: "Corporate Celebration", description: "Custom cake with company logo and sparklers" },
  { id: 2, image: corporateEvent2, title: "Corporate Celebration", description: "Custom Red Velvet cake for corporate event" },
  { id: 3, image: corporateEvent3, title: "Corporate Celebration", description: "Cake with printed logo for brand launch" },
  { id: 4, image: corporateEvent4, title: "VIP Reception", description: "Custom cake with illustration for corporate event" },
  { id: 5, image: corporateEvent5, title: "VIP Reception", description: "Catering service with custom cake at a reception" },
  { id: 6, image: corporateEvent6, title: "VIP Reception", description: "Cake with custom artistic design" },
  { id: 7, image: corporateEvent7, title: "Yuh Collaboration", description: "Colorful custom cakes for brand partnership" },
  { id: 8, image: corporateEvent8, title: "Corporate Gift Boxes", description: "Elegant packaging with ribbon for corporate gifts" },
  { id: 9, image: corporateEvent9, title: "Corporate Gift Boxes", description: "Assortment of custom cakes for brand event" },
  { id: 10, image: corporateEvent10, title: "Surya Children Event", description: "Elegant blue cake for charity event" },
  { id: 11, image: corporateEvent11, title: "Surya Children Event", description: "Cake decorating workshop for corporate team building" },
  { id: 12, image: corporateEvent12, title: "Surya Children Event", description: "Artistic creation with vintage details for prestigious event" },
];

const CorporateEvent = () => {
  const [quoteOpen, setQuoteOpen] = useState(false);

  return (
    <Layout>
      <div className="container mx-auto px-4 py-16">
        <h1 className="font-serif text-4xl md:text-5xl text-center text-foreground mb-4">
          Corporate Events
        </h1>
        <p className="text-center text-muted-foreground max-w-2xl mx-auto mb-12">
          We create custom cakes for your corporate events, product launches, and business celebrations.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {corporateEvents.map((event) => (
            <div
              key={event.id}
              className="group bg-card rounded-2xl overflow-hidden shadow-lg hover:shadow-xl transition-all duration-300 border border-border"
            >
              <div className="aspect-square overflow-hidden">
                <img
                  src={event.image}
                  alt={event.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
              </div>
              <div className="p-5">
                <h3 className="font-serif text-lg font-semibold text-foreground mb-2">
                  {event.title}
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {event.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-16 text-center bg-muted/50 rounded-2xl p-8">
          <h3 className="font-serif text-2xl text-foreground mb-4">
            Interested in our corporate services?
          </h3>
          <p className="text-muted-foreground mb-2 max-w-xl mx-auto">
            Contact us to discuss your next corporate event and discover how we can create unique cakes tailored to your brand.
          </p>
          <p className="font-serif text-lg text-foreground mb-6">
            Let's create something special for your next corporate event.
          </p>
          <button
            onClick={() => setQuoteOpen(true)}
            className="inline-flex items-center justify-center px-8 py-3 bg-primary text-primary-foreground rounded-full font-medium hover:bg-primary/90 transition-colors"
          >
            Get a Quote
          </button>
        </div>
      </div>

      <CorporateQuoteForm open={quoteOpen} onOpenChange={setQuoteOpen} />
    </Layout>
  );
};

export default CorporateEvent;
