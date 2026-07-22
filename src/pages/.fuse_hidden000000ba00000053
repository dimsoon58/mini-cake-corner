import Layout from "@/components/Layout";
import pressCotemag2022 from "@/assets/press-cote-magazine-2022.png";
import pressLesVoiles from "@/assets/press-cote-les-voiles.jpeg";
import pressGaultMillau2 from "@/assets/press-gault-millau-2.png";
import pressGaultMillau3 from "@/assets/press-gault-millau-3.png";
import pressGaultMillau4 from "@/assets/press-gault-millau-4.png";

const standaloneArticles = [
  { id: 1, image: pressCotemag2022, title: "COTE Magazine", subtitle: "Février / Mars 2022", description: "Bento Cake Studio, Not traditional cakes - Deux étudiantes de l'école hôtelière de Lausanne passionnées par la culture coréenne, lancent en 2021 un concept unique à Genève." },
  { id: 2, image: pressLesVoiles, title: "Les Voiles x COTE", subtitle: "Food", description: "Bento Cake Studio - Les gâteaux coréens aux messages singuliers. Korean cakes with unique messages." },
];

const gaultMillauImages = [
  { id: 3, image: pressGaultMillau4, subtitle: "Trois douceurs pour la Saint-Valentin", description: "La folie du bento cake, un gâteau voluptueux venu de Corée, est arrivée jusqu'en terres genevoises." },
  { id: 4, image: pressGaultMillau2, subtitle: "Bento Cake Studio", description: "Diplômées de l'EHL, Catherine Khidasheli et Melodie Nagle proposent toute une ribambelle de gâteaux aux décors hyper kitchs, mais adorables." },
  { id: 5, image: pressGaultMillau3, subtitle: "Valentine's Day Feature", description: "Personnalisables, ils peuvent être adaptés à toutes les occasions. De quoi célébrer la fête des amoureux avec gourmandise." },
];

const CommunityPress = () => {
  return (
    <Layout>
      <div className="container mx-auto px-4 py-16">
        <h1 className="font-sans uppercase tracking-[0.105em] text-4xl md:text-5xl text-center text-foreground mb-4">
          Press
        </h1>
        <p className="text-center text-muted-foreground max-w-2xl mx-auto mb-12">
          Discover our press features and media appearances.
        </p>

        {/* Standalone articles */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
          {standaloneArticles.map((article) => (
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

        {/* Gault & Millau grouped */}
        <div className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-center text-foreground mb-8">
            Gault & Millau
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {gaultMillauImages.map((item) => (
              <div
                key={item.id}
                className="bg-card rounded-2xl overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300 border border-border"
              >
                <div className="aspect-[3/4] overflow-hidden">
                  <img
                    src={item.image}
                    alt={`Gault & Millau - ${item.subtitle}`}
                    className="w-full h-full object-cover hover:scale-105 transition-transform duration-500"
                  />
                </div>
                <div className="p-5">
                  <p className="text-sm text-primary font-medium mb-2">{item.subtitle}</p>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Community Section */}
        <section className="text-center">
          <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
            Follow us on Instagram{" "}
            <a
              href="https://www.instagram.com/bentocakestudio"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary font-medium underline hover:opacity-80 transition-opacity"
            >
              @bentocakestudio
            </a>{" "}
            to discover our creations.
          </p>
        </section>
      </div>
    </Layout>
  );
};

export default CommunityPress;
