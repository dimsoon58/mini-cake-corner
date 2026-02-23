import { useState, useEffect, useRef, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetClose } from "@/components/ui/sheet";
import { Calendar } from "@/components/ui/calendar";
import { Check, ShoppingBag, Upload, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useCart } from "@/context/CartContext";
import Layout from "@/components/Layout";
import CakeVisualizer from "@/components/CakeVisualizer";
import { format, addDays } from "date-fns";
import flavorVanilla from "@/assets/flavor-vanilla.png";
import flavorRedVelvet from "@/assets/flavor-red-velvet.png";
import flavorChocolate from "@/assets/flavor-chocolate.png";
import flavorChocolateLovers from "@/assets/flavor-chocolate-lovers.png";
import flavorDarkBerrylicious from "@/assets/flavor-dark-berrylicious.png";
import flavorWhiteBerrylicious from "@/assets/flavor-white-berrylicious.png";
import flavorSaltedCaramel from "@/assets/flavor-salted-caramel-new.png";
import flavorLemonCurd from "@/assets/flavor-lemon-curd.png";
import flavorTiramisu from "@/assets/flavor-tiramisu-new.png";
import flavorPraline from "@/assets/flavor-praline.png";
import flavorPassionFruit from "@/assets/flavor-passion-fruit.png";
// Gluten-free flavors use the same images as regular ones
const flavorVanillaGF = flavorVanilla;
const flavorRedVelvetGF = flavorRedVelvet;
const flavorChocolateGF = flavorChocolate;

// Candle images
import candlePuppy from "@/assets/candle-puppy-new.png";
import candlePinkCar from "@/assets/candle-pink-car.png";
import candleSoccer from "@/assets/candle-soccer-new.png";
import candleCherry from "@/assets/candle-cherry-new.png";
import candleTeddyBear from "@/assets/candle-teddy-bear-new.png";
import candleDaisy from "@/assets/candle-daisy.png";
import candleRibbon from "@/assets/candle-ribbon.png";
import candlePinkOmbre from "@/assets/candle-pink-ombre-new.png";
import candleBlueOmbre from "@/assets/candle-blue-ombre-new.png";
import candleThickSpiral from "@/assets/candle-thick-spiral-new.png";
import candleSpiralPastel from "@/assets/candle-spiral-pastel-new.png";
import candleShinySpiral from "@/assets/candle-shiny-spiral-new.png";
import candleRainbow from "@/assets/candle-rainbow.png";
import candleRedCar from "@/assets/candle-red-car-new.png";
import candleBlueCar from "@/assets/candle-blue-car-new.png";
import candleYellowCar from "@/assets/candle-yellow-car-new.png";
import candleHeart from "@/assets/candle-heart-new.png";

// Style images
import styleNormalWithBorder from "@/assets/style-normal-with-border.jpg";
import styleNormalWithoutBorder from "@/assets/style-normal-without-border.jpg";
import designHeartBomb from "@/assets/design-heart-bomb-new.jpg";
import designPearlBorders from "@/assets/design-pearl-borders-new.jpg";
import designPearlNumber from "@/assets/design-pearl-number-new.jpg";
import designRainbowCake from "@/assets/design-rainbow-cake-new.jpg";
import designRosesPlease from "@/assets/design-roses-please-new.jpg";
import designShagCake from "@/assets/design-shag-cake-new.jpg";
import designRetroCake from "@/assets/design-retro-cake-new.jpg";
import designButterflyGarden from "@/assets/design-butterfly-garden-new.jpg";
import designDrawing from "@/assets/design-drawing-new.jpg";
import designPrintedPicture from "@/assets/design-printed-picture-new.jpg";
import designGoldLeaves from "@/assets/design-gold-leaves-new.png";
import designGlitterCake from "@/assets/design-glitter-cake-new.jpg";
import designGlitterInAir from "@/assets/design-glitter-in-air-new.jpg";
import designGenderReveal from "@/assets/design-gender-reveal-new.jpg";
import designCherries from "@/assets/design-cherries-new.png";
import designScatteredPearls from "@/assets/design-scattered-pearls-new.jpg";
import designRibbons from "@/assets/design-ribbons-new.jpg";
import designGlitterCherries from "@/assets/design-glitter-cherries-new.jpg";
import extraSprinkles from "@/assets/extra-sprinkles.jpg";

const steps = ["Date", "Size", "Shape", "Flavor", "Style", "Text", "Extras", "Candles"];

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

// Text colors use the same palette as base colors
const textColors = baseColors;

const sizes = [
  { id: "bento", name: "Bento", description: "Perfect for up to 4 people", price: 40 },
  { id: "medium", name: "Medium", description: "Great for up to 8 people", price: 80 },
  { id: "large", name: "Large", description: "Ideal for up to 16 people", price: 160 },
];

const shapes = [
  { id: "round", name: "Round", extraPrice: { bento: 0, medium: 0, large: 0 } },
  { id: "heart", name: "Heart", extraPrice: { bento: 3, medium: 5, large: 10 } },
];

const flavorCategories = [
  {
    name: "Standard Flavors",
    extraPrice: { bento: 0, medium: 0, large: 0 },
    flavors: [
      { id: "vanilla", name: "Vanilla", description: "Fluffy vanilla sponge with whipped cream", image: flavorVanilla },
      { id: "red-velvet", name: "Red Velvet", description: "Fluffy vanilla and chocolate sponge with whipped cream", image: flavorRedVelvet },
      { id: "chocolate", name: "Chocolate", description: "Fluffy chocolate sponge with whipped cream", image: flavorChocolate },
    ],
  },
  {
    name: "Special Flavors",
    extraPrice: { bento: 2, medium: 4, large: 8 },
    flavors: [
      { id: "chocolate-lovers", name: "Chocolate Lovers", description: "Moist chocolate sponge with rich chocolate ganache", image: flavorChocolateLovers },
      { id: "dark-berrylicious", name: "Dark Berrylicious", description: "Fluffy chocolate sponge filled with a generous raspberry coulis and whipped cream", image: flavorDarkBerrylicious },
      { id: "white-berrylicious", name: "White Berrylicious", description: "Fluffy vanilla sponge filled with a generous raspberry coulis and whipped cream", image: flavorWhiteBerrylicious },
      { id: "salted-caramel", name: "Salted Butter Caramel", description: "Fluffy vanilla sponge filled with caramel and whipped cream", image: flavorSaltedCaramel },
      { id: "lemon-curd", name: "Lemon Curd", description: "Fluffy vanilla sponge filled with lemon curd and whipped cream", image: flavorLemonCurd },
    ],
  },
  {
    name: "Deluxe Flavors",
    extraPrice: { bento: 4, medium: 8, large: 16 },
    flavors: [
      { id: "tiramisu", name: "Tiramisu", description: "Fluffy vanilla sponge filled with fresh coffee and whipped cream", image: flavorTiramisu },
      { id: "praline", name: "Praline Obsession", description: "Fluffy vanilla sponge filled with caramelized almond, hazelnut and whipped cream", image: flavorPraline },
      { id: "passion-fruit", name: "Passion Fruit", description: "Fluffy vanilla sponge filled with fresh passion fruit curd and whipped cream", image: flavorPassionFruit },
      { id: "vanilla-gf", name: "Vanilla Gluten-free", description: "Fluffy gluten-free vanilla sponge with whipped cream", image: flavorVanillaGF },
      { id: "red-velvet-gf", name: "Red Velvet Gluten-free", description: "Fluffy gluten-free vanilla & chocolate sponge with whipped cream", image: flavorRedVelvetGF },
      { id: "chocolate-gf", name: "Chocolate Gluten-free", description: "Fluffy gluten-free chocolate sponge with whipped cream", image: flavorChocolateGF },
    ],
  },
];

const styles = [
  { id: "normal-with-border", name: "Normal with border", price: { bento: 0, medium: 0, large: 0 }, image: styleNormalWithBorder },
  { id: "normal-without-border", name: "Normal without border", price: { bento: 0, medium: 0, large: 0 }, image: styleNormalWithoutBorder },
  { id: "retro-vintage", name: "Retro / Vintage", price: { bento: 5, medium: 15, large: 20 }, image: designRetroCake },
  { id: "heart-bomb", name: "Heart Bomb", price: { bento: 5, medium: 10, large: 15 }, image: designHeartBomb },
  { id: "shag-cake", name: "Shag Cake", price: { bento: 8, medium: 20, large: 30 }, image: designShagCake },
  { id: "rainbow-cake", name: "Rainbow Cake", price: { bento: 7, medium: 17, large: 30 }, image: designRainbowCake },
  { id: "roses-please", name: "Roses Please", price: { bento: 7, medium: 15, large: 20 }, image: designRosesPlease },
  { id: "butterfly-garden", name: "Butterfly Garden", price: { bento: 7, medium: 15, large: 20 }, image: designButterflyGarden },
  { id: "custom-drawing", name: "Custom Drawing", price: { bento: 5, medium: 5, large: 5 }, image: designDrawing },
  { id: "printed-picture", name: "Printed Picture", price: { bento: 20, medium: 20, large: 20 }, image: designPrintedPicture },
  { id: "gold-leaves-style", name: "Gold Leaves", price: { bento: 2, medium: 4, large: 6 }, image: designGoldLeaves },
  { id: "glitter-cake", name: "Glitter Cake", price: { bento: 6, medium: 8, large: 12 }, image: designGlitterCake },
  { id: "glitter-in-the-air", name: "Glitter in the Air", price: { bento: 5, medium: 7, large: 10 }, image: designGlitterInAir },
  { id: "gender-reveal", name: "Gender Reveal", price: { bento: 5, medium: 10, large: 20 }, image: designGenderReveal },
  { id: "scattered-pearls", name: "Scattered Pearls", price: { bento: 2, medium: 5, large: 7 }, image: designScatteredPearls },
  { id: "pearl-borders", name: "Pearl Borders", price: { bento: 8, medium: 15, large: 20 }, image: designPearlBorders },
  { id: "pearl-number", name: "Pearl Number", price: { bento: 5, medium: 5, large: 5 }, image: designPearlNumber },
  { id: "ribbons", name: "Ribbons", price: { bento: 10, medium: 20, large: 30 }, image: designRibbons },
];

const extras = [
  { id: "gold-leaves", name: "Gold Leaves", price: { bento: 2, medium: 4, large: 6 }, image: designGoldLeaves },
  { id: "cherries", name: "Cherries", price: { bento: 4, medium: 8, large: 10 }, image: designCherries },
  { id: "glitter-cherries", name: "Glitter Cherries", price: { bento: 6, medium: 9, large: 12 }, image: designGlitterCherries },
  { id: "glitter", name: "Glitter", price: { bento: 6, medium: 8, large: 12 }, image: designGlitterCake },
  { id: "ribbons", name: "Ribbons", price: { bento: 5, medium: 5, large: 5 }, image: designRibbons },
  { id: "butterfly", name: "Butterfly", price: { bento: 5, medium: 5, large: 5 }, image: designButterflyGarden },
  { id: "pearl-number", name: "Pearl Number", price: { bento: 5, medium: 5, large: 5 }, image: designPearlNumber },
  { id: "printed-picture", name: "Printed Picture", price: { bento: 20, medium: 20, large: 20 }, image: designPrintedPicture },
  { id: "sprinkles", name: "Sprinkles", price: { bento: 2, medium: 2, large: 2 }, image: extraSprinkles },
];

const glitterColors = [
  { id: "white", name: "White", color: "#FFFFFF" },
  { id: "gold", name: "Gold", color: "#D4AF37" },
  { id: "pink", name: "Pink", color: "#FFC0CB" },
  { id: "red", name: "Red", color: "#EF4444" },
  { id: "blue", name: "Blue", color: "#3B82F6" },
];

const glitterCherriesColors = [
  { id: "white", name: "White", color: "#FFFFFF" },
  { id: "gold", name: "Gold", color: "#D4AF37" },
  { id: "pink", name: "Pink", color: "#FFC0CB" },
  { id: "red", name: "Red", color: "#EF4444" },
  { id: "blue", name: "Blue", color: "#3B82F6" },
];

const candles = [
  // Figurines - unit only
  { id: "puppy", name: "Puppy", image: candlePuppy, unitPrice: 2, hasPack: false },
  { id: "teddy-bear", name: "Teddy Bear", image: candleTeddyBear, unitPrice: 2, hasPack: false },
  { id: "cherry", name: "Cherry", image: candleCherry, unitPrice: 2, hasPack: false },
  { id: "heart", name: "Red Heart", image: candleHeart, unitPrice: 2, hasPack: false },
  { id: "daisy", name: "Daisy", image: candleDaisy, unitPrice: 2, hasPack: false },
  { id: "ribbon", name: "Ribbon", image: candleRibbon, unitPrice: 2, hasPack: false },
  { id: "soccer", name: "Footy Flame", image: candleSoccer, unitPrice: 2, hasPack: false },
  { id: "pink-car", name: "Pink Car", image: candlePinkCar, unitPrice: 2, hasPack: false },
  { id: "red-car", name: "Red Car", image: candleRedCar, unitPrice: 2, hasPack: false },
  { id: "blue-car", name: "Blue Car", image: candleBlueCar, unitPrice: 2, hasPack: false },
  { id: "yellow-car", name: "Yellow Car", image: candleYellowCar, unitPrice: 2, hasPack: false },
  // Ombré & Spirals - unit + pack (6) - grouped together
  { id: "pink-ombre", name: "Pink Ombré", image: candlePinkOmbre, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "blue-ombre", name: "Blue Ombré", image: candleBlueOmbre, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "rainbow", name: "Rainbow", image: candleRainbow, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "spiral-pastel", name: "Pastel Spiral", image: candleSpiralPastel, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "shiny-spiral", name: "Shiny Spiral", image: candleShinySpiral, unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  { id: "thick-spiral", name: "Thick Spiral", image: candleThickSpiral, unitPrice: 2, hasPack: true, packSize: 6, packPrice: 10 },
];

const ribbonColors = [
  { id: "baby-pink", name: "Baby Pink", color: "#F4C2C2" },
  { id: "pink", name: "Pink", color: "#FFC0CB" },
  { id: "orange", name: "Orange", color: "#FFA500" },
  { id: "red", name: "Red", color: "#EF4444" },
  { id: "wine-red", name: "Wine Red", color: "#722F37" },
  { id: "white", name: "White", color: "#FFFFFF" },
  { id: "sky-blue", name: "Sky Blue", color: "#87CEEB" },
  { id: "midnight-blue", name: "Midnight Blue", color: "#191970" },
  { id: "black", name: "Black", color: "#000000" },
];

const butterflyColors = [
  { id: "pink", name: "Pink", color: "#FFC0CB" },
  { id: "blue", name: "Blue", color: "#3B82F6" },
  { id: "gold", name: "Gold", color: "#D4AF37" },
];

const Customize = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { addItem } = useCart();
  const [selections, setSelections] = useState<{
    orderDate: Date | null;
    size: string | null;
    shape: string | null;
    flavor: string | null;
    style: string | null;
    baseColor: string | null;
    decorationColor: string | null;
    wantsText: boolean;
    cakeText: string;
    textColor: string | null;
    textStyle: "normal" | "uppercase" | "cursive";
    candles: { id: string; quantity: number; hasPack: boolean }[];
    extras: string[];
    ribbonColor: string | null;
    butterflyColor: string | null;
    glitterColor: string | null;
    glitterCherriesColor: string | null;
    extraComment: string;
    extraImages: File[];
  }>({
    orderDate: null,
    size: null,
    shape: null,
    flavor: null,
    style: null,
    baseColor: null,
    decorationColor: null,
    wantsText: false,
    cakeText: "",
    textColor: null,
    textStyle: "normal",
    candles: [],
    extras: [],
    ribbonColor: null,
    butterflyColor: null,
    glitterColor: null,
    glitterCherriesColor: null,
    extraComment: "",
    extraImages: [],
  });
  const [cartSheetOpen, setCartSheetOpen] = useState(false);

  // Continuous scroll: compute which steps should be visible
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);
  
  const maxVisibleStep = useMemo(() => {
    if (!selections.orderDate) return 0;
    if (!selections.size) return 1;
    if (!selections.shape) return 2;
    if (!selections.flavor) return 3;
    if (!selections.style || !selections.baseColor) return 4;
    if (selections.wantsText && (!selections.cakeText.trim() || !selections.textColor)) return 5;
    return 7;
  }, [selections.orderDate, selections.size, selections.shape, selections.flavor, selections.style, selections.baseColor, selections.wantsText, selections.cakeText, selections.textColor]);

  const prevMaxStep = useRef(0);
  useEffect(() => {
    if (maxVisibleStep > prevMaxStep.current) {
      const scrollTarget = maxVisibleStep === 7 ? 5 : maxVisibleStep;
      setTimeout(() => {
        stepRefs.current[scrollTarget]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 150);
    }
    prevMaxStep.current = maxVisibleStep;
  }, [maxVisibleStep]);

  // Pre-select style from URL parameter (from catalog)
  useEffect(() => {
    const styleParam = searchParams.get("style");
    if (styleParam && styles.some(s => s.id === styleParam)) {
      setSelections(prev => ({ ...prev, style: styleParam }));
    }
  }, [searchParams]);

  // handleNext and handleBack removed - continuous scroll flow

  const handleSelectSize = (sizeId: string) => {
    setSelections({ ...selections, size: sizeId });
  };

  const handleSelectShape = (shapeId: string) => {
    setSelections({ ...selections, shape: shapeId });
  };

  const handleSelectFlavor = (flavorId: string) => {
    setSelections({ ...selections, flavor: flavorId });
  };

  const handleSelectStyle = (styleId: string) => {
    if (styleId === "printed-picture") {
      setSelections({ ...selections, style: styleId, wantsText: false, cakeText: "", textColor: null });
    } else {
      setSelections({ ...selections, style: styleId });
    }
  };

  const handleSelectBaseColor = (colorId: string) => {
    setSelections({ ...selections, baseColor: colorId });
  };

  const handleSelectDecorationColor = (colorId: string) => {
    setSelections({ ...selections, decorationColor: colorId });
  };

  const handleCakeTextChange = (text: string) => {
    setSelections({ ...selections, cakeText: text });
  };

  const handleSelectTextColor = (colorId: string) => {
    setSelections({ ...selections, textColor: colorId });
  };

  const handleToggleExtra = (extraId: string) => {
    const newExtras = selections.extras.includes(extraId)
      ? selections.extras.filter((e) => e !== extraId)
      : [...selections.extras, extraId];
    setSelections({ ...selections, extras: newExtras });
  };

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
      // Remove pack
      newCandles = newCandles.filter((_, i) => i !== existingIndex);
    } else {
      // Add pack
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
    const packSelection = selections.candles.find((c) => c.id === candleId && c.hasPack);
    
    if (unitSelection) {
      // For candles with pack option, always use the cheaper option (pack price vs unit price)
      if (candle.hasPack && candle.packSize && candle.packPrice) {
        const unitTotal = candle.unitPrice * unitSelection.quantity;
        // If unit total >= pack price, just charge pack price for every 6 (or partial group)
        const packsNeeded = Math.ceil(unitSelection.quantity / candle.packSize);
        const packTotal = packsNeeded * candle.packPrice;
        // Use whichever is cheaper
        total += Math.min(unitTotal, packTotal);
      } else {
        total += candle.unitPrice * unitSelection.quantity;
      }
    }
    
    // Add explicit pack selection if any
    if (packSelection && candle.hasPack) {
      total += candle.packPrice || 0;
    }
    return total;
  };

  const canAddToCart = () => {
    return selections.orderDate !== null && selections.size !== null && selections.shape !== null && selections.flavor !== null && selections.style !== null && selections.baseColor !== null;
  };

  const getFlavorCategoryExtra = () => {
    if (!selections.flavor || !selections.size) return 0;
    const category = flavorCategories.find(cat => 
      cat.flavors.some(f => f.id === selections.flavor)
    );
    if (!category) return 0;
    return category.extraPrice[selections.size as keyof typeof category.extraPrice] || 0;
  };

  const getExtraPrice = (extra: typeof extras[0]) => {
    if (!selections.size) return 0;
    return extra.price[selections.size as keyof typeof extra.price] || 0;
  };

  const getStylePrice = (style: typeof styles[0]) => {
    if (!selections.size) return 0;
    return style.price[selections.size as keyof typeof style.price] || 0;
  };

  const calculateTotal = () => {
    const sizePrice = sizes.find((s) => s.id === selections.size)?.price || 0;
    const extrasPrice = selections.extras.reduce((acc, extraId) => {
      const extra = extras.find((e) => e.id === extraId);
      return acc + (extra ? getExtraPrice(extra) : 0);
    }, 0);
    const candlesPrice = candles.reduce((acc, candle) => {
      return acc + getCandleTotalPrice(candle.id);
    }, 0);
    const selectedShape = shapes.find((s) => s.id === selections.shape);
    const shapeExtra = selectedShape && selections.size 
      ? selectedShape.extraPrice[selections.size as keyof typeof selectedShape.extraPrice] || 0
      : 0;
    const flavorExtra = getFlavorCategoryExtra();
    const selectedStyle = styles.find((s) => s.id === selections.style);
    const styleExtra = selectedStyle ? getStylePrice(selectedStyle) : 0;
    return sizePrice + extrasPrice + candlesPrice + shapeExtra + flavorExtra + styleExtra;
  };

  const handleAddToCart = () => {
    const size = sizes.find(s => s.id === selections.size);
    const shape = shapes.find(s => s.id === selections.shape);
    const flavor = flavorCategories.flatMap(c => c.flavors).find(f => f.id === selections.flavor);
    const style = styles.find(s => s.id === selections.style);
    const selectedBaseColor = baseColors.find(c => c.id === selections.baseColor);
    const selectedDecorationColor = baseColors.find(c => c.id === selections.decorationColor);
    const selectedTextColor = textColors.find(c => c.id === selections.textColor);
    const extrasNames = selections.extras.map(id => extras.find(e => e.id === id)?.name || "");
    
    const selectedRibbonColor = ribbonColors.find(c => c.id === selections.ribbonColor);
    const selectedButterflyColor = butterflyColors.find(c => c.id === selections.butterflyColor);
    
    addItem({
      id: "",
      orderDate: selections.orderDate ? format(selections.orderDate, "yyyy-MM-dd") : "",
      size: selections.size || "",
      sizeName: size?.name || "",
      shape: selections.shape || "",
      shapeName: shape?.name || "",
      flavor: selections.flavor || "",
      flavorName: flavor?.name || "",
      style: selections.style || "",
      styleName: style?.name || "",
      baseColor: selections.baseColor || "",
      baseColorName: selectedBaseColor?.name || "",
      decorationColor: selections.decorationColor || "",
      decorationColorName: selectedDecorationColor?.name || "",
      cakeText: selections.cakeText,
      textColor: selections.textColor || "",
      textColorName: selectedTextColor?.name || "",
      extras: selections.extras,
      extrasNames,
      ribbonColor: selections.ribbonColor || "",
      ribbonColorName: selectedRibbonColor?.name || "",
      butterflyColor: selections.butterflyColor || "",
      butterflyColorName: selectedButterflyColor?.name || "",
      total: calculateTotal(),
    });
    
    setCartSheetOpen(true);
  };

  return (
    <Layout hideNav>
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Cake Visualizer - Sidebar on desktop, top on mobile */}
          <div className="lg:w-80 lg:sticky lg:top-4 lg:self-start order-first lg:order-none">
            <CakeVisualizer
              size={selections.size}
              shape={selections.shape}
              baseColor={selections.baseColor}
              decorationColor={selections.decorationColor}
              style={selections.style}
              wantsText={selections.wantsText}
              cakeText={selections.cakeText}
              textColor={selections.textColor}
              textStyle={selections.textStyle}
              extras={selections.extras}
              candles={selections.candles}
              currentStep={maxVisibleStep}
            />
          </div>

          {/* Main Content */}
          <div className="flex-1">
            {/* Progress Steps */}
            <div className="flex items-center justify-center gap-2 mb-8">
              {steps.map((step, index) => (
                <div key={step} className="flex items-center">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-colors",
                      index < maxVisibleStep
                        ? "bg-primary text-primary-foreground"
                        : index === maxVisibleStep
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {index < maxVisibleStep ? <Check className="h-5 w-5" /> : index + 1}
                  </div>
                  <span
                    className={cn(
                      "ml-2 text-sm font-medium hidden sm:block",
                      index <= maxVisibleStep ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {step}
                  </span>
                  {index < steps.length - 1 && (
                    <div
                      className={cn(
                        "w-8 sm:w-16 h-1 mx-2 rounded-full",
                        index < maxVisibleStep ? "bg-primary" : "bg-muted"
                      )}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Step Content */}
            <div className="max-w-4xl mx-auto">
          {/* Date Selection */}
          {maxVisibleStep >= 0 && (
            <div ref={el => stepRefs.current[0] = el} className="scroll-mt-20 space-y-6">
              <h2 className="text-3xl font-bold text-center text-foreground">
                Choose Your Date
              </h2>
              <p className="text-center text-muted-foreground">
                Select your preferred pickup or delivery date
              </p>
              <div className="flex justify-center">
                <Card className="p-4">
                  <Calendar
                    mode="single"
                    selected={selections.orderDate || undefined}
                    onSelect={(date) => setSelections({ ...selections, orderDate: date || null })}
                    disabled={(date) => date < addDays(new Date(), 2)}
                    initialFocus
                    className="rounded-md"
                  />
                </Card>
              </div>
              {selections.orderDate && (
                <p className="text-center text-lg font-medium text-primary">
                  Selected: {format(selections.orderDate, "EEEE, MMMM d, yyyy")}
                </p>
              )}
            </div>
          )}

          {/* Size Selection */}
          {maxVisibleStep >= 1 && (
            <div ref={el => stepRefs.current[1] = el} className="scroll-mt-20 space-y-6 pt-12 border-t border-border mt-12">
              <h2 className="text-3xl font-bold text-center text-foreground">
                Choose Your Size
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
                {sizes.map((size) => (
                  <Card
                    key={size.id}
                    className={cn(
                      "cursor-pointer transition-all hover:shadow-lg",
                      selections.size === size.id
                        ? "ring-2 ring-primary bg-secondary"
                        : "hover:bg-muted/50"
                    )}
                    onClick={() => handleSelectSize(size.id)}
                  >
                    <CardContent className="p-6 text-center">
                      <h3 className="text-xl font-bold text-foreground">{size.name}</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        {size.description}
                      </p>
                      <p className="text-2xl font-bold text-primary mt-3">
                        CHF {size.price}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Shape Selection */}
          {maxVisibleStep >= 2 && (
            <div ref={el => stepRefs.current[2] = el} className="scroll-mt-20 space-y-6 pt-12 border-t border-border mt-12">
              <h2 className="text-3xl font-bold text-center text-foreground">
                Choose Your Shape
              </h2>
              <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
                {shapes.map((shape) => {
                  const heartExtra = selections.size 
                    ? shape.extraPrice[selections.size as keyof typeof shape.extraPrice] 
                    : 0;
                  return (
                    <Card
                      key={shape.id}
                      className={cn(
                        "cursor-pointer transition-all hover:shadow-lg",
                        selections.shape === shape.id
                          ? "ring-2 ring-primary bg-secondary"
                          : "hover:bg-muted/50"
                      )}
                      onClick={() => handleSelectShape(shape.id)}
                    >
                      <CardContent className="p-6 text-center">
                        <h3 className="text-xl font-bold text-foreground">{shape.name}</h3>
                        {shape.id === "heart" && heartExtra > 0 && (
                          <p className="text-sm text-primary mt-2 font-medium">
                            +CHF {heartExtra}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* Flavor Selection */}
          {maxVisibleStep >= 3 && (
            <div ref={el => stepRefs.current[3] = el} className="scroll-mt-20 pt-12 border-t border-border mt-12 space-y-10 bg-[#FFE4EC] -mx-4 px-4 py-8 rounded-2xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
              <h2 className="text-3xl font-bold text-center text-foreground">
                Choose Your Flavor
              </h2>
              {flavorCategories.map((category) => {
                const categoryExtra = selections.size 
                  ? category.extraPrice[selections.size as keyof typeof category.extraPrice] 
                  : 0;
                return (
                <div key={category.name} className="space-y-6">
                  <h3 className="text-xl font-serif text-center text-foreground uppercase tracking-wider">
                    {category.name}
                    {categoryExtra > 0 && (
                      <span className="text-primary font-medium"> (+CHF {categoryExtra})</span>
                    )}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    {category.flavors.map((flavor) => (
                      <Card
                        key={flavor.id}
                        className={cn(
                          "cursor-pointer transition-all hover:shadow-lg !bg-transparent border-transparent shadow-none",
                          selections.flavor === flavor.id
                            ? "ring-2 ring-primary"
                            : ""
                        )}
                        onClick={() => handleSelectFlavor(flavor.id)}
                      >
                        <CardContent className="p-6 text-center">
                          {flavor.image && (
                            <img
                              src={flavor.image}
                              alt={flavor.name}
                              className="h-28 mx-auto mb-4 object-contain"
                            />
                          )}
                          <h4 className="text-lg font-serif text-primary mb-2">
                            {flavor.name}
                          </h4>
                          <p className="text-sm text-muted-foreground">
                            {flavor.description}
                          </p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
                );
              })}
            </div>
          )}

          {/* Style Selection */}
          {maxVisibleStep >= 4 && (
            <div ref={el => stepRefs.current[4] = el} className="scroll-mt-20 space-y-8 pt-12 border-t border-border mt-12">
              <h2 className="text-3xl font-bold text-center text-foreground">
                Choose Your Style
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {styles.map((style) => {
                  const stylePrice = getStylePrice(style);
                  return (
                    <Card
                      key={style.id}
                      className={cn(
                        "cursor-pointer transition-all hover:shadow-lg overflow-hidden",
                        selections.style === style.id
                          ? "ring-2 ring-primary bg-secondary"
                          : "hover:bg-muted/50"
                      )}
                      onClick={() => handleSelectStyle(style.id)}
                    >
                      {style.image && (
                        <div className="aspect-square overflow-hidden">
                          <img
                            src={style.image}
                            alt={style.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}
                      <CardContent className={cn("p-4 text-center", !style.image && "py-8")}>
                        <h3 className="font-medium text-foreground">{style.name}</h3>
                        {selections.size && (
                          <p className="text-sm text-primary font-medium mt-1">
                            +CHF {stylePrice}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Base Color Selection */}
              <div className="space-y-4 pt-6 border-t border-border">
                <h3 className="text-xl font-semibold text-center text-foreground">
                  Choose Your Base Color <span className="text-destructive">*</span>
                </h3>
                <p className="text-sm text-muted-foreground text-center">Required to continue</p>
                <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-9 gap-3 max-w-4xl mx-auto">
                  {baseColors.map((color) => (
                    <button
                      key={color.id}
                      onClick={() => handleSelectBaseColor(color.id)}
                      className={cn(
                        "flex flex-col items-center gap-2 p-2 rounded-lg border transition-all",
                        selections.baseColor === color.id
                          ? "ring-2 ring-primary border-primary bg-secondary"
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      <div
                        className={cn(
                          "w-10 h-10 rounded-full border-2",
                          color.id === "white" || color.id === "cream" || color.id === "beige"
                            ? "border-muted-foreground/30"
                            : "border-transparent"
                        )}
                        style={{ backgroundColor: color.color }}
                      />
                      <span className="text-xs text-foreground text-center leading-tight">{color.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Decoration Color Selection */}
              <div className="space-y-4 pt-6 border-t border-border">
                <h3 className="text-xl font-semibold text-center text-foreground">
                  Choose Your Decoration Color
                </h3>
                <p className="text-sm text-muted-foreground text-center">Optional - for decorations like piping, flowers, etc.</p>
                <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-9 gap-3 max-w-4xl mx-auto">
                  {baseColors.map((color) => (
                    <button
                      key={color.id}
                      onClick={() => handleSelectDecorationColor(color.id)}
                      className={cn(
                        "flex flex-col items-center gap-2 p-2 rounded-lg border transition-all",
                        selections.decorationColor === color.id
                          ? "ring-2 ring-primary border-primary bg-secondary"
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      <div
                        className={cn(
                          "w-10 h-10 rounded-full border-2",
                          color.id === "white" || color.id === "cream" || color.id === "beige"
                            ? "border-muted-foreground/30"
                            : "border-transparent"
                        )}
                        style={{ backgroundColor: color.color }}
                      />
                      <span className="text-xs text-foreground text-center leading-tight">{color.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Text Selection */}
          {maxVisibleStep >= 5 && (
            <div ref={el => stepRefs.current[5] = el} className="scroll-mt-20 space-y-8 pt-12 border-t border-border mt-12">
              <h2 className="text-3xl font-bold text-center text-foreground">
                Add Text
              </h2>
              
              {selections.style === "printed-picture" ? (
                <div className="max-w-md mx-auto text-center space-y-4">
                  <p className="text-muted-foreground">Text is not available for the Printed Picture style</p>
                  <div className="inline-block px-6 py-3 rounded-lg bg-primary text-primary-foreground font-medium">
                    No Text
                  </div>
                </div>
              ) : (
              
              <div className="max-w-md mx-auto space-y-6">
                {/* Toggle for No Text / Add Text */}
                <div className="flex justify-center gap-4">
                  <button
                    onClick={() => setSelections({ ...selections, wantsText: false, cakeText: "", textColor: null })}
                    className={cn(
                      "px-6 py-3 rounded-lg font-medium transition-all",
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
                      "px-6 py-3 rounded-lg font-medium transition-all",
                      selections.wantsText
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    )}
                  >
                    Add Text
                  </button>
                </div>

                {selections.wantsText && (
                  <>
                    <div className="space-y-2">
                      <label htmlFor="cakeText" className="block text-sm font-medium text-foreground">
                        Your Message <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="text"
                        id="cakeText"
                        value={selections.cakeText}
                        onChange={(e) => handleCakeTextChange(e.target.value)}
                        placeholder="e.g., Happy Birthday Sarah!"
                        maxLength={30}
                        className={cn(
                          "w-full px-4 py-3 border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary",
                          selections.wantsText && selections.cakeText.trim().length === 0
                            ? "border-destructive"
                            : "border-border"
                        )}
                      />
                      <div className="flex justify-between">
                        {selections.wantsText && selections.cakeText.trim().length === 0 && (
                          <p className="text-xs text-destructive">Please enter your message</p>
                        )}
                        <p className="text-xs text-muted-foreground ml-auto">
                          {selections.cakeText.length}/30 characters
                        </p>
                      </div>
                    </div>

                    {selections.cakeText.length > 0 && (
                      <>
                        {/* Text Style Selection */}
                        <div className="space-y-3">
                          <label className="block text-sm font-medium text-foreground">
                            Text Style
                          </label>
                          <div className="flex justify-center gap-3">
                            <button
                              onClick={() => setSelections({ ...selections, textStyle: "normal" })}
                              className={cn(
                                "px-4 py-2 rounded-lg font-medium transition-all text-sm",
                                selections.textStyle === "normal"
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted text-muted-foreground hover:bg-muted/80"
                              )}
                            >
                              Normal
                            </button>
                            <button
                              onClick={() => setSelections({ ...selections, textStyle: "uppercase" })}
                              className={cn(
                                "px-4 py-2 rounded-lg font-medium transition-all text-sm uppercase",
                                selections.textStyle === "uppercase"
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted text-muted-foreground hover:bg-muted/80"
                              )}
                            >
                              MAJUSCULE
                            </button>
                            <button
                              onClick={() => setSelections({ ...selections, textStyle: "cursive" })}
                              className={cn(
                                "px-4 py-2 rounded-lg font-medium transition-all text-sm italic",
                                selections.textStyle === "cursive"
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted text-muted-foreground hover:bg-muted/80"
                              )}
                              style={{ fontFamily: "cursive" }}
                            >
                              Attaché
                            </button>
                          </div>
                        </div>

                        {/* Text Color Selection */}
                        <div className="space-y-3">
                          <label className="block text-sm font-medium text-foreground">
                            Text Color <span className="text-destructive">*</span>
                          </label>
                          {selections.wantsText && selections.cakeText.trim().length > 0 && !selections.textColor && (
                            <p className="text-xs text-destructive">Please select a text color</p>
                          )}
                          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-3">
                            {textColors.map((color) => (
                              <button
                                key={color.id}
                                onClick={() => handleSelectTextColor(color.id)}
                                className={cn(
                                  "flex flex-col items-center gap-2 p-2 rounded-lg border transition-all",
                                  selections.textColor === color.id
                                    ? "ring-2 ring-primary border-primary bg-secondary"
                                    : "border-border hover:border-primary/50"
                                )}
                              >
                                <div
                                  className={cn(
                                    "w-8 h-8 rounded-full border-2",
                                    color.id === "white" || color.id === "cream"
                                      ? "border-muted-foreground/30"
                                      : "border-transparent"
                                  )}
                                  style={{ backgroundColor: color.color }}
                                />
                                <span className="text-xs text-foreground text-center leading-tight">{color.name}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
              )}
            </div>
          )}

          {/* Extras Selection */}
          {maxVisibleStep >= 6 && (
            <div ref={el => stepRefs.current[6] = el} className="scroll-mt-20 space-y-6 pt-12 border-t border-border mt-12">
              <h2 className="text-3xl font-bold text-center text-foreground">
                Add Extras (Optional)
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
                {extras.map((extra) => (
                  <Card
                    key={extra.id}
                    className={cn(
                      "cursor-pointer transition-all hover:shadow-lg overflow-hidden",
                      selections.extras.includes(extra.id)
                        ? "ring-2 ring-primary bg-secondary"
                        : "hover:bg-muted/50"
                    )}
                    onClick={() => handleToggleExtra(extra.id)}
                  >
                    {extra.image && (
                      <div className="aspect-square overflow-hidden">
                        <img
                          src={extra.image}
                          alt={extra.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <CardContent className={cn("p-4 text-center", !extra.image && "py-8")}>
                      <h3 className="font-medium text-foreground">{extra.name}</h3>
                      <p className="text-primary font-bold mt-1">+CHF {getExtraPrice(extra)}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Glitter Color Selection */}
              {selections.extras.includes("glitter") && (
                <div className="space-y-4 mt-8">
                  <h3 className="text-xl font-semibold text-center text-foreground">
                    Choose Glitter Color
                  </h3>
                  <div className="flex flex-wrap justify-center gap-3">
                    {glitterColors.map((color) => (
                      <button
                        key={color.id}
                        onClick={() => setSelections({ ...selections, glitterColor: color.id })}
                        className={cn(
                          "flex flex-col items-center gap-1 p-2 rounded-lg transition-all",
                          selections.glitterColor === color.id
                            ? "ring-2 ring-primary bg-secondary"
                            : "hover:bg-muted/50"
                        )}
                      >
                        <div
                          className={cn(
                            "w-10 h-10 rounded-full border-2",
                            color.id === "white" ? "border-muted-foreground/30" : "border-muted"
                          )}
                          style={{ backgroundColor: color.color }}
                        />
                        <span className="text-xs text-foreground">{color.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Glitter Cherries Color Selection */}
              {selections.extras.includes("glitter-cherries") && (
                <div className="space-y-4 mt-8">
                  <h3 className="text-xl font-semibold text-center text-foreground">
                    Choose Glitter Cherries Color
                  </h3>
                  <div className="flex flex-wrap justify-center gap-3">
                    {glitterCherriesColors.map((color) => (
                      <button
                        key={color.id}
                        onClick={() => setSelections({ ...selections, glitterCherriesColor: color.id })}
                        className={cn(
                          "flex flex-col items-center gap-1 p-2 rounded-lg transition-all",
                          selections.glitterCherriesColor === color.id
                            ? "ring-2 ring-primary bg-secondary"
                            : "hover:bg-muted/50"
                        )}
                      >
                        <div
                          className={cn(
                            "w-10 h-10 rounded-full border-2",
                            color.id === "white" ? "border-muted-foreground/30" : "border-muted"
                          )}
                          style={{ backgroundColor: color.color }}
                        />
                        <span className="text-xs text-foreground">{color.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Ribbon Color Selection */}
              {selections.extras.includes("ribbons") && (
                <div className="space-y-4 mt-8">
                  <h3 className="text-xl font-semibold text-center text-foreground">
                    Choose Ribbon Color
                  </h3>
                  <div className="flex flex-wrap justify-center gap-3">
                    {ribbonColors.map((color) => (
                      <button
                        key={color.id}
                        onClick={() => setSelections({ ...selections, ribbonColor: color.id })}
                        className={cn(
                          "flex flex-col items-center gap-1 p-2 rounded-lg transition-all",
                          selections.ribbonColor === color.id
                            ? "ring-2 ring-primary bg-secondary"
                            : "hover:bg-muted/50"
                        )}
                      >
                        <div
                          className={cn(
                            "w-10 h-10 rounded-full border-2",
                            color.id === "white" ? "border-muted-foreground/30" : "border-muted"
                          )}
                          style={{ backgroundColor: color.color }}
                        />
                        <span className="text-xs text-foreground">{color.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Butterfly Color Selection */}
              {selections.extras.includes("butterfly") && (
                <div className="space-y-4 mt-8">
                  <h3 className="text-xl font-semibold text-center text-foreground">
                    Choose Butterfly Color
                  </h3>
                  <div className="flex flex-wrap justify-center gap-3">
                    {butterflyColors.map((color) => (
                      <button
                        key={color.id}
                        onClick={() => setSelections({ ...selections, butterflyColor: color.id })}
                        className={cn(
                          "flex flex-col items-center gap-1 p-2 rounded-lg transition-all",
                          selections.butterflyColor === color.id
                            ? "ring-2 ring-primary bg-secondary"
                            : "hover:bg-muted/50"
                        )}
                      >
                        <div
                          className="w-10 h-10 rounded-full border-2 border-muted"
                          style={{ backgroundColor: color.color }}
                        />
                        <span className="text-xs text-foreground">{color.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Comment & Image Upload Section */}
              <div className="space-y-4 mt-8 pt-6 border-t border-border">
                <h3 className="text-xl font-semibold text-center text-foreground">
                  Additional Comments & Images (Optional)
                </h3>
                <p className="text-sm text-muted-foreground text-center">
                  Describe your vision or upload reference images
                </p>
                
                <div className="max-w-lg mx-auto space-y-4">
                  <Textarea
                    placeholder="Explain what you want for your cake, share any specific requests or ideas..."
                    value={selections.extraComment}
                    onChange={(e) => setSelections({ ...selections, extraComment: e.target.value })}
                    className="min-h-[120px] resize-none"
                  />
                  
                  {/* Image Upload */}
                  <div className="space-y-3">
                    <label className="block text-sm font-medium text-foreground">
                      Upload Reference Images
                    </label>
                    <div className="flex flex-wrap gap-3">
                      {/* Display uploaded images */}
                      {selections.extraImages.map((file, index) => (
                        <div key={index} className="relative">
                          <img
                            src={URL.createObjectURL(file)}
                            alt={`Reference ${index + 1}`}
                            className="w-20 h-20 object-cover rounded-lg border border-border"
                          />
                          <button
                            onClick={() => {
                              const newImages = selections.extraImages.filter((_, i) => i !== index);
                              setSelections({ ...selections, extraImages: newImages });
                            }}
                            className="absolute -top-2 -right-2 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      
                      {/* Upload button */}
                      {selections.extraImages.length < 5 && (
                        <label className="w-20 h-20 border-2 border-dashed border-muted-foreground/30 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 transition-colors">
                          <Upload className="w-5 h-5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground mt-1">Upload</span>
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={(e) => {
                              const files = Array.from(e.target.files || []);
                              const remainingSlots = 5 - selections.extraImages.length;
                              const newFiles = files.slice(0, remainingSlots);
                              setSelections({ ...selections, extraImages: [...selections.extraImages, ...newFiles] });
                              e.target.value = '';
                            }}
                          />
                        </label>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Max 5 images. Accepted formats: JPG, PNG, WEBP
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Candles Selection */}
          {maxVisibleStep >= 7 && (
            <div ref={el => stepRefs.current[7] = el} className="scroll-mt-20 space-y-8 bg-[#FFE4EC] -mx-4 px-4 py-8 rounded-2xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 mt-12">
              <h2 className="text-3xl font-bold text-center text-foreground">
                Choose Candles (Optional)
              </h2>
              
              {/* Figurines Section */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-center text-foreground/80">Figurines</h3>
                <div className="flex flex-wrap justify-center gap-4 max-w-5xl mx-auto">
                  {candles.filter(c => !c.hasPack).map((candle) => {
                    const unitQty = getCandleUnitQuantity(candle.id);
                    const isAnySelected = unitQty > 0;
                    
                    return (
                      <div key={candle.id} className="flex flex-col items-center w-40 sm:w-48">
                        <img
                          src={candle.image}
                          alt={candle.name}
                          className="h-56 w-56 object-contain mb-2"
                        />
                        <Card
                          className={cn(
                            "w-full transition-all",
                            isAnySelected ? "ring-2 ring-primary bg-white/80" : "bg-white/60"
                          )}
                        >
                          <CardContent className="p-2 text-center">
                            <h3 className="font-medium text-foreground text-xs mb-0.5">{candle.name}</h3>
                            <p className="text-[10px] text-muted-foreground mb-1.5">CHF {candle.unitPrice} / pièce</p>
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => handleCandleQuantityChange(candle.id, -1)}
                                disabled={unitQty === 0}
                                className={cn(
                                  "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all",
                                  unitQty === 0
                                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                                )}
                              >
                                −
                              </button>
                              <span className="w-5 text-center font-medium text-foreground text-sm">{unitQty}</span>
                              <button
                                onClick={() => handleCandleQuantityChange(candle.id, 1)}
                                className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold hover:bg-primary/90 transition-all"
                              >
                                +
                              </button>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Packs Section - Ombré & Spirals */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-center text-foreground/80">Ombré & Spirales (Pack de 6 disponible)</h3>
                <div className="flex flex-wrap justify-center gap-4 max-w-4xl mx-auto">
                  {candles.filter(c => c.hasPack).map((candle) => {
                    const unitQty = getCandleUnitQuantity(candle.id);
                    const isPackSelected = isCandlePackSelected(candle.id);
                    const isAnySelected = unitQty > 0 || isPackSelected;
                    
                    return (
                      <div key={candle.id} className="flex flex-col items-center w-40 sm:w-48">
                        <img
                          src={candle.image}
                          alt={candle.name}
                          className="h-56 w-56 object-contain mb-2"
                        />
                        <Card
                          className={cn(
                            "w-full transition-all",
                            isAnySelected ? "ring-2 ring-primary bg-white/80" : "bg-white/60"
                          )}
                        >
                          <CardContent className="p-2 text-center">
                            <h3 className="font-medium text-foreground text-xs mb-0.5">{candle.name}</h3>
                            <p className="text-[10px] text-muted-foreground mb-1">CHF {candle.unitPrice}/pièce ou CHF {candle.packPrice}/pack</p>
                            <div className="flex items-center justify-center gap-1.5 mb-1.5">
                              <button
                                onClick={() => handleCandleQuantityChange(candle.id, -1)}
                                disabled={unitQty === 0}
                                className={cn(
                                  "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all",
                                  unitQty === 0
                                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                                )}
                              >
                                −
                              </button>
                              <span className="w-5 text-center font-medium text-foreground text-sm">{unitQty}</span>
                              <button
                                onClick={() => handleCandleQuantityChange(candle.id, 1)}
                                className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold hover:bg-primary/90 transition-all"
                              >
                                +
                              </button>
                            </div>
                            <button
                              onClick={() => handleToggleCandlePack(candle.id)}
                              className={cn(
                                "w-full py-0.5 px-1 rounded text-[10px] transition-all",
                                isPackSelected
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted hover:bg-muted/80 text-foreground"
                              )}
                            >
                              {isPackSelected ? "✓ " : ""}Pack ({candle.packSize}) — CHF {candle.packPrice}
                            </button>
                          </CardContent>
                        </Card>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Add to Cart & Price Summary */}
          {maxVisibleStep >= 5 && (
          <div className="mt-12 max-w-2xl mx-auto">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Estimated Total</p>
              <p className="text-2xl font-bold text-primary">CHF {calculateTotal()}</p>
              
              {/* Price Breakdown Summary */}
              {selections.size && (
                <div className="mt-4 text-left bg-secondary/30 rounded-lg p-4 max-w-sm mx-auto">
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Price Breakdown</p>
                  <div className="space-y-1 text-sm">
                    {selections.size && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {sizes.find(s => s.id === selections.size)?.name}
                        </span>
                        <span className="text-foreground font-medium">
                          CHF {sizes.find(s => s.id === selections.size)?.price || 0}
                        </span>
                      </div>
                    )}
                    
                    {selections.shape && (() => {
                      const shape = shapes.find(s => s.id === selections.shape);
                      const shapeExtra = shape && selections.size 
                        ? shape.extraPrice[selections.size as keyof typeof shape.extraPrice] || 0
                        : 0;
                      return shapeExtra > 0 ? (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{shape?.name} (shape)</span>
                          <span className="text-foreground font-medium">+CHF {shapeExtra}</span>
                        </div>
                      ) : null;
                    })()}
                    
                    {selections.flavor && (() => {
                      const flavorExtra = getFlavorCategoryExtra();
                      const flavorName = flavorCategories.flatMap(c => c.flavors).find(f => f.id === selections.flavor)?.name;
                      return flavorExtra > 0 ? (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{flavorName} (flavor)</span>
                          <span className="text-foreground font-medium">+CHF {flavorExtra}</span>
                        </div>
                      ) : null;
                    })()}
                    
                    {selections.style && (() => {
                      const style = styles.find(s => s.id === selections.style);
                      const styleExtra = style ? getStylePrice(style) : 0;
                      return styleExtra > 0 ? (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{style?.name} (style)</span>
                          <span className="text-foreground font-medium">+CHF {styleExtra}</span>
                        </div>
                      ) : null;
                    })()}
                    
                    {selections.candles.length > 0 && selections.candles.map(candleSelection => {
                      const candle = candles.find(c => c.id === candleSelection.id);
                      if (!candle) return null;
                      let candlePrice: number;
                      let label: string;
                      if (candleSelection.hasPack && candle.hasPack) {
                        candlePrice = candle.packPrice || 0;
                        label = `${candle.name} (Pack ${candle.packSize})`;
                      } else {
                        candlePrice = candle.unitPrice * candleSelection.quantity;
                        label = `${candle.name} x${candleSelection.quantity}`;
                      }
                      return (
                        <div key={`${candleSelection.id}-${candleSelection.hasPack}`} className="flex justify-between">
                          <span className="text-muted-foreground">{label}</span>
                          <span className="text-foreground font-medium">+CHF {candlePrice}</span>
                        </div>
                      );
                    })}
                    
                    {selections.extras.length > 0 && selections.extras.map(extraId => {
                      const extra = extras.find(e => e.id === extraId);
                      if (!extra) return null;
                      const extraPrice = getExtraPrice(extra);
                      return (
                        <div key={extraId} className="flex justify-between">
                          <span className="text-muted-foreground">{extra.name}</span>
                          <span className="text-foreground font-medium">+CHF {extraPrice}</span>
                        </div>
                      );
                    })}
                    
                    <div className="border-t border-muted pt-2 mt-2">
                      <div className="flex justify-between font-semibold">
                        <span className="text-foreground">Total</span>
                        <span className="text-primary">CHF {calculateTotal()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <Button 
                onClick={handleAddToCart}
                disabled={!canAddToCart()}
                className="bg-primary hover:bg-primary/90 mt-6"
                size="lg"
              >
                <ShoppingBag className="h-4 w-4 mr-2" />
                Add to Cart
              </Button>
            </div>
          </div>
          )}
            </div>
          </div>
        </div>
      </div>

      {/* Cart Confirmation Sheet */}
      <Sheet open={cartSheetOpen} onOpenChange={setCartSheetOpen}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-primary">
              <Check className="h-6 w-6" />
              Added to Cart!
            </SheetTitle>
            <SheetDescription>
              Your custom cake has been added to your basket.
            </SheetDescription>
          </SheetHeader>
          
          <div className="mt-6 space-y-4">
            <div className="bg-secondary/50 rounded-lg p-4 space-y-2">
              <p className="font-medium text-foreground">
                {sizes.find(s => s.id === selections.size)?.name}{" "}
                {shapes.find(s => s.id === selections.shape)?.name} Cake
              </p>
              {selections.orderDate && (
                <p className="text-sm text-muted-foreground">
                  Date: {format(selections.orderDate, "EEEE, MMMM d, yyyy")}
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                Flavor: {flavorCategories.flatMap(c => c.flavors).find(f => f.id === selections.flavor)?.name}
              </p>
              <p className="text-sm text-muted-foreground">
                Style: {styles.find(s => s.id === selections.style)?.name}
              </p>
              {selections.baseColor && (
                <p className="text-sm text-muted-foreground">
                  Base Color: {baseColors.find(c => c.id === selections.baseColor)?.name}
                </p>
              )}
              {selections.cakeText && (
                <p className="text-sm text-muted-foreground">
                  Text: "{selections.cakeText}" ({textColors.find(c => c.id === selections.textColor)?.name || "No color"})
                </p>
              )}
              {selections.extras.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  Extras: {selections.extras.map(id => extras.find(e => e.id === id)?.name).join(", ")}
                </p>
              )}
              <p className="text-lg font-bold text-primary mt-2">
                CHF {calculateTotal()}
              </p>
            </div>

            <div className="flex flex-col gap-3 pt-4">
              <Button asChild className="w-full">
                <Link to="/cart">View Basket</Link>
              </Button>
              <Button variant="outline" asChild className="w-full">
                <Link to="/">Continue Shopping</Link>
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </Layout>
  );
};

export default Customize;
