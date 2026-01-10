import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ShoppingBag } from "lucide-react";
import Layout from "@/components/Layout";
import { useCart } from "@/context/CartContext";
import logo from "@/assets/logo.png";
import heroBg from "@/assets/hero-bg.jpg";
import cakeHomemade from "@/assets/cake-homemade.png";
import cakeFresh from "@/assets/cake-fresh.png";
import cakeTrendy from "@/assets/cake-trendy.png";
import cakeMiniBento from "@/assets/cake-mini-bento.png";
import catalogRetroVintage from "@/assets/catalog-retro-vintage.png";
import catalogHeartBomb from "@/assets/catalog-heart-bomb.png";
import catalogShagCake from "@/assets/catalog-shag-cake.png";
import catalogRainbow from "@/assets/catalog-rainbow.png";
import catalogRoses from "@/assets/catalog-roses.png";
import catalogButterfly from "@/assets/catalog-butterfly.png";

const features = [
  {
    title: "Homemade goodness",
    description:
      "When you think of warmth, love, and comfort in a bite, think homemade. Our cakes are all about that authentic taste, paired with a cheeky wink.",
    image: cakeHomemade,
  },
  {
    title: "Trendy & personalized",
    description:
      "It's modern, it's unique and it's trendy. Ditch that regular cake and get a personalized piece of art, made with love and passion just for you.",
    image: cakeTrendy,
  },
  {
    title: "Fresh ingredients",
    description:
      "Because we believe that our cakes should be fresh, nutritious and prepared with care, we only use natural & fresh ingredients with no preservatives.",
    image: cakeFresh,
  },
];

const sizes = [
  {
    name: "Mini Bento Cake",
    size: "10 cm",
    servings: "2-4 servings",
    price: "From CHF 40",
    extra: "+CHF 3 Heart shape",
    image: cakeMiniBento,
  },
  {
    name: "Medium Cake",
    size: "15 cm",
    servings: "5-8 servings",
    price: "From CHF 80",
    extra: "+CHF 5 Heart shape",
    image: null,
  },
  {
    name: "Large Cake",
    size: "20 cm",
    servings: "12-16 servings",
    price: "From CHF 160",
    extra: "+CHF 10 Heart shape",
    image: null,
  },
];

const catalog = [
  {
    id: "retro-vintage",
    name: "Retro Vintage",
    description: "Pastel pink with delicate floral decorations",
    image: catalogRetroVintage,
    style: "retro-vintage",
    presets: { size: "medium", shape: "round", flavor: "white-berrylicious", style: "Retro / Vintage" },
    price: 84, // medium 80 + special flavor 4
  },
  {
    id: "heart-bomb",
    name: "Heart Bomb",
    description: "Covered in dozens of candy hearts",
    image: catalogHeartBomb,
    style: "heart-bomb",
    presets: { size: "bento", shape: "heart", flavor: "red-velvet", style: "Heart Bomb" },
    price: 43, // bento 40 + heart 3
  },
  {
    id: "shag-cake",
    name: "Shag Cake",
    description: "Fluffy textured frosting in lavender",
    image: catalogShagCake,
    style: "shag-cake",
    presets: { size: "medium", shape: "round", flavor: "vanilla", style: "Shag Cake" },
    price: 80, // medium 80
  },
  {
    id: "rainbow",
    name: "Rainbow Cake",
    description: "Vibrant rainbow layers and colorful swirls",
    image: catalogRainbow,
    style: "rainbow-cake",
    presets: { size: "large", shape: "round", flavor: "vanilla", style: "Rainbow Cake" },
    price: 160, // large 160
  },
  {
    id: "roses",
    name: "Roses Please",
    description: "Elegant buttercream roses in soft pink",
    image: catalogRoses,
    style: "roses-please",
    presets: { size: "medium", shape: "heart", flavor: "salted-caramel", style: "Roses Please" },
    price: 89, // medium 80 + heart 5 + special 4
  },
  {
    id: "butterfly",
    name: "Butterfly Garden",
    description: "Whimsical butterflies and spring flowers",
    image: catalogButterfly,
    style: "butterfly-garden",
    presets: { size: "bento", shape: "round", flavor: "lemon-curd", style: "Butterfly Garden" },
    price: 42, // bento 40 + special 2
  },
];

const sizeLabels: Record<string, string> = {
  bento: "Bento",
  medium: "Medium",
  large: "Large",
};

const shapeLabels: Record<string, string> = {
  round: "Round",
  heart: "Heart",
};

const flavorLabels: Record<string, string> = {
  vanilla: "Vanilla",
  "red-velvet": "Red Velvet",
  chocolate: "Chocolate",
  "chocolate-lovers": "Chocolate Lovers",
  "dark-berrylicious": "Dark Berrylicious",
  "white-berrylicious": "White Berrylicious",
  "salted-caramel": "Salted Butter Caramel",
  "lemon-curd": "Lemon Curd",
  tiramisu: "Tiramisu",
  praline: "Praline Obsession",
  "passion-fruit": "Passion Fruit",
};

const Index = () => {
  const { addItem } = useCart();
  const [selectedCatalogCake, setSelectedCatalogCake] = useState<typeof catalog[0] | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const handleSelectCatalogCake = (cake: typeof catalog[0]) => {
    setSelectedCatalogCake(cake);
    setSheetOpen(true);
  };

  const handleAddToCart = () => {
    if (!selectedCatalogCake) return;
    
    addItem({
      id: "",
      size: selectedCatalogCake.presets.size,
      sizeName: sizeLabels[selectedCatalogCake.presets.size],
      shape: selectedCatalogCake.presets.shape,
      shapeName: shapeLabels[selectedCatalogCake.presets.shape],
      flavor: selectedCatalogCake.presets.flavor,
      flavorName: flavorLabels[selectedCatalogCake.presets.flavor],
      style: selectedCatalogCake.style,
      styleName: selectedCatalogCake.presets.style,
      baseColor: "",
      baseColorName: "",
      cakeText: "",
      textColor: "",
      textColorName: "",
      extras: [],
      extrasNames: [],
      total: selectedCatalogCake.price,
    });
    setSheetOpen(false);
    setSelectedCatalogCake(null);
  };

  return (
    <Layout>
      {/* Hero Section */}
      <section className="relative text-primary-foreground overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${heroBg})` }}
        />
        <div className="absolute inset-0 bg-foreground/50" />
        <div className="relative container mx-auto px-4 py-24 md:py-32 text-center">
          <h1 className="font-serif text-4xl md:text-6xl lg:text-7xl font-light tracking-wide mb-6">
            NOT YOUR TRADITIONAL CAKES
          </h1>
          <p className="text-lg md:text-xl max-w-3xl mx-auto opacity-90 mb-10 font-light">
            Combining creativity and personalization to bring you unique cakes
            that are not only beautiful, but taste just as good.
          </p>
          <Button
            size="lg"
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-lg rounded-full font-medium tracking-wide"
            asChild
          >
            <Link to="/customize">Customize Your Cake</Link>
          </Button>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            {features.map((feature) => (
              <div key={feature.title} className="text-center">
                <img
                  src={feature.image}
                  alt={feature.title}
                  className="h-32 md:h-40 mx-auto mb-6 object-contain"
                />
                <h3 className="font-serif text-2xl md:text-3xl text-foreground mb-4">
                  {feature.title}
                </h3>
                <p className="text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sizes Section */}
      <section className="py-20 bg-cream">
        <div className="container mx-auto px-4">
          <h2 className="font-serif text-4xl md:text-5xl text-center text-foreground mb-16">
            SIZES
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {sizes.map((size) => (
              <div
                key={size.name}
                className="p-8 text-center shadow-sm rounded-2xl flex flex-col"
                style={{ backgroundColor: '#C9A8D3' }}
              >
                {size.image && (
                  <img
                    src={size.image}
                    alt={size.name}
                    className="h-32 md:h-40 mx-auto mb-4 object-contain"
                  />
                )}
                <h3 className="font-serif text-2xl text-foreground mb-4">
                  {size.name}
                </h3>
                <p className="text-muted-foreground mb-1">{size.size}</p>
                <p className="text-muted-foreground mb-4">{size.servings}</p>
                <p className="text-xl font-medium text-foreground mb-2">
                  {size.price}
                </p>
                <p className="text-sm text-primary mb-6">{size.extra}</p>
                <Link to="/customize">
                  <Button variant="outline" className="w-full rounded-full border-foreground text-foreground hover:bg-foreground hover:text-background">
                    Choose option
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Catalog Section */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4">
          <h2 className="font-serif text-4xl md:text-5xl text-center text-foreground mb-6">
            CATALOG
          </h2>
          <p className="text-center text-muted-foreground mb-16 max-w-2xl mx-auto">
            Get inspired by our pre-designed creations. Pick your favorite and customize it to make it yours.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {catalog.map((cake) => (
              <div
                key={cake.id}
                className="bg-card rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-shadow"
              >
                <div className="aspect-square overflow-hidden bg-muted/30">
                  <img
                    src={cake.image}
                    alt={cake.name}
                    className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                  />
                </div>
                <div className="p-6 text-center">
                  <h3 className="font-serif text-xl text-foreground mb-2">
                    {cake.name}
                  </h3>
                  <p className="text-muted-foreground text-sm mb-4">
                    {cake.description}
                  </p>
                  <Button 
                    variant="outline" 
                    className="w-full rounded-full border-foreground text-foreground hover:bg-foreground hover:text-background"
                    onClick={() => handleSelectCatalogCake(cake)}
                  >
                    Choose this style
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Catalog Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-serif text-2xl">
              {selectedCatalogCake?.name}
            </SheetTitle>
            <SheetDescription>
              Pre-designed cake with all options included
            </SheetDescription>
          </SheetHeader>
          
          {selectedCatalogCake && (
            <div className="mt-6 space-y-6">
              {/* Cake Image */}
              <div className="aspect-square rounded-lg overflow-hidden bg-muted/30">
                <img
                  src={selectedCatalogCake.image}
                  alt={selectedCatalogCake.name}
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Cake Details */}
              <div className="space-y-4">
                <div className="flex justify-between items-center py-3 border-b border-border">
                  <span className="text-muted-foreground">Size</span>
                  <span className="font-medium text-foreground">
                    {sizeLabels[selectedCatalogCake.presets.size]}
                  </span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-border">
                  <span className="text-muted-foreground">Shape</span>
                  <span className="font-medium text-foreground">
                    {shapeLabels[selectedCatalogCake.presets.shape]}
                  </span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-border">
                  <span className="text-muted-foreground">Flavor</span>
                  <span className="font-medium text-foreground">
                    {flavorLabels[selectedCatalogCake.presets.flavor]}
                  </span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-border">
                  <span className="text-muted-foreground">Style</span>
                  <span className="font-medium text-foreground">
                    {selectedCatalogCake.presets.style}
                  </span>
                </div>
              </div>

              {/* Total Price */}
              <div className="flex justify-between items-center py-4 bg-secondary/50 rounded-lg px-4">
                <span className="font-medium text-foreground">Total</span>
                <span className="text-xl font-bold text-primary">
                  CHF {selectedCatalogCake.price}
                </span>
              </div>

              {/* Add to Cart Button */}
              <Button
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-6 text-lg rounded-full"
                onClick={handleAddToCart}
              >
                <ShoppingBag className="w-5 h-5 mr-2" />
                Add to Cart
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* CTA Section */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4 text-center">
          <h2 className="font-serif text-3xl md:text-4xl text-foreground mb-6">
            Ready to create your perfect cake?
          </h2>
          <p className="text-muted-foreground mb-8 max-w-2xl mx-auto">
            Choose your size, shape, flavor, and extras to design a cake that's
            uniquely yours.
          </p>
          <Button
            size="lg"
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-lg rounded-none font-medium tracking-wide"
            asChild
          >
            <Link to="/customize">Customize Your Cake</Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-foreground text-primary-foreground py-12">
        <div className="container mx-auto px-4 text-center">
          <img
            src={logo}
            alt="Bento Cake Studio"
            className="h-16 mx-auto mb-6 brightness-200"
          />
          <p className="text-sm opacity-70">
            © 2024 Bento Cake Studio. Made with love.
          </p>
        </div>
      </footer>
    </Layout>
  );
};

export default Index;
