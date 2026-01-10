import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ShoppingBag } from "lucide-react";
import Layout from "@/components/Layout";
import { useCart } from "@/context/CartContext";
import catalogRetroVintage from "@/assets/catalog-retro-vintage.png";
import catalogHeartBomb from "@/assets/catalog-heart-bomb.png";
import catalogShagCake from "@/assets/catalog-shag-cake.png";
import catalogRainbow from "@/assets/catalog-rainbow.png";
import catalogRoses from "@/assets/catalog-roses.png";
import catalogButterfly from "@/assets/catalog-butterfly.png";

const catalog = [
  {
    id: "retro-vintage",
    name: "Retro Vintage",
    description: "Pastel pink with delicate floral decorations",
    image: catalogRetroVintage,
    style: "retro-vintage",
    presets: { size: "medium", shape: "round", flavor: "white-berrylicious", style: "Retro / Vintage" },
    price: 84,
  },
  {
    id: "heart-bomb",
    name: "Heart Bomb",
    description: "Covered in dozens of candy hearts",
    image: catalogHeartBomb,
    style: "heart-bomb",
    presets: { size: "bento", shape: "heart", flavor: "red-velvet", style: "Heart Bomb" },
    price: 43,
  },
  {
    id: "shag-cake",
    name: "Shag Cake",
    description: "Fluffy textured frosting in lavender",
    image: catalogShagCake,
    style: "shag-cake",
    presets: { size: "medium", shape: "round", flavor: "vanilla", style: "Shag Cake" },
    price: 80,
  },
  {
    id: "rainbow",
    name: "Rainbow Cake",
    description: "Vibrant rainbow layers and colorful swirls",
    image: catalogRainbow,
    style: "rainbow-cake",
    presets: { size: "large", shape: "round", flavor: "vanilla", style: "Rainbow Cake" },
    price: 160,
  },
  {
    id: "roses",
    name: "Roses Please",
    description: "Elegant buttercream roses in soft pink",
    image: catalogRoses,
    style: "roses-please",
    presets: { size: "medium", shape: "heart", flavor: "salted-caramel", style: "Roses Please" },
    price: 89,
  },
  {
    id: "butterfly",
    name: "Butterfly Garden",
    description: "Whimsical butterflies and spring flowers",
    image: catalogButterfly,
    style: "butterfly-garden",
    presets: { size: "bento", shape: "round", flavor: "lemon-curd", style: "Butterfly Garden" },
    price: 42,
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

const Catalog = () => {
  const { addItem } = useCart();
  const [selectedCake, setSelectedCake] = useState<typeof catalog[0] | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const handleSelectCake = (cake: typeof catalog[0]) => {
    setSelectedCake(cake);
    setSheetOpen(true);
  };

  const handleAddToCart = () => {
    if (!selectedCake) return;
    
    addItem({
      id: "",
      size: selectedCake.presets.size,
      sizeName: sizeLabels[selectedCake.presets.size],
      shape: selectedCake.presets.shape,
      shapeName: shapeLabels[selectedCake.presets.shape],
      flavor: selectedCake.presets.flavor,
      flavorName: flavorLabels[selectedCake.presets.flavor],
      style: selectedCake.style,
      styleName: selectedCake.presets.style,
      cakeText: "",
      textColor: "",
      textColorName: "",
      extras: [],
      extrasNames: [],
      total: selectedCake.price,
    });
    setSheetOpen(false);
    setSelectedCake(null);
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-16">
        <h1 className="font-serif text-4xl md:text-5xl text-center text-foreground mb-6">
          CATALOG
        </h1>
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
                  onClick={() => handleSelectCake(cake)}
                >
                  Choose this style
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Catalog Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-serif text-2xl">
              {selectedCake?.name}
            </SheetTitle>
            <SheetDescription>
              Pre-designed cake with all options included
            </SheetDescription>
          </SheetHeader>
          
          {selectedCake && (
            <div className="mt-6 space-y-6">
              <div className="aspect-square rounded-lg overflow-hidden bg-muted/30">
                <img
                  src={selectedCake.image}
                  alt={selectedCake.name}
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center py-3 border-b border-border">
                  <span className="text-muted-foreground">Size</span>
                  <span className="font-medium text-foreground">
                    {sizeLabels[selectedCake.presets.size]}
                  </span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-border">
                  <span className="text-muted-foreground">Shape</span>
                  <span className="font-medium text-foreground">
                    {shapeLabels[selectedCake.presets.shape]}
                  </span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-border">
                  <span className="text-muted-foreground">Flavor</span>
                  <span className="font-medium text-foreground">
                    {flavorLabels[selectedCake.presets.flavor]}
                  </span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-border">
                  <span className="text-muted-foreground">Style</span>
                  <span className="font-medium text-foreground">
                    {selectedCake.presets.style}
                  </span>
                </div>
              </div>

              <div className="flex justify-between items-center py-4 bg-secondary/50 rounded-lg px-4">
                <span className="font-medium text-foreground">Total</span>
                <span className="text-xl font-bold text-primary">
                  CHF {selectedCake.price}
                </span>
              </div>

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
    </Layout>
  );
};

export default Catalog;