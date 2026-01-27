import { useState, useMemo } from "react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { format, addDays } from "date-fns";
import { CalendarIcon, ChevronRight, Check, Minus, Plus, ShoppingCart } from "lucide-react";
import { useCart } from "@/context/CartContext";
import { useNavigate } from "react-router-dom";

// Flavor images
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
import flavorVanillaGF from "@/assets/flavor-vanilla-gf.png";
import flavorRedVelvetGF from "@/assets/flavor-red-velvet-gf.png";
import flavorChocolateGF from "@/assets/flavor-chocolate-gf.png";

// Candle images
import candlePuppy from "@/assets/candle-puppy.png";
import candleTeddyBear from "@/assets/candle-teddy-bear.png";
import candleCherry from "@/assets/candle-cherry.png";
import candleHeart from "@/assets/candle-heart.png";
import candleSoccer from "@/assets/candle-soccer.png";
import candleBlueCar from "@/assets/candle-blue-car.png";
import candleRedCar from "@/assets/candle-red-car.png";
import candleYellowCar from "@/assets/candle-yellow-car.png";
import candleBlueOmbre from "@/assets/candle-blue-ombre.png";
import candlePinkOmbre from "@/assets/candle-pink-ombre.png";
import candleSpiralPastel from "@/assets/candle-spiral-pastel.png";
import candleShinySpiral from "@/assets/candle-shiny-spiral.png";
import candleThickSpiral from "@/assets/candle-thick-spiral.png";

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
      { id: "dark-berrylicious", name: "Dark Berrylicious", description: "Fluffy chocolate sponge filled with a generous raspberry coulis and whipped cream", image: flavorDarkBerrylicious },
      { id: "white-berrylicious", name: "White Berrylicious", description: "Fluffy vanilla sponge filled with a generous raspberry coulis and whipped cream", image: flavorWhiteBerrylicious },
      { id: "salted-caramel", name: "Salted Butter Caramel", description: "Fluffy vanilla sponge filled with caramel and whipped cream", image: flavorSaltedCaramel },
      { id: "lemon-curd", name: "Lemon Curd", description: "Fluffy vanilla sponge filled with lemon curd and whipped cream", image: flavorLemonCurd },
    ],
  },
  {
    name: "Deluxe Flavors",
    extraPrice: 4,
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
  { id: "puppy", name: "Puppy", image: candlePuppy, unitPrice: 2, hasPack: false },
  { id: "teddy-bear", name: "Teddy Bear", image: candleTeddyBear, unitPrice: 2, hasPack: false },
  { id: "cherry", name: "Cherry", image: candleCherry, unitPrice: 2, hasPack: false },
  { id: "heart", name: "Red Heart", image: candleHeart, unitPrice: 2, hasPack: false },
  { id: "soccer", name: "Soccer Ball", image: candleSoccer, unitPrice: 2, hasPack: false },
  { id: "blue-car", name: "Blue Car", image: candleBlueCar, unitPrice: 2, hasPack: false },
  { id: "red-car", name: "Red Car", image: candleRedCar, unitPrice: 2, hasPack: false },
  { id: "yellow-car", name: "Yellow Car", image: candleYellowCar, unitPrice: 2, hasPack: false },
  { id: "blue-ombre", name: "Blue Ombré", image: candleBlueOmbre, unitPrice: 1, hasPack: true, packPrice: 5, packSize: 6 },
  { id: "pink-ombre", name: "Pink Ombré", image: candlePinkOmbre, unitPrice: 1, hasPack: true, packPrice: 5, packSize: 6 },
  { id: "spiral-pastel", name: "Spiral Pastel", image: candleSpiralPastel, unitPrice: 1, hasPack: true, packPrice: 10, packSize: 12 },
  { id: "shiny-spiral", name: "Shiny Spiral", image: candleShinySpiral, unitPrice: 1, hasPack: true, packPrice: 10, packSize: 12 },
  { id: "thick-spiral", name: "Thick Spiral", image: candleThickSpiral, unitPrice: 1, hasPack: true, packPrice: 10, packSize: 12 },
];

type Step = "date" | "shape" | "flavor" | "baseColor" | "pipingBags" | "candles";

const steps: { id: Step; label: string }[] = [
  { id: "date", label: "Date" },
  { id: "shape", label: "Shape" },
  { id: "flavor", label: "Flavor" },
  { id: "baseColor", label: "Base Color" },
  { id: "pipingBags", label: "Piping Bags" },
  { id: "candles", label: "Candles" },
];

const KitBentoCake = () => {
  const { addItem } = useCart();
  const navigate = useNavigate();
  
  const [currentStep, setCurrentStep] = useState<Step>("date");
  const [orderDate, setOrderDate] = useState<Date | undefined>();
  const [selectedShape, setSelectedShape] = useState("");
  const [selectedFlavor, setSelectedFlavor] = useState("");
  const [selectedBaseColor, setSelectedBaseColor] = useState("");
  const [selectedPipingOption, setSelectedPipingOption] = useState("");
  const [pipingColors, setPipingColors] = useState<string[]>([]);
  const [candleSelections, setCandleSelections] = useState<{ [key: string]: { units: number; packs: number } }>({});
  const [showCartSheet, setShowCartSheet] = useState(false);

  const minDate = addDays(new Date(), 2);

  const getFlavorCategoryPrice = () => {
    for (const category of flavorCategories) {
      if (category.flavors.some(f => f.id === selectedFlavor)) {
        return category.extraPrice;
      }
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

  const getShapePrice = () => {
    return shapes.find(s => s.id === selectedShape)?.extraPrice || 0;
  };

  const getPipingPrice = () => {
    return pipingBagOptions.find(p => p.id === selectedPipingOption)?.price || 0;
  };

  const getCandlesTotal = () => {
    let total = 0;
    Object.entries(candleSelections).forEach(([candleId, selection]) => {
      const candle = candles.find(c => c.id === candleId);
      if (candle) {
        total += selection.units * candle.unitPrice;
        if (candle.hasPack && candle.packPrice) {
          total += selection.packs * candle.packPrice;
        }
      }
    });
    return total;
  };

  const totalPrice = useMemo(() => {
    return BASE_PRICE + getShapePrice() + getFlavorCategoryPrice() + getPipingPrice() + getCandlesTotal();
  }, [selectedShape, selectedFlavor, selectedPipingOption, candleSelections]);

  const canProceed = () => {
    switch (currentStep) {
      case "date": return !!orderDate;
      case "shape": return !!selectedShape;
      case "flavor": return !!selectedFlavor;
      case "baseColor": return !!selectedBaseColor;
      case "pipingBags": {
        const option = pipingBagOptions.find(p => p.id === selectedPipingOption);
        return !!selectedPipingOption && pipingColors.length === (option?.count || 0);
      }
      case "candles": return true;
      default: return false;
    }
  };

  const goToNextStep = () => {
    const currentIndex = steps.findIndex(s => s.id === currentStep);
    if (currentIndex < steps.length - 1) {
      setCurrentStep(steps[currentIndex + 1].id);
    }
  };

  const goToPrevStep = () => {
    const currentIndex = steps.findIndex(s => s.id === currentStep);
    if (currentIndex > 0) {
      setCurrentStep(steps[currentIndex - 1].id);
    }
  };

  const handleCandleUnitChange = (candleId: string, delta: number) => {
    setCandleSelections(prev => {
      const current = prev[candleId] || { units: 0, packs: 0 };
      const newUnits = Math.max(0, current.units + delta);
      if (newUnits === 0 && current.packs === 0) {
        const { [candleId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [candleId]: { ...current, units: newUnits } };
    });
  };

  const handleCandlePackChange = (candleId: string, delta: number) => {
    setCandleSelections(prev => {
      const current = prev[candleId] || { units: 0, packs: 0 };
      const newPacks = Math.max(0, current.packs + delta);
      if (newPacks === 0 && current.units === 0) {
        const { [candleId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [candleId]: { ...current, packs: newPacks } };
    });
  };

  const handlePipingColorToggle = (colorId: string) => {
    const option = pipingBagOptions.find(p => p.id === selectedPipingOption);
    const maxColors = option?.count || 0;
    
    setPipingColors(prev => {
      if (prev.includes(colorId)) {
        return prev.filter(c => c !== colorId);
      }
      if (prev.length < maxColors) {
        return [...prev, colorId];
      }
      return prev;
    });
  };

  const handleAddToCart = () => {
    const pipingColorNames = pipingColors.map(id => baseColors.find(c => c.id === id)?.name || "").join(", ");
    const candleDetails = Object.entries(candleSelections)
      .filter(([_, sel]) => sel.units > 0 || sel.packs > 0)
      .map(([id, sel]) => {
        const candle = candles.find(c => c.id === id);
        const parts = [];
        if (sel.units > 0) parts.push(`${sel.units}x ${candle?.name}`);
        if (sel.packs > 0) parts.push(`${sel.packs} pack(s) ${candle?.name}`);
        return parts.join(", ");
      })
      .join("; ");

    const cartItem = {
      id: "",
      orderDate: orderDate ? format(orderDate, "PPP") : "",
      size: "kit-bento",
      sizeName: "Kit Bento Cake",
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
      total: totalPrice,
    };

    addItem(cartItem);
    setShowCartSheet(true);
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case "date":
        return (
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold text-center">Choose Your Pickup Date</h2>
            <p className="text-muted-foreground text-center">Minimum 2 days notice required</p>
            <div className="flex justify-center">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-[280px] justify-start text-left font-normal",
                      !orderDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {orderDate ? format(orderDate, "PPP") : "Select a date"}
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
          </div>
        );

      case "shape":
        return (
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold text-center">Choose Shape</h2>
            <RadioGroup value={selectedShape} onValueChange={setSelectedShape} className="flex justify-center gap-6">
              {shapes.map((shape) => (
                <div key={shape.id} className="flex items-center space-x-2">
                  <RadioGroupItem value={shape.id} id={shape.id} />
                  <Label htmlFor={shape.id} className="cursor-pointer">
                    {shape.name} {shape.extraPrice > 0 && <span className="text-muted-foreground">(+CHF {shape.extraPrice})</span>}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
        );

      case "flavor":
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-center">Choose Flavor</h2>
            {flavorCategories.map((category) => (
              <div key={category.name} className="space-y-3">
                <h3 className="text-lg font-medium">
                  {category.name}
                  {category.extraPrice > 0 && <span className="text-muted-foreground ml-2">(+CHF {category.extraPrice})</span>}
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {category.flavors.map((flavor) => (
                    <Card
                      key={flavor.id}
                      className={cn(
                        "cursor-pointer transition-all hover:shadow-md",
                        selectedFlavor === flavor.id && "ring-2 ring-primary"
                      )}
                      onClick={() => setSelectedFlavor(flavor.id)}
                    >
                      <CardContent className="p-3">
                        <img src={flavor.image} alt={flavor.name} className="w-full h-24 object-contain mb-2" />
                        <p className="font-medium text-sm text-center">{flavor.name}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );

      case "baseColor":
        return (
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold text-center">Choose Base Color</h2>
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
          </div>
        );

      case "pipingBags":
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-center">Choose Piping Bags</h2>
            
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
          </div>
        );

      case "candles":
        return (
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold text-center">Add Candles (Optional)</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {candles.map((candle) => {
                const selection = candleSelections[candle.id] || { units: 0, packs: 0 };
                return (
                  <Card key={candle.id} className="overflow-hidden">
                    <CardContent className="p-3">
                      <img src={candle.image} alt={candle.name} className="w-full h-20 object-contain mb-2" />
                      <p className="font-medium text-sm text-center mb-2">{candle.name}</p>
                      
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs">Unit (CHF {candle.unitPrice})</span>
                          <div className="flex items-center gap-2">
                            <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => handleCandleUnitChange(candle.id, -1)}>
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="w-6 text-center text-sm">{selection.units}</span>
                            <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => handleCandleUnitChange(candle.id, 1)}>
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                        
                        {candle.hasPack && (
                          <div className="flex items-center justify-between">
                            <span className="text-xs">Pack of {candle.packSize} (CHF {candle.packPrice})</span>
                            <div className="flex items-center gap-2">
                              <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => handleCandlePackChange(candle.id, -1)}>
                                <Minus className="h-3 w-3" />
                              </Button>
                              <span className="w-6 text-center text-sm">{selection.packs}</span>
                              <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => handleCandlePackChange(candle.id, 1)}>
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-4">Kit Bento Cake</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            A bento cake ready to decorate at home.
            <br />
            Choose the flavor, shape, base color and the colors for the piping bags that represent you!
          </p>
        </div>

        {/* Progress Steps */}
        <div className="flex justify-center mb-8 overflow-x-auto pb-2">
          <div className="flex items-center gap-2">
            {steps.map((step, index) => (
              <div key={step.id} className="flex items-center">
                <button
                  onClick={() => setCurrentStep(step.id)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-sm font-medium transition-all",
                    currentStep === step.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  )}
                >
                  {step.label}
                </button>
                {index < steps.length - 1 && <ChevronRight className="w-4 h-4 text-muted-foreground mx-1" />}
              </div>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <div className="max-w-4xl mx-auto mb-8">
          {renderStepContent()}
        </div>

        {/* Price Summary & Navigation */}
        <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-4 shadow-lg">
          <div className="container mx-auto flex items-center justify-between max-w-4xl">
            <div>
              <p className="text-sm text-muted-foreground">Estimated Total</p>
              <p className="text-2xl font-bold">CHF {totalPrice}</p>
            </div>
            <div className="flex gap-3">
              {currentStep !== "date" && (
                <Button variant="outline" onClick={goToPrevStep}>
                  Back
                </Button>
              )}
              {currentStep !== "candles" ? (
                <Button onClick={goToNextStep} disabled={!canProceed()}>
                  Next
                </Button>
              ) : (
                <Button onClick={handleAddToCart} className="gap-2">
                  <ShoppingCart className="w-4 h-4" />
                  Add to Cart
                </Button>
              )}
            </div>
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
              <p><strong>Kit Bento Cake</strong></p>
              <p className="text-sm text-muted-foreground">Date: {orderDate ? format(orderDate, "PPP") : ""}</p>
              <p className="text-sm text-muted-foreground">Shape: {shapes.find(s => s.id === selectedShape)?.name}</p>
              <p className="text-sm text-muted-foreground">Flavor: {getFlavorName()}</p>
              <p className="text-sm text-muted-foreground">Base Color: {baseColors.find(c => c.id === selectedBaseColor)?.name}</p>
              <p className="text-sm text-muted-foreground">
                Piping: {pipingBagOptions.find(p => p.id === selectedPipingOption)?.name} - {pipingColors.map(id => baseColors.find(c => c.id === id)?.name).join(", ")}
              </p>
              <p className="text-lg font-semibold mt-4">Total: CHF {totalPrice}</p>
            </div>
            <div className="flex flex-col gap-3">
              <Button onClick={() => navigate("/cart")}>View Basket</Button>
              <Button variant="outline" onClick={() => { setShowCartSheet(false); navigate("/"); }}>
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
