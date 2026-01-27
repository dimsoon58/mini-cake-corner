import Layout from "@/components/Layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import pressCotemag2022 from "@/assets/press-cote-magazine-2022.png";
import pressLesVoiles from "@/assets/press-cote-les-voiles.jpeg";
import pressGaultMillau1 from "@/assets/press-gault-millau-1.png";
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
    image: pressGaultMillau1,
    title: "Gault & Millau",
    subtitle: "Trois douceurs pour la Saint-Valentin",
    description: "La folie du bento cake, un gâteau voluptueux venu de Corée, est arrivée jusqu'en terres genevoises."
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
  },
  {
    id: 6,
    image: pressGaultMillau4,
    title: "Gault & Millau",
    subtitle: "Trois douceurs pour la Saint-Valentin",
    description: "La folie du bento cake, un gâteau voluptueux venu de Corée, est arrivée jusqu'en terres genevoises. Diplômées de l'EHL, Catherine Khidasheli et Melodie Nagle ont lancé Bento Cake Studio."
  }
];

const corporateEvents = [
  {
    id: 1,
    image: corporateEvent1,
    title: "Événement Corporate",
    description: "Gâteau personnalisé avec logo d'entreprise et cierges magiques"
  },
  {
    id: 2,
    image: corporateEvent2,
    title: "Célébration d'entreprise",
    description: "Gâteau Red Velvet personnalisé pour événement corporate"
  },
  {
    id: 3,
    image: corporateEvent3,
    title: "Branding Événementiel",
    description: "Gâteau avec logo imprimé pour lancement de marque"
  },
  {
    id: 4,
    image: corporateEvent4,
    title: "Buffet Corporate",
    description: "Gâteau personnalisé avec illustration pour événement d'entreprise"
  },
  {
    id: 5,
    image: corporateEvent5,
    title: "Réception VIP",
    description: "Service traiteur avec gâteau personnalisé lors d'une réception"
  },
  {
    id: 6,
    image: corporateEvent6,
    title: "Événement de Lancement",
    description: "Gâteau avec design artistique personnalisé"
  },
  {
    id: 7,
    image: corporateEvent7,
    title: "Collaboration Yuh",
    description: "Gâteaux colorés personnalisés pour partenariat de marque"
  },
  {
    id: 8,
    image: corporateEvent8,
    title: "Coffrets Cadeaux Corporate",
    description: "Packaging élégant avec ruban pour cadeaux d'entreprise"
  },
  {
    id: 9,
    image: corporateEvent9,
    title: "Collection Corporate",
    description: "Assortiment de gâteaux personnalisés pour événement de marque"
  },
  {
    id: 10,
    image: corporateEvent10,
    title: "Surya Children Event",
    description: "Gâteau bleu élégant personnalisé pour événement caritatif"
  },
  {
    id: 11,
    image: corporateEvent11,
    title: "Atelier Cake Decorating",
    description: "Workshop de décoration de gâteaux pour team building corporate"
  },
  {
    id: 12,
    image: corporateEvent12,
    title: "Gâteau Baroque Bleu",
    description: "Création artistique avec détails vintage pour événement prestigieux"
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
                Événements Corporate
              </h2>
              <p className="text-center text-muted-foreground max-w-2xl mx-auto mb-12">
                Nous créons des gâteaux personnalisés pour vos événements d'entreprise, lancements de produits, et célébrations corporate.
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
                  Intéressé par nos services corporate ?
                </h3>
                <p className="text-muted-foreground mb-6 max-w-xl mx-auto">
                  Contactez-nous pour discuter de votre prochain événement d'entreprise et découvrir comment nous pouvons créer des gâteaux uniques à votre image.
                </p>
                <a 
                  href="/contact"
                  className="inline-flex items-center justify-center px-8 py-3 bg-primary text-primary-foreground rounded-full font-medium hover:bg-primary/90 transition-colors"
                >
                  Nous Contacter
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
