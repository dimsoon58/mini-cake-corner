import Layout from "@/components/Layout";
import { Card, CardContent } from "@/components/ui/card";

const themes = [
  { id: "colorful", name: "Colorful", images: [] },
  { id: "for-him", name: "For Him", images: [] },
  { id: "funny", name: "Funny", images: [] },
  { id: "gender-reveal", name: "Gender Reveal", images: [] },
  { id: "kids", name: "Kids", images: [] },
  { id: "minimalist", name: "Minimalist", images: [] },
  { id: "retro", name: "Retro", images: [] },
  { id: "sport", name: "Sport", images: [] },
];

const Inspiration = () => {
  return (
    <Layout>
      <main className="container mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="font-serif text-4xl md:text-5xl text-foreground mb-4">
            Inspiration
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Explorez nos thèmes pour trouver l'inspiration parfaite pour votre gâteau
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {themes.map((theme) => (
            <Card 
              key={theme.id} 
              className="group cursor-pointer overflow-hidden border-border/50 hover:border-primary/50 transition-all duration-300"
            >
              <CardContent className="p-0">
                <div className="aspect-square bg-secondary/30 flex items-center justify-center">
                  {theme.images.length > 0 ? (
                    <img 
                      src={theme.images[0]} 
                      alt={theme.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-muted-foreground/50 text-sm">
                      Images à venir
                    </div>
                  )}
                </div>
                <div className="p-4 text-center">
                  <h3 className="font-serif text-lg text-foreground group-hover:text-primary transition-colors">
                    {theme.name}
                  </h3>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </Layout>
  );
};

export default Inspiration;
