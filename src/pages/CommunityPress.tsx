import Layout from "@/components/Layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import pressCotemag2022 from "@/assets/press-cote-magazine-2022.png";
import pressLesVoiles from "@/assets/press-cote-les-voiles.jpeg";
import pressGaultMillau2 from "@/assets/press-gault-millau-2.png";
import pressGaultMillau3 from "@/assets/press-gault-millau-3.png";
import pressGaultMillau4 from "@/assets/press-gault-millau-4.png";
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

const pressArticles = [
  {
    id: 1,
    image: pressCotemag2022,
    title: "COTE Magazine",
    subtitle: "Février / Mars 2022",
    description: "Bento Cake Studio, Not traditional cakes - Deux étudiantes de l'école hôtelière de Lausanne passionnées par la culture coréenne, lancent en 2021 un concept unique à Genève."
  },
  {
    id: 2,
    image: pressLesVoiles,
    title: "Les Voiles x COTE",
    subtitle: "Food",
    description: "Bento Cake Studio - Les gâteaux coréens aux messages singuliers. Korean cakes with unique messages."
  },
  {
    id: 3,
    image: pressGaultMillau4,
    title: "Gault & Millau",
    subtitle: "Trois douceurs pour la Saint-Valentin",
    description: "La folie du bento cake, un gâteau voluptueux venu de Corée, est arrivée jusqu'en terres genevoises. Diplômées de l'EHL, Catherine Khidasheli et Melodie Nagle ont lancé Bento Cake Studio."
  },
  {
    id: 4,
    image: pressGaultMillau2,
    title: "Gault & Millau",
    subtitle: "Bento Cake Studio",
    description: "Diplômées de l'EHL, Catherine Khidasheli et Melodie Nagle ont lancé Bento Cake Studio et proposent toute une ribambelle de gâteaux aux décors hyper kitchs, mais adorables."
  },
  {
    id: 5,
    image: pressGaultMillau3,
    title: "Gault & Millau",
    subtitle: "Valentine's Day Feature",
    description: "Personnalisables, ils peuvent être adaptés à toutes les occasions. De quoi célébrer la fête des amoureux avec gourmandise."
  }
];

const corporateEvents = [
  // Corporate Celebration (first 3)
  {
    id: 1,
    image: corporateEvent1,
    title: "Corporate Celebration",
    description: "Custom cake with company logo and sparklers"
  },
  {
    id: 2,
    image: corporateEvent2,
    title: "Corporate Celebration",
    description: "Custom Red Velvet cake for corporate event"
  },
  {
    id: 3,
    image: corporateEvent3,
    title: "Corporate Celebration",
    description: "Cake with printed logo for brand launch"
  },
  // VIP Reception (next 3)
  {
    id: 4,
    image: corporateEvent4,
    title: "VIP Reception",
    description: "Custom cake with illustration for corporate event"
  },
  {
    id: 5,
    image: corporateEvent5,
    title: "VIP Reception",
    description: "Catering service with custom cake at a reception"
  },
  {
    id: 6,
    image: corporateEvent6,
    title: "VIP Reception",
    description: "Cake with custom artistic design"
  },
  // Yuh Collaboration & Corporate Gift Boxes (next 3)
  {
    id: 7,
    image: corporateEvent7,
    title: "Yuh Collaboration",
    description: "Colorful custom cakes for brand partnership"
  },
  {
    id: 8,
    image: corporateEvent8,
    title: "Corporate Gift Boxes",
    description: "Elegant packaging with ribbon for corporate gifts"
  },
  {
    id: 9,
    image: corporateEvent9,
    title: "Corporate Gift Boxes",
    description: "Assortment of custom cakes for brand event"
  },
  // Surya Children Event (last 3)
  {
    id: 10,
    image: corporateEvent10,
    title: "Surya Children Event",
    description: "Elegant blue cake for charity event"
  },
  {
    id: 11,
    image: corporateEvent11,
    title: "Surya Children Event",
    description: "Cake decorating workshop for corporate team building"
  },
  {
    id: 12,
    image: corporateEvent12,
    title: "Surya Children Event",
    description: "Artistic creation with vintage details for prestigious event"
  }
];

const CommunityPress = () => {
  return (
    <Layout>
      <div className="container mx-auto px-4 py-16">
        <h1 className="font-serif text-4xl md:text-5xl text-center text-foreground mb-4">
          Community & Press
        </h1>
        <p className="text-center text-muted-foreground max-w-2xl mx-auto mb-12">
          Découvrez nos apparitions dans la presse et nos événements corporate.
        </p>

        <Tabs defaultValue="press" className="w-full">
          <TabsList className="grid w-full max-w-md mx-auto grid-cols-2 mb-12">
            <TabsTrigger value="press" className="text-base">📰 Presse</TabsTrigger>
            <TabsTrigger value="corporate" className="text-base">🏢 Corporate Event</TabsTrigger>
          </TabsList>

          <TabsContent value="press">
            {/* Press Section */}
            <section className="mb-16">
              <h2 className="font-serif text-2xl md:text-3xl text-center text-foreground mb-8">
                Dans la Presse
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {pressArticles.map((article) => (
                  <div 
                    key={article.id}
                    className="bg-card rounded-2xl overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300 border border-border"
                  >
                    <div className="aspect-[3/4] overflow-hidden">
                      <img 
                        src={article.image} 
                        alt={article.title}
                        className="w-full h-full object-cover hover:scale-105 transition-transform duration-500"
                      />
                    </div>
                    <div className="p-6">
                      <h3 className="font-serif text-xl font-semibold text-foreground mb-1">
                        {article.title}
                      </h3>
                      <p className="text-sm text-primary font-medium mb-3">
                        {article.subtitle}
                      </p>
                      <p className="text-muted-foreground text-sm leading-relaxed">
                        {article.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Community Section */}
            <section>
              <h2 className="font-serif text-2xl md:text-3xl text-center text-foreground mb-8">
                💖 Notre Communauté
              </h2>
              <p className="text-center text-muted-foreground max-w-2xl mx-auto">
                Suivez-nous sur Instagram @bentocakestudio pour découvrir les créations de notre communauté !
              </p>
            </section>
          </TabsContent>

          <TabsContent value="corporate">
            {/* Corporate Events Section */}
            <section>
              <h2 className="font-serif text-2xl md:text-3xl text-center text-foreground mb-4">
                Corporate Events
              </h2>
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

              {/* Contact CTA */}
              <div className="mt-16 text-center bg-muted/50 rounded-2xl p-8">
                <h3 className="font-serif text-2xl text-foreground mb-4">
                  Interested in our corporate services?
                </h3>
                <p className="text-muted-foreground mb-6 max-w-xl mx-auto">
                  Contact us to discuss your next corporate event and discover how we can create unique cakes tailored to your brand.
                </p>
                <a 
                  href="/contact"
                  className="inline-flex items-center justify-center px-8 py-3 bg-primary text-primary-foreground rounded-full font-medium hover:bg-primary/90 transition-colors"
                >
                  Contact Us
                </a>
              </div>
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
};

export default CommunityPress;
