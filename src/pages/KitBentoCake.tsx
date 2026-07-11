import { useState, useMemo, useRef, useEffect } from "react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { format, addDays } from "date-fns";
import { CalendarIcon, Check, ShoppingCart, ChevronDown, ChevronUp } from "lucide-react";
import { useCart } from "@/context/CartContext";
import { useNavigate } from "react-router-dom";
import { AllergenDisplay } from "@/data/allergens";
import { toast } from "sonner";

// Flavor images
import flavorVanilla from "@/assets/flavor-vanilla.png";
import flavorRedVelvet from "@/assets/flavor-red-velvet.png";
import flavorChocolate from "@/assets/flavor-chocolate.png";
import flavorChocolateLovers from "@/assets/flavor-chocolate-lovers.png";
import flavorChocolateLoverBerrylicious from "@/assets/flavor-chocolate-lover-berrylicious.png";
import flavorDarkBerrylicious from "@/assets/flavor-dark-berrylicious.png";
import flavorWhiteBerrylicious from "@/assets/flavor-white-berrylicious.png";
import flavorSaltedCaramel from "@/assets/flavor-salted-caramel-new.png";
import flavorLemonCurd from "@/assets/flavor-lemon-curd.png";
import flavorOrangeBlossom from "@/assets/flavor-orange-blossom.png";
import flavorTiramisu from "@/assets/flavor-tiramisu-new.png";
import flavorPraline from "@/assets/flavor-praline.png";
import flavorPassionFruit from "@/assets/flavor-passion-fruit.png";

// Candle images
import candlePuppy from "@/assets/candle-puppy-new.png";
import candleTeddyBear from "@/assets/candle-teddy-bear-new.png";
import candleCherry from "@/assets/candle-cherry-new.png";
import candleHeart from "@/assets/candle-heart-new.png";
import candleSoccer from "@/assets/candle-soccer-new.png";
import candleBlueCar from "@/assets/candle-blue-car-new.png";
import candleRedCar from "@/assets/candle-red-car-new.png";
import candleYellowCar from "@/assets/candle-yellow-car-new.png";
import candleBlueOmbre from "@/assets/candle-blue-ombre-new.png";
import candlePinkOmbre from "@/assets/candle-pink-ombre-new.png";
import candleSpiralPastel from "@/assets/candle-spiral-pastel-new.png";
import candleShinySpiral from "@/assets/candle-shiny-spiral-new.png";
import candleThickSpiral from "@/assets/candle-thick-spiral-new.png";
import candleDaisy from "@/assets/candle-daisy.png";
import candleRibbon from "@/assets/candle-ribbon.png";
import candlePinkCar from "@/assets/candle-pink-car.png";
import candleRainbow from "@/assets/candle-rainbow.png";

const BASE_PRICE = 40;

const shapes = [
  { id: "round", name: "Round", extraPrice: 0 },
  { id: "heart", name: "Heart", extraPrice: 3 },
];

const flavorCategories = [
  {
    name: "Standard Flavors",
    extraPrice: 0,
    flavors: [
      { id: "vanilla", name: "Vanilla", description: "Fluffy vanilla sponge with whipped cream", image: flavorVanilla },
      { id: "red-velvet", name: "Red Velvet", description: "Fluffy vanilla and chocolate sponge with whipped cream", image: flavorRedVelvet },
      { id: "chocolate", name: "Chocolate", description: "Fluffy chocolate sponge with whipped cream", image: flavorChocolate },
    ],
  },
  {
    name: "Special Flavors",
    extraPrice: 2,
    flavors: [
      { id: "chocolate-lovers", name: "Chocolate Lovers", description: "Moist chocolate sponge with rich chocolate ganache", image: flavorChocolateLovers },
      { id: "chocolate-lover-berrylicious", name: "Chocolate Lover x Berrylicious", description: "Chocolate sponge with raspberry coulis and chocolate ganache", image: flavorChocolateLoverBerrylicious },
      { id: "dark-berrylicious", name: "Dark Berrylicious", description: "Fluffy chocolate sponge filled with a generous raspberry coulis and whipped cream", image: flavorDarkBerrylicious },
      { id: "white-berrylicious", name: "White Berrylicious", description: "Fluffy vanilla sponge filled with a generous raspberry coulis and whipped cream", image: flavorWhiteBerrylicious },
      { id: "salted-caramel", name: "Salted Butter Caramel", description: "Fluffy vanilla sponge filled with caramel and whipped cream", image: flavorSaltedCaramel },
      { id: "lemon-curd", name: "Lemon Curd", description: "Fluffy vanilla sponge filled with lemon curd and whipped cream", image: flavorLemonCurd },
      { id: "orange-blossom", name: "Orange Blossom", description: "Fluffy vanilla sponge filled with orange blossom cream and whipped cream", image: flavorOrangeBlossom },
    ],
  },
  {
    name: "Deluxe Flavors",
    extraPrice: 4,
    flavors: [
      { id: "tiramisu", name: "Tiramisu", description: "Fluffy vanilla sponge filled with fresh coffee and whipped cream", image: flavorTiramisu },
      { id: "praline", name: "Praline Obsession", description: "Fluffy vanilla sponge filled with caramelized almond, hazelnut and whipped cream", image: flavorPraline },
      { id: "passion-fruit", name: "Passion Fruit", description: "Fluffy vanilla sponge filled with fresh passion fruit curd and whipped cream", image: flavorPassionFruit },
      { id: "vanilla-gf", name: "Vanilla Gluten-free", description: "Fluffy gluten-free vanilla sponge with whipped cream", image: flavorVanilla },
      { id: "red-velvet-gf", name: "Red Velvet Gluten-free", description: "Fluffy gluten-free vanilla & chocolate sponge with whipped cream", image: flavorRedVelvet },
      { id: "chocolate-gf", name: "Chocolate Gluten-free", description: "Fluffy gluten-free chocolate sponge with whipped cream", image: flavorChocolate },
    ],
  },
];

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

const pipingBagOptions = [
  { id: "2-bags", name: "2 Piping Bags", count: 2, price: 0 },
  { id: "3-bags", name: "3 Piping Bags", count: 3, price: 2 },
];

const candles = [
  // Figurines
  { id: "puppy", name: "Puppy", image: candlePuppy, unitPrice: 2, hasPack: false },
  { id: "teddy-bear", name: "Teddy Bear", image: candleTeddyBear, unitPrice: 2, hasPack: false },
  { id: "cherry", name: "Cherry", image: candleCherry, unitPrice: 2, hasPack: false },
  { id: "heart", name: "Red Heart", image: candleHeart, unitPrice: 2, hasPack: false },
  { id: "soccer", name: "Footy Flame", image: candleSoccer, unitPrice: 2, hasPack: false },
  { id: "blue-car", name: "Blue Car", image: candleBlueCar, unitPrice: 2, hasPack: false },
  { id: "red-car", name: "Red Car", image: candleRedCar, unitPrice: 2, hasPack: false },
  { id: "yellow-car", name: "Yellow Car", image: candleYellowCar, unitPrice: 2, hasPack: false },
  { id: "pink-car", name: "Pink Car", image: candlePinkCar, unitPrice: 2, hasPack: false },
  { id: "daisy", name: "Daisy", image: candleDaisy, unitPrice: 2, hasPack: false },
  { id: "ribbon", name: "Ribbon", image: candleRibbon, unitPrice: 2, hasPack: false },
  // Ombré & Spirals
  { id: "pink-ombre", name: "Pink Ombré", image: candlePinkOmbre, unitPrice: 1, hasPack: true, packPrice: 5, packSize: 6 },
  { id: "blue-ombre", name: "Blue Ombré", image: candleBlueOmbre, unitPrice: 1, hasPack: true, packPrice: 5, packSize: 6 },
  { id: "rainbow", name: "Rainbow", image: candleRainbow, unitPrice: 1, hasPack: true, packPrice: 5, packSize: 6 },
  { id: "spiral-pastel", name: "Spiral Pastel", image: candleSpiralPastel, unitPrice: 1, hasPack: true, packPrice: 5, packSize: 6 },
  { id: "shiny-spiral", name: "Shiny Spiral", image: candleShinySpiral, unitPrice: 1, hasPack: true, packPrice: 5, packSize: 6 },
  { id: "thick-spiral", name: "Thick Spiral", image: candleThickSpiral, unitPrice: 2, hasPack: true, packPrice: 10, packSize: 6 },
];

const tooltipTexts: Record<string, string> = {
  date: "Date required to schedule the preparation of your order (minimum 4 days in advance).",
  shape: "Choose the shape of your cake.",
  flavor: "Please select the flavor of your cake.",
  baseColor: "The base color is essential to personalize your cake.",
  piping: "Choose the number of piping bags you would like with your cake.",
};

const KitBentoCake = () => {
  const { addItem } = useCart();
  const navigate = useNavigate();

  const [orderDate, setOrderDate] = useState<Date | undefined>();
  const [selectedShape, setSelectedShape] = useState("");
  const [selectedFlavor, setSelectedFlavor] = useState("");
  const [selectedBaseColor, setSelectedBaseColor] = useState("");
  const [selectedPipingOption, setSelectedPipingOption] = useState("");
  const [pipingColors, setPipingColors] = useState<string[]>([]);
  const [candleSelections, setCandleSelections] = useState<{ [key: string]: number }>({});
  const [showCartSheet, setShowCartSheet] = useState(false);
  const [showAllCandles, setShowAllCandles] = useState(false);

  const minDate = addDays(new Date(), 4);

  // Refs for auto-scroll
  const shapeRef = useRef<HTMLDivElement>(null);
  const flavorRef = useRef<HTMLDivElement>(null);
  const baseColorRef = useRef<HTMLDivElement>(null);
  const pipingRef = useRef<HTMLDivElement>(null);
  const candlesRef = useRef<HTMLDivElement>(null);

  const scrollToRef = (ref: React.RefObject<HTMLDivElement>) => {
    setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
  };

  // Auto-scroll on selection
  useEffect(() => { if (orderDate) scrollToRef(shapeRef); }, [orderDate]);
  useEffect(() => { if (selectedShape) scrollToRef(flavorRef); }, [selectedShape]);
  useEffect(() => { if (selectedFlavor) scrollToRef(baseColorRef); }, [selectedFlavor]);
  useEffect(() => { if (selectedBaseColor) scrollToRef(pipingRef); }, [selectedBaseColor]);

  // Auto-scroll when piping is fully selected
  useEffect(() => {
    const option = pipingBagOptions.find(p => p.id === selectedPipingOption);
    if (option && pipingColors.length === option.count) {
      scrollToRef(candlesRef);
    }
  }, [pipingColors, selectedPipingOption]);

  // Visibility flags
  const showShape = !!orderDate;
  const showFlavor = showShape && !!selectedShape;
  const showBaseColor = showFlavor && !!selectedFlavor;
  const showPiping = showBaseColor && !!selectedBaseColor;
  const pipingComplete = (() => {
    const option = pipingBagOptions.find(p => p.id === selectedPipingOption);
    return !!selectedPipingOption && pipingColors.length === (option?.count || 0);
  })();
  const showCandles = showPiping && pipingComplete;

  const getFlavorCategoryPrice = () => {
    if (selectedFlavor === "chocolate-lover-berrylicious") return 3;
    for (const category of flavorCategories) {
      if (category.flavors.some(f => f.id === selectedFlavor)) return category.extraPrice;
    }
    return 0;
  };

  const getFlavorName = () => {
    for (const category of flavorCategories) {
      const flavor = category.flavors.find(f => f.id === selectedFlavor);
      if (flavor) return flavor.name;
    }
    return "";
  };

  const getShapePrice = () => shapes.find(s => s.id === selectedShape)?.extraPrice || 0;
  const getPipingPrice = () => pipingBagOptions.find(p => p.id === selectedPipingOption)?.price || 0;

  const getCandlePrice = (candleId: string, qty: number) => {
    const candle = candles.find(c => c.id === candleId);
    if (!candle || qty === 0) return 0;
    if (candle.hasPack && candle.packPrice && candle.packSize) {
      const packs = Math.floor(qty / candle.packSize);
      const remainder = qty % candle.packSize;
      return packs * candle.packPrice + remainder * candle.unitPrice;
    }
    return qty * candle.unitPrice;
  };

  const getCandlesTotal = () => {
    let total = 0;
    Object.entries(candleSelections).forEach(([candleId, qty]) => {
      total += getCandlePrice(candleId, qty);
    });
    return total;
  };

  const totalPrice = useMemo(() => {
    return BASE_PRICE + getShapePrice() + getFlavorCategoryPrice() + getPipingPrice() + getCandlesTotal();
  }, [selectedShape, selectedFlavor, selectedPipingOption, candleSelections]);

  const handleCandleQtyChange = (candleId: string, delta: number) => {
    setCandleSelections(prev => {
      const current = prev[candleId] || 0;
      const newQty = Math.max(0, current + delta);
      if (newQty === 0) {
        const { [candleId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [candleId]: newQty };
    });
  };

  const handlePipingColorToggle = (colorId: string) => {
    const option = pipingBagOptions.find(p => p.id === selectedPipingOption);
    const maxColors = option?.count || 0;

    setPipingColors(prev => {
      if (prev.includes(colorId)) return prev.filter(c => c !== colorId);
      if (prev.length < maxColors) return [...prev, colorId];
      return prev;
    });
  };

  const isFormComplete = () => {
    return !!orderDate && !!selectedShape && !!selectedFlavor && !!selectedBaseColor && pipingComplete;
  };

  const handleAddToCart = () => {
    if (!isFormComplete()) {
      toast.error("Please complete all required selections before proceeding.");
      return;
    }

    const pipingColorNames = pipingColors.map(id => baseColors.find(c => c.id === id)?.name || "").join(", ");
    const candleDetails = Object.entries(candleSelections)
      .filter(([_, qty]) => qty > 0)
      .map(([id, qty]) => {
        const candle = candles.find(c => c.id === id);
        return `${qty}x ${candle?.name}`;
      })
      .join("; ");

    const cartItem = {
      id: "",
      orderDate: orderDate ? format(orderDate, "yyyy-MM-dd") : "",
      orderTime: "",
      size: "kit-bento",
      sizeName: "DIY Kit",
      shape: selectedShape,
      shapeName: shapes.find(s => s.id === selectedShape)?.name || "",
      flavor: selectedFlavor,
      flavorName: getFlavorName(),
      style: "diy-kit",
      styleName: "DIY Kit",
      baseColor: selectedBaseColor,
      baseColorName: baseColors.find(c => c.id === selectedBaseColor)?.name || "",
      decorationColor: "",
      decorationColorName: "",
      cakeText: "",
      textColor: "",
      textColorName: "",
      extras: [`piping-${selectedPipingOption}`, ...Object.keys(candleSelections)],
      extrasNames: [
        `${pipingBagOptions.find(p => p.id === selectedPipingOption)?.name}: ${pipingColorNames}`,
        candleDetails
      ].filter(Boolean),
      ribbonColor: "",
      ribbonColorName: "",
      butterflyColor: "",
      butterflyColorName: "",
      candles: [],
      comment: "",
      imageUrls: [],
      imageFiles: [],
      textStyle: "normal",
      total: totalPrice,
    };

    addItem(cartItem);
    setShowCartSheet(true);
  };

  const RequiredAsterisk = ({ tooltipKey }: { tooltipKey: string }) => (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-destructive ml-1 cursor-help">*</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {tooltipTexts[tooltipKey]}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  // Candles split: packs first, then individual
  const packCandles = candles.filter(c => c.hasPack);
  const individualCandles = candles.filter(c => !c.hasPack);
  const INITIAL_CANDLES_SHOWN = 4;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-16">
        {/* Header - Catalog style */}
        <h1 className="font-serif text-4xl md:text-5xl text-center text-foreground mb-6">
          DIY KIT
        </h1>
        <p className="text-center text-muted-foreground mb-4 max-w-2xl mx-auto">
          A bento cake ready to decorate at home.
          <br />
          Choose the flavor, shape and colors to create your own bento cake.
        </p>
        <p className="text-center text-muted-foreground mb-16 max-w-2xl mx-auto text-sm">
          Starting from <span className="font-semibold text-foreground">CHF {BASE_PRICE}</span>
        </p>

        <div className="max-w-4xl mx-auto space-y-12">
          {/* Step 1: Date */}
          <section className="space-y-4">
            <h2 className="font-serif text-2xl font-semibold text-center">
              Choose Your Pickup Date<RequiredAsterisk tooltipKey="date" />
            </h2>
            <p className="text-muted-foreground text-center text-sm">Minimum 4 days notice required</p>
            <div className="flex justify-center">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-[280px] justify-start text-left font-normal rounded-none",
                      !orderDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {orderDate ? format(orderDate, "dd.MM.yyyy") : "Select a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="center">
                  <Calendar
                    mode="single"
                    selected={orderDate}
                    onSelect={setOrderDate}
                    disabled={(date) => date < minDate}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </section>

          {/* Step 2: Shape */}
          {showShape && (
            <section ref={shapeRef} className="space-y-4">
              <h2 className="font-serif text-2xl font-semibold text-center">
                Choose Shape<RequiredAsterisk tooltipKey="shape" />
              </h2>
              <RadioGroup value={selectedShape} onValueChange={setSelectedShape} className="flex justify-center gap-6">
                {shapes.map((shape) => (
                  <div key={shape.id} className="flex items-center space-x-2">
                    <RadioGroupItem value={shape.id} id={`shape-${shape.id}`} />
                    <Label htmlFor={`shape-${shape.id}`} className="cursor-pointer">
                      {shape.name} {shape.extraPrice > 0 && <span className="text-muted-foreground">(+CHF {shape.extraPrice})</span>}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </section>
          )}

          {/* Step 3: Flavor */}
          {showFlavor && (
            <section ref={flavorRef} className="space-y-6">
              <h2 className="font-serif text-2xl font-semibold text-center">
                Choose Flavor<RequiredAsterisk tooltipKey="flavor" />
              </h2>
              {flavorCategories.map((category) => (
                <div key={category.name} className="space-y-3">
                  <h3 className="text-lg font-medium">
                    {category.name}
                    {category.extraPrice > 0 && <span className="text-muted-foreground ml-2">(+CHF {category.extraPrice})</span>}
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {category.flavors.map((flavor) => (
                      <div
                        key={flavor.id}
                        className={cn(
                          "bg-card rounded-none overflow-hidden shadow-sm hover:shadow-lg transition-shadow cursor-pointer",
                          selectedFlavor === flavor.id && "ring-2 ring-primary"
                        )}
                        onClick={() => setSelectedFlavor(flavor.id)}
                      >
                        <div className="aspect-square overflow-hidden bg-muted/30 p-4">
                          <img src={flavor.image} alt={flavor.name} className="w-full h-full object-contain" />
                        </div>
                        <div className="p-3 text-center">
                          <p className="font-serif font-medium text-sm">{flavor.name}</p>
                          <AllergenDisplay flavorId={flavor.id} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* Step 4: Base Color */}
          {showBaseColor && (
            <section ref={baseColorRef} className="space-y-4">
              <h2 className="font-serif text-2xl font-semibold text-center">
                Choose Base Color<RequiredAsterisk tooltipKey="baseColor" />
              </h2>
              <div className="grid grid-cols-4 md:grid-cols-6 gap-3">
                {baseColors.map((color) => (
                  <button
                    key={color.id}
                    onClick={() => setSelectedBaseColor(color.id)}
                    className={cn(
                      "flex flex-col items-center gap-2 p-2 rounded-lg transition-all",
                      selectedBaseColor === color.id && "ring-2 ring-primary bg-secondary"
                    )}
                  >
                    <div
                      className="w-10 h-10 rounded-full border-2 border-border shadow-sm"
                      style={{ backgroundColor: color.color }}
                    />
                    <span className="text-xs text-center">{color.name}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Step 5: Piping Bags */}
          {showPiping && (
            <section ref={pipingRef} className="space-y-6">
              <div className="text-center space-y-2">
                <h2 className="font-serif text-2xl font-semibold">
                  Choose Piping Bags<RequiredAsterisk tooltipKey="piping" />
                </h2>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  The piping bag is a pastry bag filled with buttercream, used to decorate your cake.
                </p>
              </div>

              <RadioGroup value={selectedPipingOption} onValueChange={(val) => { setSelectedPipingOption(val); setPipingColors([]); }} className="flex justify-center gap-6">
                {pipingBagOptions.map((option) => (
                  <div key={option.id} className="flex items-center space-x-2">
                    <RadioGroupItem value={option.id} id={option.id} />
                    <Label htmlFor={option.id} className="cursor-pointer">
                      {option.name} <span className="text-muted-foreground">(CHF {option.price})</span>
                    </Label>
                  </div>
                ))}
              </RadioGroup>

              {selectedPipingOption && (
                <div className="space-y-3">
                  <p className="text-center text-muted-foreground">
                    Select {pipingBagOptions.find(p => p.id === selectedPipingOption)?.count} colors for your piping bags
                  </p>
                  <div className="grid grid-cols-4 md:grid-cols-6 gap-3">
                    {baseColors.map((color) => (
                      <button
                        key={color.id}
                        onClick={() => handlePipingColorToggle(color.id)}
                        className={cn(
                          "flex flex-col items-center gap-2 p-2 rounded-lg transition-all relative",
                          pipingColors.includes(color.id) && "ring-2 ring-primary bg-secondary"
                        )}
                      >
                        <div
                          className="w-10 h-10 rounded-full border-2 border-border shadow-sm relative"
                          style={{ backgroundColor: color.color }}
                        >
                          {pipingColors.includes(color.id) && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <Check className={cn("w-5 h-5", color.id === "white" || color.id === "cream" || color.id === "pastel-yellow" ? "text-foreground" : "text-white")} />
                            </div>
                          )}
                        </div>
                        <span className="text-xs text-center">{color.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Step 6: Candles (Optional) - Packs first, then individual */}
          {showCandles && (
            <section ref={candlesRef} className="space-y-8 bg-[#FFE4EC] -mx-4 px-4 py-8 rounded-2xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
              <h2 className="font-serif text-3xl font-bold text-center text-foreground">
                Add Candles (Optional)
              </h2>

              {/* Ombré & Spirals Section (Packs) - shown FIRST */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-center text-foreground/80">Ombré & Spirales (Pack de 6 disponible)</h3>
                <div className="flex flex-wrap justify-center gap-4 max-w-4xl mx-auto">
                  {packCandles.slice(0, showAllCandles ? undefined : INITIAL_CANDLES_SHOWN).map((candle) => {
                    const qty = candleSelections[candle.id] || 0;
                    const price = getCandlePrice(candle.id, qty);
                    const hasPackApplied = candle.packSize && qty >= candle.packSize;

                    return (
                      <div key={candle.id} className="flex flex-col items-center w-40 sm:w-48">
                        <img src={candle.image} alt={candle.name} className="h-56 w-56 object-contain mb-2" />
                        <Card className={cn("w-full transition-all", qty > 0 ? "ring-2 ring-primary bg-white/80" : "bg-white/60")}>
                          <CardContent className="p-2 text-center">
                            <h3 className="font-medium text-foreground text-xs mb-0.5">{candle.name}</h3>
                            <p className="text-[10px] text-muted-foreground mb-1">CHF {candle.unitPrice}/pièce · Pack {candle.packSize}: CHF {candle.packPrice}</p>
                            <div className="flex items-center justify-center gap-1.5 mb-1">
                              <button onClick={() => handleCandleQtyChange(candle.id, -1)} disabled={qty === 0}
                                className={cn("w-6 h-6 rounded-none flex items-center justify-center text-xs font-bold transition-all",
                                  qty === 0 ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-primary text-primary-foreground hover:bg-primary/90"
                                )}>−</button>
                              <span className="w-5 text-center font-medium text-foreground text-sm">{qty}</span>
                              <button onClick={() => handleCandleQtyChange(candle.id, 1)}
                                className="w-6 h-6 rounded-none bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold hover:bg-primary/90 transition-all">+</button>
                            </div>
                            {qty > 0 && (
                              <p className={cn("text-[10px] font-medium", hasPackApplied ? "text-green-700" : "text-muted-foreground")}>
                                {hasPackApplied ? `✓ Pack price applied — CHF ${price}` : `CHF ${price}`}
                              </p>
                            )}
                          </CardContent>
                        </Card>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Individual Candles Section - shown SECOND */}
              {showAllCandles && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-center text-foreground/80">Individual Candles</h3>
                  <div className="flex flex-wrap justify-center gap-4 max-w-5xl mx-auto">
                    {individualCandles.map((candle) => {
                      const qty = candleSelections[candle.id] || 0;

                      return (
                        <div key={candle.id} className="flex flex-col items-center w-40 sm:w-48">
                          <img src={candle.image} alt={candle.name} className="h-56 w-56 object-contain mb-2" />
                          <Card className={cn("w-full transition-all", qty > 0 ? "ring-2 ring-primary bg-white/80" : "bg-white/60")}>
                            <CardContent className="p-2 text-center">
                              <h3 className="font-medium text-foreground text-xs mb-0.5">{candle.name}</h3>
                              <p className="text-[10px] text-muted-foreground mb-1.5">CHF {candle.unitPrice} / pièce</p>
                              <div className="flex items-center justify-center gap-1.5">
                                <button onClick={() => handleCandleQtyChange(candle.id, -1)} disabled={qty === 0}
                                  className={cn("w-6 h-6 rounded-none flex items-center justify-center text-xs font-bold transition-all",
                                    qty === 0 ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-primary text-primary-foreground hover:bg-primary/90"
                                  )}>−</button>
                                <span className="w-5 text-center font-medium text-foreground text-sm">{qty}</span>
                                <button onClick={() => handleCandleQtyChange(candle.id, 1)}
                                  className="w-6 h-6 rounded-none bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold hover:bg-primary/90 transition-all">+</button>
                              </div>
                            </CardContent>
                          </Card>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* See more / See less toggle */}
              <button
                onClick={() => setShowAllCandles(!showAllCandles)}
                className="w-full flex items-center justify-center gap-1 text-sm text-primary font-medium py-2 hover:underline"
              >
                {showAllCandles ? (
                  <>See less <ChevronUp className="w-4 h-4" /></>
                ) : (
                  <>See more candles <ChevronDown className="w-4 h-4" /></>
                )}
              </button>
            </section>
          )}
        </div>

        {/* Fixed Bottom Bar */}
        <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-4 shadow-lg z-50">
          <div className="container mx-auto flex items-center justify-between max-w-4xl">
            <div>
              <p className="text-sm text-muted-foreground">Estimated Total</p>
              <p className="text-2xl font-bold">CHF {totalPrice}</p>
            </div>
            <Button onClick={handleAddToCart} className="gap-2" size="lg">
              <ShoppingCart className="w-4 h-4" />
              Add to Cart
            </Button>
          </div>
        </div>

        {/* Spacer for fixed bottom bar */}
        <div className="h-24" />
      </div>

      {/* Cart Confirmation Sheet */}
      <Sheet open={showCartSheet} onOpenChange={setShowCartSheet}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Your order has been added to the basket!</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <div className="bg-secondary/50 rounded-lg p-4 space-y-2">
              <p><strong>DIY Kit</strong></p>
              <p className="text-sm text-muted-foreground">Date: {orderDate ? format(orderDate, "dd.MM.yyyy") : ""}</p>
              <p className="text-sm text-muted-foreground">Shape: {shapes.find(s => s.id === selectedShape)?.name}</p>
              <p className="text-sm text-muted-foreground">Flavor: {getFlavorName()}</p>
              <p className="text-sm text-muted-foreground">Base Color: {baseColors.find(c => c.id === selectedBaseColor)?.name}</p>
              <p className="text-sm text-muted-foreground">
                Piping: {pipingBagOptions.find(p => p.id === selectedPipingOption)?.name} - {pipingColors.map(id => baseColors.find(c => c.id === id)?.name).join(", ")}
              </p>
              <p className="text-lg font-semibold mt-4">Total: CHF {totalPrice}</p>
            </div>
            <div className="flex flex-col gap-3">
              <Button onClick={() => navigate("/cart")} className="">View Basket</Button>
              <Button variant="outline" className="" onClick={() => { setShowCartSheet(false); navigate("/"); }}>
                Continue Shopping
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </Layout>
  );
};

export default KitBentoCake;
