import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetClose } from "@/components/ui/sheet";
import { ArrowLeft, ArrowRight, Check, ShoppingBag, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCart } from "@/context/CartContext";
import Layout from "@/components/Layout";
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
import flavorVanillaGF from "@/assets/flavor-vanilla-gf.png";
import flavorRedVelvetGF from "@/assets/flavor-red-velvet-gf.png";
import flavorChocolateGF from "@/assets/flavor-chocolate-gf.png";

const steps = ["Size", "Shape", "Flavor", "Style", "Extras"];

const sizes = [
  { id: "bento", name: "Bento", description: "Perfect for up to 4 people", price: 45 },
  { id: "medium", name: "Medium", description: "Great for up to 8 people", price: 65 },
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
  { id: "retro-vintage", name: "Retro / Vintage" },
  { id: "heart-bomb", name: "Heart Bomb" },
  { id: "shag-cake", name: "Shag Cake" },
  { id: "rainbow-cake", name: "Rainbow Cake" },
  { id: "roses-please", name: "Roses Please" },
  { id: "butterfly-garden", name: "Butterfly Garden" },
  { id: "custom-drawing", name: "Custom Drawing" },
  { id: "printed-picture", name: "Printed Picture" },
  { id: "gold-leaves", name: "Gold Leaves" },
  { id: "glitter-cake", name: "Glitter Cake" },
  { id: "glitter-in-the-air", name: "Glitter in the Air Cake" },
  { id: "gender-reveal", name: "Gender Reveal" },
];

const extras = [
  { id: "sprinkles", name: "Sprinkles", price: 3 },
  { id: "fresh-fruit", name: "Fresh Fruit", price: 5 },
  { id: "gold-leaf", name: "Gold Leaf", price: 8 },
  { id: "custom-message", name: "Custom Message", price: 4 },
  { id: "candles", name: "Candles", price: 2 },
  { id: "macarons", name: "Macarons", price: 6 },
];

const Customize = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { addItem } = useCart();
  const [currentStep, setCurrentStep] = useState(0);
  const [selections, setSelections] = useState<{
    size: string | null;
    shape: string | null;
    flavor: string | null;
    style: string | null;
    extras: string[];
  }>({
    size: null,
    shape: null,
    flavor: null,
    style: null,
    extras: [],
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

  const handleToggleExtra = (extraId: string) => {
    const newExtras = selections.extras.includes(extraId)
      ? selections.extras.filter((e) => e !== extraId)
      : [...selections.extras, extraId];
    setSelections({ ...selections, extras: newExtras });
  };

  const canProceed = () => {
    switch (currentStep) {
      case 0:
        return selections.size !== null;
      case 1:
        return selections.shape !== null;
      case 2:
        return selections.flavor !== null;
      case 3:
        return selections.style !== null;
      case 4:
        return true;
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

  const calculateTotal = () => {
    const sizePrice = sizes.find((s) => s.id === selections.size)?.price || 0;
    const extrasPrice = selections.extras.reduce((acc, extraId) => {
      const extra = extras.find((e) => e.id === extraId);
      return acc + (extra?.price || 0);
    }, 0);
    const selectedShape = shapes.find((s) => s.id === selections.shape);
    const shapeExtra = selectedShape && selections.size 
      ? selectedShape.extraPrice[selections.size as keyof typeof selectedShape.extraPrice] || 0
      : 0;
    const flavorExtra = getFlavorCategoryExtra();
    return sizePrice + extrasPrice + shapeExtra + flavorExtra;
  };

  const handleAddToCart = () => {
    const size = sizes.find(s => s.id === selections.size);
    const shape = shapes.find(s => s.id === selections.shape);
    const flavor = flavorCategories.flatMap(c => c.flavors).find(f => f.id === selections.flavor);
    const style = styles.find(s => s.id === selections.style);
    const extrasNames = selections.extras.map(id => extras.find(e => e.id === id)?.name || "");
    
    addItem({
      id: "",
      size: selections.size || "",
      sizeName: size?.name || "",
      shape: selections.shape || "",
      shapeName: shape?.name || "",
      flavor: selections.flavor || "",
      flavorName: flavor?.name || "",
      style: selections.style || "",
      styleName: style?.name || "",
      extras: selections.extras,
      extrasNames,
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
          {/* Size Selection */}
          {currentStep === 0 && (
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
          {currentStep === 1 && (
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
          {currentStep === 2 && (
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
          {currentStep === 3 && (
            <div className="space-y-6">
              <h2 className="text-3xl font-bold text-center text-foreground">
                Choose Your Style
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {styles.map((style) => (
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
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Extras Selection */}
          {currentStep === 4 && (
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
                      <p className="text-primary font-bold mt-1">+CHF {extra.price}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
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

            <div className="text-center">
              <p className="text-sm text-muted-foreground">Estimated Total</p>
              <p className="text-2xl font-bold text-primary">CHF {calculateTotal()}</p>
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
              <p className="text-sm text-muted-foreground">
                Flavor: {flavorCategories.flatMap(c => c.flavors).find(f => f.id === selections.flavor)?.name}
              </p>
              <p className="text-sm text-muted-foreground">
                Style: {styles.find(s => s.id === selections.style)?.name}
              </p>
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
