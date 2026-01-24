import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import Layout from "@/components/Layout";
import { useCart } from "@/context/CartContext";
import catalogRetroVintage from "@/assets/catalog-retro-vintage.png";
import catalogHeartBomb from "@/assets/catalog-heart-bomb.png";
import catalogShagCake from "@/assets/catalog-shag-cake.png";
import catalogRainbow from "@/assets/catalog-rainbow.png";
import catalogRoses from "@/assets/catalog-roses.png";
import catalogButterfly from "@/assets/catalog-butterfly.png";

const baseColors = [
  { id: "white", name: "White", color: "#FFFFFF" },
  { id: "cream", name: "Cream", color: "#FFF8E7" },
  { id: "pastel-pink", name: "Pastel Pink", color: "#FFE4EC" },
  { id: "pink", name: "Pink", color: "#FFC0CB" },
  { id: "dark-pink", name: "Dark Pink", color: "#E75480" },
  { id: "dark-red", name: "Dark Red", color: "#DC143C" },
  { id: "burgundy", name: "Burgundy", color: "#800020" },
  { id: "pastel-yellow", name: "Pastel Yellow", color: "#FDFD96" },
  { id: "yellow", name: "Yellow", color: "#FFD700" },
  { id: "orange", name: "Orange", color: "#FFA500" },
  { id: "pastel-orange", name: "Pastel Orange", color: "#FFB347" },
  { id: "mint-green", name: "Mint Green", color: "#B8F5C8" },
  { id: "green", name: "Green", color: "#3CB371" },
  { id: "forest-green", name: "Forest Green", color: "#228B22" },
  { id: "baby-blue", name: "Baby Blue", color: "#D4F1F9" },
  { id: "sky-blue", name: "Sky Blue", color: "#87CEEB" },
  { id: "midnight-blue", name: "Midnight Blue", color: "#191970" },
  { id: "lavender", name: "Lavender", color: "#E6E6FA" },
  { id: "plum", name: "Plum", color: "#8E4585" },
  { id: "light-brown", name: "Light Brown", color: "#C4A484" },
  { id: "dark-brown", name: "Dark Brown", color: "#654321" },
  { id: "black", name: "Black", color: "#000000" },
];

const sizes = [
  { id: "bento", name: "Bento", price: 40 },
  { id: "medium", name: "Medium", price: 80 },
  { id: "large", name: "Large", price: 160 },
];

const shapes = [
  { id: "round", name: "Round", extraPrice: { bento: 0, medium: 0, large: 0 } },
  { id: "heart", name: "Heart", extraPrice: { bento: 3, medium: 5, large: 10 } },
];

const flavors = [
  { id: "vanilla", name: "Vanilla", extraPrice: { bento: 0, medium: 0, large: 0 } },
  { id: "red-velvet", name: "Red Velvet", extraPrice: { bento: 0, medium: 0, large: 0 } },
  { id: "chocolate", name: "Chocolate", extraPrice: { bento: 0, medium: 0, large: 0 } },
  { id: "chocolate-lovers", name: "Chocolate Lovers", extraPrice: { bento: 2, medium: 4, large: 8 } },
  { id: "dark-berrylicious", name: "Dark Berrylicious", extraPrice: { bento: 2, medium: 4, large: 8 } },
  { id: "white-berrylicious", name: "White Berrylicious", extraPrice: { bento: 2, medium: 4, large: 8 } },
  { id: "salted-caramel", name: "Salted Butter Caramel", extraPrice: { bento: 2, medium: 4, large: 8 } },
  { id: "lemon-curd", name: "Lemon Curd", extraPrice: { bento: 2, medium: 4, large: 8 } },
  { id: "tiramisu", name: "Tiramisu", extraPrice: { bento: 4, medium: 8, large: 16 } },
  { id: "praline", name: "Praline Obsession", extraPrice: { bento: 4, medium: 8, large: 16 } },
  { id: "passion-fruit", name: "Passion Fruit", extraPrice: { bento: 4, medium: 8, large: 16 } },
];

const catalog = [
  {
    id: "retro-vintage",
    name: "Retro Cake",
    description: "Vintage style with elegant decorations",
    image: catalogRetroVintage,
    styleId: "retro-vintage",
    styleName: "Retro / Vintage",
    stylePrice: { bento: 5, medium: 15, large: 20 },
  },
  {
    id: "rainbow-cake",
    name: "Rainbow Cake",
    description: "Vibrant rainbow layers and colorful swirls",
    image: catalogRainbow,
    styleId: "rainbow-cake",
    styleName: "Rainbow Cake",
    stylePrice: { bento: 7, medium: 17, large: 30 },
  },
  {
    id: "shag-cake",
    name: "Shag Cake",
    description: "Fluffy textured frosting",
    image: catalogShagCake,
    styleId: "shag-cake",
    styleName: "Shag Cake",
    stylePrice: { bento: 8, medium: 20, large: 30 },
  },
  {
    id: "gold-leaves",
    name: "Gold Leaves",
    description: "Elegant cake with gold leaf accents",
    image: catalogRetroVintage,
    styleId: "gold-leaves-style",
    styleName: "Gold Leaves",
    stylePrice: { bento: 2, medium: 4, large: 6 },
  },
  {
    id: "scattered-pearls",
    name: "Scattered Pearls",
    description: "Delicate pearls scattered across the cake",
    image: catalogHeartBomb,
    styleId: "scattered-pearls",
    styleName: "Scattered Pearls",
    stylePrice: { bento: 2, medium: 5, large: 7 },
  },
  {
    id: "pearl-borders",
    name: "Pearl Borders",
    description: "Elegant pearl border decoration",
    image: catalogRoses,
    styleId: "pearl-borders",
    styleName: "Pearl Borders",
    stylePrice: { bento: 8, medium: 15, large: 20 },
  },
  {
    id: "cherries",
    name: "Cherries",
    description: "Fresh cherry decorations",
    image: catalogButterfly,
    styleId: "cherries-style",
    styleName: "Cherries",
    stylePrice: { bento: 4, medium: 8, large: 12 },
  },
  {
    id: "glitter-cherries",
    name: "Glitter Cherries",
    description: "Sparkling cherry decorations",
    image: catalogButterfly,
    styleId: "glitter-cherries-style",
    styleName: "Glitter Cherries",
    stylePrice: { bento: 6, medium: 10, large: 15 },
  },
  {
    id: "ribbons",
    name: "Ribbons",
    description: "Beautiful ribbon decorations",
    image: catalogRoses,
    styleId: "ribbons-style",
    styleName: "Ribbons",
    stylePrice: { bento: 10, medium: 20, large: 30 },
  },
  {
    id: "glitter-cake",
    name: "Glitter Cake",
    description: "Sparkly glitter finish",
    image: catalogShagCake,
    styleId: "glitter-cake",
    styleName: "Glitter Cake",
    stylePrice: { bento: 6, medium: 8, large: 12 },
  },
  {
    id: "glitter-in-the-air",
    name: "Glitter in the Air",
    description: "Floating glitter effect",
    image: catalogRainbow,
    styleId: "glitter-in-the-air",
    styleName: "Glitter in the Air",
    stylePrice: { bento: 5, medium: 7, large: 10 },
  },
  {
    id: "heart-bomb",
    name: "Heart Bomb",
    description: "Covered in dozens of candy hearts",
    image: catalogHeartBomb,
    styleId: "heart-bomb",
    styleName: "Heart Bomb",
    stylePrice: { bento: 5, medium: 10, large: 15 },
  },
  {
    id: "gender-reveal",
    name: "Gender Reveal",
    description: "Perfect for your special announcement",
    image: catalogRetroVintage,
    styleId: "gender-reveal",
    styleName: "Gender Reveal",
    stylePrice: { bento: 5, medium: 10, large: 20 },
  },
  {
    id: "printed-picture",
    name: "Printed Pictures / Logo",
    description: "Custom printed image or logo",
    image: catalogRainbow,
    styleId: "printed-picture",
    styleName: "Printed Picture",
    stylePrice: { bento: 20, medium: 20, large: 20 },
  },
  {
    id: "custom-drawing",
    name: "Drawing",
    description: "Hand-drawn custom design",
    image: catalogButterfly,
    styleId: "custom-drawing",
    styleName: "Custom Drawing",
    stylePrice: { bento: 5, medium: 5, large: 5 },
  },
  {
    id: "roses-please",
    name: "Roses Please",
    description: "Elegant buttercream roses",
    image: catalogRoses,
    styleId: "roses-please",
    styleName: "Roses Please",
    stylePrice: { bento: 7, medium: 15, large: 20 },
  },
  {
    id: "butterfly-garden",
    name: "Butterfly Garden",
    description: "Whimsical butterflies and spring flowers",
    image: catalogButterfly,
    styleId: "butterfly-garden",
    styleName: "Butterfly Garden",
    stylePrice: { bento: 7, medium: 15, large: 20 },
  },
  {
    id: "pearl-number",
    name: "Pearl Number",
    description: "Numbers decorated with pearls",
    image: catalogHeartBomb,
    styleId: "pearl-number",
    styleName: "Pearl Number",
    stylePrice: { bento: 5, medium: 5, large: 5 },
  },
];

interface CakeSelections {
  size: string;
  shape: string;
  flavor: string;
  baseColor: string;
  decorationColor: string;
  wantsText: boolean;
  cakeText: string;
  textColor: string;
}

const Catalog = () => {
  const { addItem } = useCart();
  const [selectedCake, setSelectedCake] = useState<typeof catalog[0] | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selections, setSelections] = useState<CakeSelections>({
    size: "bento",
    shape: "round",
    flavor: "vanilla",
    baseColor: "",
    decorationColor: "",
    wantsText: false,
    cakeText: "",
    textColor: "",
  });

  const handleSelectCake = (cake: typeof catalog[0]) => {
    setSelectedCake(cake);
    setSelections({
      size: "bento",
      shape: "round",
      flavor: "vanilla",
      baseColor: "",
      decorationColor: "",
      wantsText: false,
      cakeText: "",
      textColor: "",
    });
    setSheetOpen(true);
  };

  const calculatePrice = () => {
    if (!selectedCake) return 0;
    
    const sizeObj = sizes.find(s => s.id === selections.size);
    const shapeObj = shapes.find(s => s.id === selections.shape);
    const flavorObj = flavors.find(f => f.id === selections.flavor);
    
    const basePrice = sizeObj?.price || 40;
    const shapeExtra = shapeObj?.extraPrice[selections.size as keyof typeof shapeObj.extraPrice] || 0;
    const flavorExtra = flavorObj?.extraPrice[selections.size as keyof typeof flavorObj.extraPrice] || 0;
    const styleExtra = selectedCake.stylePrice[selections.size as keyof typeof selectedCake.stylePrice] || 0;
    
    return basePrice + shapeExtra + flavorExtra + styleExtra;
  };

  const handleAddToCart = () => {
    if (!selectedCake) return;
    
    const sizeObj = sizes.find(s => s.id === selections.size);
    const shapeObj = shapes.find(s => s.id === selections.shape);
    const flavorObj = flavors.find(f => f.id === selections.flavor);
    const baseColorObj = baseColors.find(c => c.id === selections.baseColor);
    const decoColorObj = baseColors.find(c => c.id === selections.decorationColor);
    const textColorObj = baseColors.find(c => c.id === selections.textColor);
    
    addItem({
      id: "",
      orderDate: "",
      size: selections.size,
      sizeName: sizeObj?.name || "",
      shape: selections.shape,
      shapeName: shapeObj?.name || "",
      flavor: selections.flavor,
      flavorName: flavorObj?.name || "",
      style: selectedCake.styleId,
      styleName: selectedCake.styleName,
      baseColor: selections.baseColor,
      baseColorName: baseColorObj?.name || "",
      decorationColor: selections.decorationColor,
      decorationColorName: decoColorObj?.name || "",
      cakeText: selections.cakeText,
      textColor: selections.textColor,
      textColorName: textColorObj?.name || "",
      extras: [],
      extrasNames: [],
      ribbonColor: "",
      ribbonColorName: "",
      butterflyColor: "",
      butterflyColorName: "",
      total: calculatePrice(),
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
                <p className="text-muted-foreground text-sm mb-2">
                  {cake.description}
                </p>
                <p className="text-xs text-primary mb-4">
                  +CHF {cake.stylePrice.bento} mini / +CHF {cake.stylePrice.medium} medium / +CHF {cake.stylePrice.large} large
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
              Customize your cake options
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

              {/* Size Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Size</label>
                <Select
                  value={selections.size}
                  onValueChange={(value) => setSelections({ ...selections, size: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select size" />
                  </SelectTrigger>
                  <SelectContent>
                    {sizes.map((size) => (
                      <SelectItem key={size.id} value={size.id}>
                        {size.name} - CHF {size.price}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Shape Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Shape</label>
                <Select
                  value={selections.shape}
                  onValueChange={(value) => setSelections({ ...selections, shape: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select shape" />
                  </SelectTrigger>
                  <SelectContent>
                    {shapes.map((shape) => {
                      const extra = shape.extraPrice[selections.size as keyof typeof shape.extraPrice] || 0;
                      return (
                        <SelectItem key={shape.id} value={shape.id}>
                          {shape.name} {extra > 0 ? `(+CHF ${extra})` : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              {/* Flavor Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Flavor</label>
                <Select
                  value={selections.flavor}
                  onValueChange={(value) => setSelections({ ...selections, flavor: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select flavor" />
                  </SelectTrigger>
                  <SelectContent>
                    {flavors.map((flavor) => {
                      const extra = flavor.extraPrice[selections.size as keyof typeof flavor.extraPrice] || 0;
                      return (
                        <SelectItem key={flavor.id} value={flavor.id}>
                          {flavor.name} {extra > 0 ? `(+CHF ${extra})` : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              {/* Base Color Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Base Color</label>
                <div className="grid grid-cols-6 gap-2">
                  {baseColors.map((color) => (
                    <button
                      key={color.id}
                      onClick={() => setSelections({ ...selections, baseColor: color.id })}
                      className={cn(
                        "flex flex-col items-center gap-1 p-1 rounded-lg border transition-all",
                        selections.baseColor === color.id
                          ? "ring-2 ring-primary border-primary"
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      <div
                        className={cn(
                          "w-6 h-6 rounded-full border",
                          color.id === "white" || color.id === "cream"
                            ? "border-muted-foreground/30"
                            : "border-transparent"
                        )}
                        style={{ backgroundColor: color.color }}
                      />
                      <span className="text-[10px] text-foreground text-center leading-tight truncate w-full">{color.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Decoration Color Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Decoration Color</label>
                <div className="grid grid-cols-6 gap-2">
                  {baseColors.map((color) => (
                    <button
                      key={color.id}
                      onClick={() => setSelections({ ...selections, decorationColor: color.id })}
                      className={cn(
                        "flex flex-col items-center gap-1 p-1 rounded-lg border transition-all",
                        selections.decorationColor === color.id
                          ? "ring-2 ring-primary border-primary"
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      <div
                        className={cn(
                          "w-6 h-6 rounded-full border",
                          color.id === "white" || color.id === "cream"
                            ? "border-muted-foreground/30"
                            : "border-transparent"
                        )}
                        style={{ backgroundColor: color.color }}
                      />
                      <span className="text-[10px] text-foreground text-center leading-tight truncate w-full">{color.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Text Toggle */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Add Text?</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelections({ ...selections, wantsText: false, cakeText: "", textColor: "" })}
                    className={cn(
                      "flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                      !selections.wantsText
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    )}
                  >
                    No Text
                  </button>
                  <button
                    onClick={() => setSelections({ ...selections, wantsText: true })}
                    className={cn(
                      "flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                      selections.wantsText
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    )}
                  >
                    Add Text
                  </button>
                </div>
              </div>

              {selections.wantsText && (
                <>
                  {/* Text Input */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Your Message</label>
                    <input
                      type="text"
                      value={selections.cakeText}
                      onChange={(e) => setSelections({ ...selections, cakeText: e.target.value })}
                      placeholder="e.g., Happy Birthday!"
                      maxLength={30}
                      className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <p className="text-xs text-muted-foreground text-right">{selections.cakeText.length}/30</p>
                  </div>

                  {/* Text Color Selection */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Text Color</label>
                    <div className="grid grid-cols-6 gap-2">
                      {baseColors.map((color) => (
                        <button
                          key={color.id}
                          onClick={() => setSelections({ ...selections, textColor: color.id })}
                          className={cn(
                            "flex flex-col items-center gap-1 p-1 rounded-lg border transition-all",
                            selections.textColor === color.id
                              ? "ring-2 ring-primary border-primary"
                              : "border-border hover:border-primary/50"
                          )}
                        >
                          <div
                            className={cn(
                              "w-6 h-6 rounded-full border",
                              color.id === "white" || color.id === "cream"
                                ? "border-muted-foreground/30"
                                : "border-transparent"
                            )}
                            style={{ backgroundColor: color.color }}
                          />
                          <span className="text-[10px] text-foreground text-center leading-tight truncate w-full">{color.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Price */}
              <div className="flex justify-between items-center py-4 bg-secondary/50 rounded-lg px-4">
                <span className="font-medium text-foreground">Total</span>
                <span className="text-xl font-bold text-primary">
                  CHF {calculatePrice()}
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