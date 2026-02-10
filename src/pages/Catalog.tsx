import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShoppingBag, Upload, X, Plus, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import Layout from "@/components/Layout";
import { useCart } from "@/context/CartContext";
import { useToast } from "@/hooks/use-toast";

// Candle images
import candlePuppy from "@/assets/candle-puppy.png";
import candleCar from "@/assets/candle-car.png";
import candleSoccer from "@/assets/candle-soccer.png";
import candleCherry from "@/assets/candle-cherry.png";
import candleTeddyBear from "@/assets/candle-teddy-bear.png";
import candlePinkOmbre from "@/assets/candle-pink-ombre.png";
import candleBlueOmbre from "@/assets/candle-blue-ombre.png";
import candleThickSpiral from "@/assets/candle-thick-spiral.png";
import candleSpiralPastel from "@/assets/candle-spiral-pastel.png";
import candleShinySpiral from "@/assets/candle-shiny-spiral.png";
import candleRedCar from "@/assets/candle-red-car.png";
import candleBlueCar from "@/assets/candle-blue-car.png";
import candleYellowCar from "@/assets/candle-yellow-car.png";
import candleHeart from "@/assets/candle-heart.png";
import designRetroCake from "@/assets/design-retro-cake-new.jpg";
import designRetroGlitter from "@/assets/design-retro-glitter-new.jpg";
import designRainbowCake from "@/assets/design-rainbow-cake-new.jpg";
import designShagCake from "@/assets/design-shag-cake-new.jpg";
import designGoldLeaves from "@/assets/design-gold-leaves-new.png";
import designScatteredPearls from "@/assets/design-scattered-pearls-new.jpg";
import designPearlBorders from "@/assets/design-pearl-borders-new.jpg";
import designCherries from "@/assets/design-cherries-new.png";
import designGlitterCherries from "@/assets/design-glitter-cherries-new.jpg";
import designRibbons from "@/assets/design-ribbons-new.jpg";
import designGlitterCake from "@/assets/design-glitter-cake-new.jpg";
import designGlitterInAir from "@/assets/design-glitter-in-air-new.jpg";
import designHeartBomb from "@/assets/design-heart-bomb-new.jpg";
import designGenderReveal from "@/assets/design-gender-reveal-new.jpg";
import designPrintedPicture from "@/assets/design-printed-picture-new.jpg";
import designDrawing from "@/assets/design-drawing-new.jpg";
import designRosesPlease from "@/assets/design-roses-please-new.jpg";
import designButterflyGarden from "@/assets/design-butterfly-garden-new.jpg";
import designPearlNumber from "@/assets/design-pearl-number-new.jpg";
import styleNormalWithBorder from "@/assets/style-normal-with-border.jpg";
import styleNormalWithoutBorder from "@/assets/style-normal-without-border.jpg";

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
  { id: "retro", name: "Retro Box", price: 40 },
  { id: "medium", name: "Medium", price: 80 },
  { id: "large", name: "Large", price: 160 },
];

const shapes = [
  { id: "round", name: "Round", extraPrice: { bento: 0, retro: 0, medium: 0, large: 0 } },
  { id: "heart", name: "Heart", extraPrice: { bento: 3, retro: 3, medium: 5, large: 10 } },
];

const flavors = [
  { id: "vanilla", name: "Vanilla", extraPrice: { bento: 0, retro: 0, medium: 0, large: 0 } },
  { id: "red-velvet", name: "Red Velvet", extraPrice: { bento: 0, retro: 0, medium: 0, large: 0 } },
  { id: "chocolate", name: "Chocolate", extraPrice: { bento: 0, retro: 0, medium: 0, large: 0 } },
  { id: "chocolate-lovers", name: "Chocolate Lovers", extraPrice: { bento: 2, retro: 2, medium: 4, large: 8 } },
  { id: "dark-berrylicious", name: "Dark Berrylicious", extraPrice: { bento: 2, retro: 2, medium: 4, large: 8 } },
  { id: "white-berrylicious", name: "White Berrylicious", extraPrice: { bento: 2, retro: 2, medium: 4, large: 8 } },
  { id: "salted-caramel", name: "Salted Butter Caramel", extraPrice: { bento: 2, retro: 2, medium: 4, large: 8 } },
  { id: "lemon-curd", name: "Lemon Curd", extraPrice: { bento: 2, retro: 2, medium: 4, large: 8 } },
  { id: "tiramisu", name: "Tiramisu", extraPrice: { bento: 4, retro: 4, medium: 8, large: 16 } },
  { id: "praline", name: "Praline Obsession", extraPrice: { bento: 4, retro: 4, medium: 8, large: 16 } },
  { id: "passion-fruit", name: "Passion Fruit", extraPrice: { bento: 4, retro: 4, medium: 8, large: 16 } },
];

const candles = [
  // Figurines - unit only
  { id: "puppy", name: "Puppy", image: candlePuppy, unitPrice: 2, hasPack: false },
  { id: "teddy-bear", name: "Teddy Bear", image: candleTeddyBear, unitPrice: 2, hasPack: false },
  { id: "cherry", name: "Cherry", image: candleCherry, unitPrice: 2, hasPack: false },
  { id: "heart", name: "Red Heart", image: candleHeart, unitPrice: 2, hasPack: false },
  { id: "soccer", name: "Footy Flame", image: candleSoccer, unitPrice: 2, hasPack: false },
  { id: "pink-car", name: "Pink Car", image: candleCar, unitPrice: 2, hasPack: false },
  { id: "red-car", name: "Red Car", image: candleRedCar, unitPrice: 2, hasPack: false },
  { id: "blue-car", name: "Blue Car", image: candleBlueCar, unitPrice: 2, hasPack: false },
  { id: "yellow-car", name: "Yellow Car", image: candleYellowCar, unitPrice: 2, hasPack: false },
  // Ombré - unit + pack (6)
  { id: "pink-ombre", name: "Pink Ombré", image: candlePinkOmbre, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "blue-ombre", name: "Blue Ombré", image: candleBlueOmbre, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  // Spirals - unit + pack (6)
  { id: "spiral-pastel", name: "Pastel Spiral", image: candleSpiralPastel, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "thick-spiral", name: "Thick Spiral", image: candleThickSpiral, unitPrice: 2, hasPack: true, packSize: 6, packPrice: 10 },
  { id: "shiny-spiral", name: "Shiny Spiral", image: candleShinySpiral, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
];

const catalog = [
  {
    id: "normal-without-border",
    name: "Normal without Border",
    description: "Clean and simple smooth finish",
    image: styleNormalWithoutBorder,
    styleId: "normal-without-border",
    styleName: "Normal without border",
    stylePrice: { bento: 0, retro: 2, medium: 0, large: 0 },
    disableText: false,
  },
  {
    id: "normal-with-border",
    name: "Normal with Border",
    description: "Classic cake with elegant piped border",
    image: styleNormalWithBorder,
    styleId: "normal-with-border",
    styleName: "Normal with border",
    stylePrice: { bento: 0, retro: 2, medium: 80, large: 170 },
    disableText: false,
  },
  {
    id: "retro-cake",
    name: "Retro Cake",
    description: "Vintage style with elegant decorations",
    image: designRetroCake,
    styleId: "retro-vintage",
    styleName: "Retro / Vintage",
    stylePrice: { bento: 5, medium: 15, large: 20 },
    disableText: false,
  },
  {
    id: "rainbow-cake",
    name: "Rainbow Cake",
    description: "A fun retro-style cake with pastel rainbows, sprinkles, and piped borders",
    image: designRainbowCake,
    styleId: "rainbow-cake",
    styleName: "Rainbow Cake",
    stylePrice: { bento: 7, medium: 17, large: 30 },
    disableText: false,
  },
  {
    id: "shag-cake",
    name: "Shag Cake",
    description: "A retro inspired shag cake with rich texture and colorful details",
    image: designShagCake,
    styleId: "shag-cake",
    styleName: "Shag Cake",
    stylePrice: { bento: 8, medium: 20, large: 30 },
    disableText: false,
  },
  {
    id: "gold-leaves",
    name: "Gold Leaves",
    description: "Elegant cake with gold leaf border",
    image: designGoldLeaves,
    styleId: "gold-leaves-style",
    styleName: "Gold Leaves",
    stylePrice: { bento: 2, retro: 2, medium: 5, large: 8 },
    disableText: false,
  },
  {
    id: "scattered-retro-pearls",
    name: "Scattered Retro Pearls",
    description: "Delicate pearls scattered across the cake, with a pearl border and retro decoration",
    image: designScatteredPearls,
    styleId: "scattered-retro-pearls",
    styleName: "Scattered Retro Pearls",
    stylePrice: { bento: 15, medium: 30, large: 45 },
    disableText: false,
  },
  {
    id: "pearl-border-retro",
    name: "Pearl Border × Retro Decoration",
    description: "Three elegant pearl borders with a retro decoration",
    image: designPearlBorders,
    styleId: "pearl-border-retro",
    styleName: "Pearl Border × Retro Decoration",
    stylePrice: { bento: 25, medium: 50, large: 65 },
    disableText: false,
  },
  {
    id: "glitter-cherries-retro",
    name: "Glitter Cherries x Retro Cake",
    description: "Sparkling cherry decorations on a retro cake",
    image: designGlitterCherries,
    styleId: "glitter-cherries-retro",
    styleName: "Glitter Cherries on a Retro Cake",
    stylePrice: { bento: 12, medium: 25, large: 35 },
    disableText: false,
  },
  {
    id: "cherries-retro",
    name: "Cherries x Retro Cake",
    description: "Retro cake topped with cherries",
    image: designCherries,
    styleId: "cherries-retro",
    styleName: "Cherries on a Retro Cake",
    stylePrice: { bento: 9, medium: 20, large: 30 },
    disableText: false,
  },
  {
    id: "retro-ribbons",
    name: "Retro × Ribbons",
    description: "Beautiful ribbon decorations on a retro cake",
    image: designRibbons,
    styleId: "retro-ribbons",
    styleName: "Retro × Ribbons",
    stylePrice: { bento: 10, medium: 20, large: 30 },
    disableText: false,
  },
  {
    id: "retro-glitter-cake",
    name: "Retro Glitter Cake",
    description: "Sparkly glitter finish on a retro cake",
    image: designRetroGlitter,
    styleId: "retro-glitter-cake",
    styleName: "Retro Glitter Cake",
    stylePrice: { bento: 10, medium: 20, large: 30 },
    disableText: false,
  },
  {
    id: "glitter-base",
    name: "Glitter Base",
    description: "Sparkly glitter base surrounded by gold leaf",
    image: designGlitterCake,
    styleId: "glitter-base",
    styleName: "Glitter Base",
    stylePrice: { bento: 7, retro: 2, medium: 10, large: 12 },
    disableText: false,
  },
  {
    id: "retro-ribbons-glitter",
    name: "Retro × Ribbons Glitter in the Air",
    description: "A retro cake with ribbons and glitter in the center, blow on it and the glitter flies into the air",
    image: designGlitterInAir,
    styleId: "retro-ribbons-glitter",
    styleName: "Retro × Ribbons Glitter in the Air",
    stylePrice: { bento: 20, medium: 30, large: 40 },
    disableText: false,
  },
  {
    id: "gender-reveal",
    name: "Gender Reveal",
    description: "Choose the inside color. Perfect for your special announcement",
    image: designGenderReveal,
    styleId: "gender-reveal",
    styleName: "Gender Reveal",
    stylePrice: { bento: 5, medium: 10, large: 20 },
    disableText: false,
  },
  {
    id: "printed-picture",
    name: "Printed Pictures / Logo",
    description: "Add a personal touch with a printed photo or logo on the cake",
    image: designPrintedPicture,
    styleId: "printed-picture",
    styleName: "Printed Picture",
    stylePrice: { bento: 20, medium: 20, large: 20 },
    disableText: true,
  },
  {
    id: "drawing",
    name: "Drawing",
    description: "Hand-drawn custom design",
    image: designDrawing,
    styleId: "custom-drawing",
    styleName: "Custom Drawing",
    stylePrice: { bento: 5, retro: 2, medium: 10, large: 15 },
    disableText: false,
  },
  {
    id: "butterfly-garden",
    name: "Butterfly Garden",
    description: "A beautiful gradient cake adorned with pearls and edible butterfly",
    image: designButterflyGarden,
    styleId: "butterfly-garden",
    styleName: "Butterfly Garden",
    stylePrice: { bento: 7, medium: 15, large: 20 },
    disableText: false,
  },
  {
    id: "pearl-number",
    name: "Pearl Number",
    description: "Customize with a pearl number",
    image: designPearlNumber,
    styleId: "pearl-number",
    styleName: "Pearl Number",
    stylePrice: { bento: 5, medium: 5, large: 5 },
    disableText: false,
  },
];

interface CandleSelection {
  id: string;
  quantity: number;
  hasPack: boolean;
}

interface CakeSelections {
  size: string;
  shape: string;
  flavor: string;
  baseColor: string;
  decorationColor: string;
  wantsText: boolean;
  cakeText: string;
  textColor: string;
  candles: CandleSelection[];
  printedImage: File | null;
}

const Catalog = () => {
  const { addItem } = useCart();
  const { toast } = useToast();
  const [selectedCake, setSelectedCake] = useState<typeof catalog[0] | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selections, setSelections] = useState<CakeSelections>({
    size: "bento",
    shape: "round",
    flavor: "vanilla",
    baseColor: "",
    decorationColor: "",
    wantsText: false,
    cakeText: "",
    textColor: "",
    candles: [],
    printedImage: null,
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
      candles: [],
      printedImage: null,
    });
    setSheetOpen(true);
  };

  // Candle helpers
  const handleCandleQuantityChange = (candleId: string, delta: number) => {
    const existingIndex = selections.candles.findIndex((c) => c.id === candleId && !c.hasPack);
    let newCandles = [...selections.candles];
    
    if (existingIndex >= 0) {
      const newQty = newCandles[existingIndex].quantity + delta;
      if (newQty <= 0) {
        newCandles = newCandles.filter((_, i) => i !== existingIndex);
      } else {
        newCandles[existingIndex] = { ...newCandles[existingIndex], quantity: newQty };
      }
    } else if (delta > 0) {
      newCandles.push({ id: candleId, quantity: 1, hasPack: false });
    }
    setSelections({ ...selections, candles: newCandles });
  };

  const handleToggleCandlePack = (candleId: string) => {
    const existingIndex = selections.candles.findIndex((c) => c.id === candleId && c.hasPack);
    let newCandles = [...selections.candles];
    
    if (existingIndex >= 0) {
      newCandles = newCandles.filter((_, i) => i !== existingIndex);
    } else {
      newCandles.push({ id: candleId, quantity: 1, hasPack: true });
    }
    setSelections({ ...selections, candles: newCandles });
  };

  const getCandleUnitQuantity = (candleId: string) => {
    const selection = selections.candles.find((c) => c.id === candleId && !c.hasPack);
    return selection?.quantity || 0;
  };

  const isCandlePackSelected = (candleId: string) => {
    return selections.candles.some((c) => c.id === candleId && c.hasPack);
  };

  const getCandleTotalPrice = (candleId: string) => {
    const candle = candles.find((c) => c.id === candleId);
    if (!candle) return 0;
    
    let total = 0;
    const unitSelection = selections.candles.find((c) => c.id === candleId && !c.hasPack);
    if (unitSelection) {
      total += candle.unitPrice * unitSelection.quantity;
    }
    const packSelection = selections.candles.find((c) => c.id === candleId && c.hasPack);
    if (packSelection && candle.hasPack) {
      total += candle.packPrice || 0;
    }
    return total;
  };

  const getTotalCandlesPrice = () => {
    return candles.reduce((acc, candle) => acc + getCandleTotalPrice(candle.id), 0);
  };

  // Image upload helpers
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelections({ ...selections, printedImage: file });
    }
  };

  const removeImage = () => {
    setSelections({ ...selections, printedImage: null });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
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
    const candlesTotal = getTotalCandlesPrice();
    
    return basePrice + shapeExtra + flavorExtra + styleExtra + candlesTotal;
  };

  const handleAddToCart = () => {
    if (!selectedCake) return;
    
    // Validate required color selections
    if (!selections.baseColor) {
      toast({
        title: "Base Color required",
        description: "Please select a base color for your cake.",
        variant: "destructive",
      });
      return;
    }
    
    if (!selections.decorationColor) {
      toast({
        title: "Decoration Color required",
        description: "Please select a decoration color for your cake.",
        variant: "destructive",
      });
      return;
    }

    // Validate text color if text is selected
    if (selections.wantsText && !selections.textColor) {
      toast({
        title: "Text Color required",
        description: "Please select a color for your text.",
        variant: "destructive",
      });
      return;
    }

    // Validate text message if text is selected
    if (selections.wantsText && !selections.cakeText.trim()) {
      toast({
        title: "Text message required",
        description: "Please enter your message.",
        variant: "destructive",
      });
      return;
    }

    // Validate printed image for printed-picture style
    if (selectedCake.styleId === "printed-picture" && !selections.printedImage) {
      toast({
        title: "Image required",
        description: "Please upload an image for your printed picture cake.",
        variant: "destructive",
      });
      return;
    }
    
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
                <h3 className="font-serif text-xl font-bold text-foreground mb-2">
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
                    {sizes.filter((size) => selectedCake && size.id in selectedCake.stylePrice).map((size) => (
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

              {/* Design Display */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Design</label>
                <div className="bg-secondary/50 rounded-lg p-4">
                  <p className="font-medium text-foreground">{selectedCake.styleName}</p>
                  <p className="text-sm text-primary mt-1">
                    +CHF {selectedCake.stylePrice[selections.size as keyof typeof selectedCake.stylePrice]}
                  </p>
                </div>
              </div>

              {/* Base Color Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Base Color <span className="text-destructive">*</span>
                </label>
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
                <label className="text-sm font-medium text-foreground">
                  Decoration Color <span className="text-destructive">*</span>
                </label>
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

              {/* Text Toggle - hidden for printed-picture */}
              {!selectedCake?.disableText && (
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
              )}

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

              {/* Printed Picture Upload - only for printed-picture style */}
              {selectedCake?.styleId === "printed-picture" && (
                <div className="space-y-3">
                  <label className="text-sm font-medium text-foreground">Upload Your Image</label>
                  <p className="text-xs text-muted-foreground">
                    Upload the image or logo you want printed on your cake (JPG, PNG, WEBP)
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                  {!selections.printedImage ? (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full border-2 border-dashed border-border rounded-lg p-6 flex flex-col items-center gap-2 hover:border-primary/50 transition-colors"
                    >
                      <Upload className="w-8 h-8 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Click to upload image</span>
                    </button>
                  ) : (
                    <div className="relative">
                      <img
                        src={URL.createObjectURL(selections.printedImage)}
                        alt="Uploaded preview"
                        className="w-full h-32 object-contain rounded-lg bg-muted/30"
                      />
                      <button
                        onClick={removeImage}
                        className="absolute top-2 right-2 bg-destructive text-destructive-foreground rounded-full p-1 hover:bg-destructive/80"
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <p className="text-xs text-muted-foreground mt-1 truncate">{selections.printedImage.name}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Candles Section */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-foreground">🕯️ Candles (Optional)</label>
                <div className="grid grid-cols-2 gap-3">
                  {candles.map((candle) => {
                    const unitQty = getCandleUnitQuantity(candle.id);
                    const packSelected = isCandlePackSelected(candle.id);
                    const totalPrice = getCandleTotalPrice(candle.id);
                    
                    return (
                      <div
                        key={candle.id}
                        className={cn(
                          "border rounded-lg p-3 transition-all",
                          (unitQty > 0 || packSelected) ? "border-primary bg-primary/5" : "border-border"
                        )}
                      >
                        <div className="flex gap-2 items-start mb-2">
                          <img
                            src={candle.image}
                            alt={candle.name}
                            className="w-10 h-10 object-contain rounded"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground truncate">{candle.name}</p>
                            <p className="text-xs text-muted-foreground">CHF {candle.unitPrice}/unit</p>
                          </div>
                        </div>
                        
                        {/* Unit quantity */}
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-muted-foreground">Units:</span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleCandleQuantityChange(candle.id, -1)}
                              disabled={unitQty === 0}
                              className="w-6 h-6 flex items-center justify-center rounded bg-muted hover:bg-muted/80 disabled:opacity-50"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="w-6 text-center text-xs font-medium">{unitQty}</span>
                            <button
                              onClick={() => handleCandleQuantityChange(candle.id, 1)}
                              className="w-6 h-6 flex items-center justify-center rounded bg-muted hover:bg-muted/80"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        
                        {/* Pack option */}
                        {candle.hasPack && (
                          <button
                            onClick={() => handleToggleCandlePack(candle.id)}
                            className={cn(
                              "w-full text-xs py-1.5 rounded transition-all",
                              packSelected
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground hover:bg-muted/80"
                            )}
                          >
                            Pack of {candle.packSize} - CHF {candle.packPrice}
                          </button>
                        )}
                        
                        {totalPrice > 0 && (
                          <p className="text-xs text-primary font-medium mt-2 text-right">
                            +CHF {totalPrice}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

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