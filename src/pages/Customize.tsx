import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetClose } from "@/components/ui/sheet";
import { Calendar } from "@/components/ui/calendar";
import { ArrowLeft, ArrowRight, Check, ShoppingBag, Pencil, Trash2, CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCart } from "@/context/CartContext";
import Layout from "@/components/Layout";
import { format, addDays } from "date-fns";
import flavorVanilla from "@/assets/flavor-vanilla.png";
import flavorRedVelvet from "@/assets/flavor-red-velvet.png";
import flavorChocolate from "@/assets/flavor-chocolate.png";
import flavorChocolateLovers from "@/assets/flavor-chocolate-lovers.png";
import flavorDarkBerrylicious from "@/assets/flavor-dark-berrylicious.png";
import flavorWhiteBerrylicious from "@/assets/flavor-white-berrylicious.png";
import flavorSaltedCaramel from "@/assets/flavor-salted-caramel.png";
import flavorLemonCurd from "@/assets/flavor-lemon-curd.png";
import flavorTiramisu from "@/assets/flavor-tiramisu.png";
import flavorPraline from "@/assets/flavor-praline.png";
import flavorPassionFruit from "@/assets/flavor-passion-fruit.png";
// Gluten-free flavors use the same images as regular ones
const flavorVanillaGF = flavorVanilla;
const flavorRedVelvetGF = flavorRedVelvet;
const flavorChocolateGF = flavorChocolate;

// Candle images
import candlePuppy from "@/assets/candle-puppy.png";
import candleCar from "@/assets/candle-car.png";
import candleSoccer from "@/assets/candle-soccer.png";
import candleCherry from "@/assets/candle-cherry.png";

const steps = ["Date", "Size", "Shape", "Flavor", "Style", "Text/Phrase", "Candles", "Extras"];

const textColors = [
  { id: "white", name: "White", color: "#FFFFFF" },
  { id: "black", name: "Black", color: "#000000" },
  { id: "pink", name: "Pink", color: "#F472B6" },
  { id: "red", name: "Red", color: "#EF4444" },
  { id: "gold", name: "Gold", color: "#D4AF37" },
  { id: "blue", name: "Blue", color: "#3B82F6" },
  { id: "purple", name: "Purple", color: "#A855F7" },
  { id: "green", name: "Green", color: "#22C55E" },
];

const baseColors = [
  { id: "white", name: "White", color: "#FFFFFF" },
  { id: "cream", name: "Cream", color: "#FFFDD0" },
  { id: "pink", name: "Pink", color: "#FFC0CB" },
  { id: "baby-blue", name: "Baby Blue", color: "#89CFF0" },
  { id: "lavender", name: "Lavender", color: "#E6E6FA" },
  { id: "mint", name: "Mint", color: "#98FF98" },
  { id: "peach", name: "Peach", color: "#FFCBA4" },
  { id: "chocolate", name: "Chocolate", color: "#7B3F00" },
];

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
      { id: "red-velvet", name: "Red Velvet", description: "Moist red velvet with silky cream cheese icing", image: flavorRedVelvet },
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
      { id: "red-velvet-gf", name: "Red Velvet Gluten-free", description: "Moist red velvet with silky cream cheese icing", image: flavorRedVelvetGF },
      { id: "chocolate-gf", name: "Chocolate Gluten-free", description: "Fluffy gluten-free chocolate sponge with whipped cream", image: flavorChocolateGF },
    ],
  },
];

const styles = [
  { id: "retro-vintage", name: "Retro / Vintage", price: { bento: 5, medium: 15, large: 20 } },
  { id: "heart-bomb", name: "Heart Bomb", price: { bento: 5, medium: 10, large: 15 } },
  { id: "shag-cake", name: "Shag Cake", price: { bento: 8, medium: 20, large: 30 } },
  { id: "rainbow-cake", name: "Rainbow Cake", price: { bento: 7, medium: 17, large: 30 } },
  { id: "roses-please", name: "Roses Please", price: { bento: 7, medium: 15, large: 20 } },
  { id: "butterfly-garden", name: "Butterfly Garden", price: { bento: 7, medium: 15, large: 20 } },
  { id: "custom-drawing", name: "Custom Drawing", price: { bento: 5, medium: 5, large: 5 } },
  { id: "printed-picture", name: "Printed Picture", price: { bento: 20, medium: 20, large: 20 } },
  { id: "glitter-cake", name: "Glitter Cake", price: { bento: 6, medium: 8, large: 12 } },
  { id: "gender-reveal", name: "Gender Reveal", price: { bento: 5, medium: 10, large: 20 } },
];

const extras = [
  { id: "gold-leaves", name: "Gold Leaves", price: { bento: 2, medium: 4, large: 6 } },
  { id: "cherries", name: "Cherries", price: { bento: 4, medium: 8, large: 12 } },
  { id: "glitter-cherries", name: "Glitter Cherries", price: { bento: 6, medium: 10, large: 15 } },
  { id: "ribbons", name: "Ribbons", price: { bento: 10, medium: 20, large: 30 } },
  { id: "butterfly", name: "Butterfly", price: { bento: 7, medium: 15, large: 20 } },
  { id: "pearl-number", name: "Pearl Number", price: { bento: 5, medium: 5, large: 5 } },
];

const candles = [
  { id: "puppy", name: "Puppy", image: candlePuppy, price: { bento: 5, medium: 5, large: 5 } },
  { id: "car", name: "Pink Car", image: candleCar, price: { bento: 5, medium: 5, large: 5 } },
  { id: "soccer", name: "Soccer Ball", image: candleSoccer, price: { bento: 5, medium: 5, large: 5 } },
  { id: "cherry", name: "Cherry", image: candleCherry, price: { bento: 5, medium: 5, large: 5 } },
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
  const [currentStep, setCurrentStep] = useState(0);
  const [selections, setSelections] = useState<{
    orderDate: Date | null;
    size: string | null;
    shape: string | null;
    flavor: string | null;
    style: string | null;
    baseColor: string | null;
    cakeText: string;
    textColor: string | null;
    candles: string[];
    extras: string[];
    ribbonColor: string | null;
    butterflyColor: string | null;
  }>({
    orderDate: null,
    size: null,
    shape: null,
    flavor: null,
    style: null,
    baseColor: null,
    cakeText: "",
    textColor: null,
    candles: [],
    extras: [],
    ribbonColor: null,
    butterflyColor: null,
  });
  const [cartSheetOpen, setCartSheetOpen] = useState(false);

  // Pre-select style from URL parameter (from catalog)
  useEffect(() => {
    const styleParam = searchParams.get("style");
    if (styleParam && styles.some(s => s.id === styleParam)) {
      setSelections(prev => ({ ...prev, style: styleParam }));
    }
  }, [searchParams]);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

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
    setSelections({ ...selections, style: styleId });
  };

  const handleSelectBaseColor = (colorId: string) => {
    setSelections({ ...selections, baseColor: colorId });
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

  const handleToggleCandle = (candleId: string) => {
    const newCandles = selections.candles.includes(candleId)
      ? selections.candles.filter((c) => c !== candleId)
      : [...selections.candles, candleId];
    setSelections({ ...selections, candles: newCandles });
  };

  const getCandlePrice = (candle: typeof candles[0]) => {
    if (!selections.size) return 0;
    return candle.price[selections.size as keyof typeof candle.price] || 0;
  };

  const canProceed = () => {
    switch (currentStep) {
      case 0:
        return selections.orderDate !== null;
      case 1:
        return selections.size !== null;
      case 2:
        return selections.shape !== null;
      case 3:
        return selections.flavor !== null;
      case 4:
        return selections.style !== null;
      case 5:
        return true; // Text/Phrase is optional
      case 6:
        return true; // Candles is optional
      case 7:
        return true; // Extras is optional
      default:
        return false;
    }
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
    const candlesPrice = selections.candles.reduce((acc, candleId) => {
      const candle = candles.find((c) => c.id === candleId);
      return acc + (candle ? getCandlePrice(candle) : 0);
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
      {/* Progress Steps */}
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center gap-2 mb-8">
          {steps.map((step, index) => (
            <div key={step} className="flex items-center">
              <div
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-colors",
                  index < currentStep
                    ? "bg-primary text-primary-foreground"
                    : index === currentStep
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {index < currentStep ? <Check className="h-5 w-5" /> : index + 1}
              </div>
              <span
                className={cn(
                  "ml-2 text-sm font-medium hidden sm:block",
                  index === currentStep ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {step}
              </span>
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    "w-8 sm:w-16 h-1 mx-2 rounded-full",
                    index < currentStep ? "bg-primary" : "bg-muted"
                  )}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step Content */}
        <div className="max-w-4xl mx-auto">
          {/* Date Selection */}
          {currentStep === 0 && (
            <div className="space-y-6">
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
          {currentStep === 1 && (
            <div className="space-y-6">
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
          {currentStep === 2 && (
            <div className="space-y-6">
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
          {currentStep === 3 && (
            <div className="space-y-10">
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
                          "cursor-pointer transition-all hover:shadow-lg bg-transparent border-transparent",
                          selections.flavor === flavor.id
                            ? "ring-2 ring-primary"
                            : "hover:bg-muted/30"
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
          {currentStep === 4 && (
            <div className="space-y-8">
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
                        "cursor-pointer transition-all hover:shadow-lg",
                        selections.style === style.id
                          ? "ring-2 ring-primary bg-secondary"
                          : "hover:bg-muted/50"
                      )}
                      onClick={() => handleSelectStyle(style.id)}
                    >
                      <CardContent className="p-4 text-center">
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
                  Choose Your Base Color
                </h3>
                <div className="grid grid-cols-4 sm:grid-cols-8 gap-3 max-w-2xl mx-auto">
                  {baseColors.map((color) => (
                    <button
                      key={color.id}
                      onClick={() => handleSelectBaseColor(color.id)}
                      className={cn(
                        "flex flex-col items-center gap-2 p-3 rounded-lg border transition-all",
                        selections.baseColor === color.id
                          ? "ring-2 ring-primary border-primary"
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      <div
                        className="w-10 h-10 rounded-full border border-border"
                        style={{ backgroundColor: color.color }}
                      />
                      <span className="text-xs text-foreground">{color.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Text/Phrase Selection */}
          {currentStep === 5 && (
            <div className="space-y-8">
              <h2 className="text-3xl font-bold text-center text-foreground">
                Add Text / Phrase (Optional)
              </h2>
              
              <div className="max-w-md mx-auto space-y-6">
                <div className="space-y-2">
                  <label htmlFor="cakeText" className="block text-sm font-medium text-foreground">
                    Your Message
                  </label>
                  <input
                    type="text"
                    id="cakeText"
                    value={selections.cakeText}
                    onChange={(e) => handleCakeTextChange(e.target.value)}
                    placeholder="e.g., Happy Birthday Sarah!"
                    maxLength={50}
                    className="w-full px-4 py-3 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <p className="text-xs text-muted-foreground text-right">
                    {selections.cakeText.length}/50 characters
                  </p>
                </div>

                {selections.cakeText.length > 0 && (
                  <div className="space-y-3">
                    <label className="block text-sm font-medium text-foreground">
                      Text Color
                    </label>
                    <div className="grid grid-cols-4 gap-3">
                      {textColors.map((color) => (
                        <button
                          key={color.id}
                          onClick={() => handleSelectTextColor(color.id)}
                          className={cn(
                            "flex flex-col items-center gap-2 p-3 rounded-lg border transition-all",
                            selections.textColor === color.id
                              ? "ring-2 ring-primary border-primary"
                              : "border-border hover:border-primary/50"
                          )}
                        >
                          <div
                            className="w-8 h-8 rounded-full border border-border"
                            style={{ backgroundColor: color.color }}
                          />
                          <span className="text-xs text-foreground">{color.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Candles Selection */}
          {currentStep === 6 && (
            <div className="space-y-6">
              <h2 className="text-3xl font-bold text-center text-foreground">
                Choose Candles (Optional)
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl mx-auto">
                {candles.map((candle) => (
                  <Card
                    key={candle.id}
                    className={cn(
                      "cursor-pointer transition-all hover:shadow-lg",
                      selections.candles.includes(candle.id)
                        ? "ring-2 ring-primary bg-secondary"
                        : "hover:bg-muted/50"
                    )}
                    onClick={() => handleToggleCandle(candle.id)}
                  >
                    <CardContent className="p-4 text-center">
                      <img
                        src={candle.image}
                        alt={candle.name}
                        className="h-32 w-full object-contain mb-3"
                      />
                      <h3 className="font-medium text-foreground">{candle.name}</h3>
                      <p className="text-primary font-bold mt-1">+CHF {getCandlePrice(candle)}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Extras Selection */}
          {currentStep === 7 && (
            <div className="space-y-6">
              <h2 className="text-3xl font-bold text-center text-foreground">
                Add Extras (Optional)
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
                {extras.map((extra) => (
                  <Card
                    key={extra.id}
                    className={cn(
                      "cursor-pointer transition-all hover:shadow-lg",
                      selections.extras.includes(extra.id)
                        ? "ring-2 ring-primary bg-secondary"
                        : "hover:bg-muted/50"
                    )}
                    onClick={() => handleToggleExtra(extra.id)}
                  >
                    <CardContent className="p-4 text-center">
                      <h3 className="font-medium text-foreground">{extra.name}</h3>
                      <p className="text-primary font-bold mt-1">+CHF {getExtraPrice(extra)}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

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
                          className="w-10 h-10 rounded-full border-2 border-muted"
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
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="flex justify-between items-center mt-12 max-w-2xl mx-auto">
            <Button
              variant="outline"
              onClick={handleBack}
              disabled={currentStep === 0}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>

            <div className="text-center flex-1 mx-4">
              <p className="text-sm text-muted-foreground">Estimated Total</p>
              <p className="text-2xl font-bold text-primary">CHF {calculateTotal()}</p>
              
              {/* Price Breakdown Summary */}
              {selections.size && (
                <div className="mt-4 text-left bg-secondary/30 rounded-lg p-4 max-w-sm mx-auto">
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Price Breakdown</p>
                  <div className="space-y-1 text-sm">
                    {/* Size */}
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
                    
                    {/* Shape Extra */}
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
                    
                    {/* Flavor Extra */}
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
                    
                    {/* Style Extra */}
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
                    
                    {/* Candles */}
                    {selections.candles.length > 0 && selections.candles.map(candleId => {
                      const candle = candles.find(c => c.id === candleId);
                      if (!candle) return null;
                      const candlePrice = getCandlePrice(candle);
                      return (
                        <div key={candleId} className="flex justify-between">
                          <span className="text-muted-foreground">{candle.name} (candle)</span>
                          <span className="text-foreground font-medium">+CHF {candlePrice}</span>
                        </div>
                      );
                    })}
                    
                    {/* Extras */}
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
                    
                    {/* Divider and Total */}
                    <div className="border-t border-muted pt-2 mt-2">
                      <div className="flex justify-between font-semibold">
                        <span className="text-foreground">Total</span>
                        <span className="text-primary">CHF {calculateTotal()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {currentStep < steps.length - 1 ? (
              <Button onClick={handleNext} disabled={!canProceed()}>
                Next
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <Button 
                onClick={handleAddToCart}
                disabled={!canProceed()}
                className="bg-primary hover:bg-primary/90"
              >
                <ShoppingBag className="h-4 w-4 mr-2" />
                Add to Cart
              </Button>
            )}
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
