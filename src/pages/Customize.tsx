import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const steps = ["Size", "Shape", "Flavor", "Extras"];

const sizes = [
  { id: "bento", name: "Bento", description: "Perfect for up to 4 people", price: 28 },
  { id: "medium", name: "Medium", description: "Great for up to 8 people", price: 42 },
  { id: "large", name: "Large", description: "Ideal for up to 16 people", price: 58 },
];

const shapes = [
  { id: "round", name: "Round", emoji: "🔴" },
  { id: "square", name: "Square", emoji: "🟦" },
  { id: "heart", name: "Heart", emoji: "💗" },
  { id: "rectangle", name: "Rectangle", emoji: "📦" },
];

const flavors = [
  { id: "vanilla", name: "Vanilla", color: "bg-cream" },
  { id: "chocolate", name: "Chocolate", color: "bg-[hsl(30,50%,35%)]" },
  { id: "strawberry", name: "Strawberry", color: "bg-peach" },
  { id: "matcha", name: "Matcha", color: "bg-mint" },
  { id: "lavender", name: "Lavender", color: "bg-lavender" },
  { id: "red-velvet", name: "Red Velvet", color: "bg-destructive" },
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
  const [currentStep, setCurrentStep] = useState(0);
  const [selections, setSelections] = useState<{
    size: string | null;
    shape: string | null;
    flavor: string | null;
    extras: string[];
  }>({
    size: null,
    shape: null,
    flavor: null,
    extras: [],
  });

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
        return true;
      default:
        return false;
    }
  };

  const calculateTotal = () => {
    const sizePrice = sizes.find((s) => s.id === selections.size)?.price || 0;
    const extrasPrice = selections.extras.reduce((acc, extraId) => {
      const extra = extras.find((e) => e.id === extraId);
      return acc + (extra?.price || 0);
    }, 0);
    return sizePrice + extrasPrice;
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="text-2xl">🍰</div>
            <h1 className="text-2xl font-bold text-foreground">Sweet Bento</h1>
          </Link>
          <Button variant="ghost" asChild>
            <Link to="/">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Shop
            </Link>
          </Button>
        </div>
      </header>

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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                        ${size.price}
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
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {shapes.map((shape) => (
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
                      <div className="text-5xl mb-3">{shape.emoji}</div>
                      <h3 className="text-xl font-bold text-foreground">{shape.name}</h3>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Flavor Selection */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <h2 className="text-3xl font-bold text-center text-foreground">
                Choose Your Flavor
              </h2>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                {flavors.map((flavor) => (
                  <Card
                    key={flavor.id}
                    className={cn(
                      "cursor-pointer transition-all hover:shadow-lg",
                      selections.flavor === flavor.id
                        ? "ring-2 ring-primary bg-secondary"
                        : "hover:bg-muted/50"
                    )}
                    onClick={() => handleSelectFlavor(flavor.id)}
                  >
                    <CardContent className="p-6 flex items-center gap-4">
                      <div
                        className={cn("w-12 h-12 rounded-full", flavor.color)}
                      />
                      <h3 className="text-xl font-bold text-foreground">
                        {flavor.name}
                      </h3>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Extras Selection */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <h2 className="text-3xl font-bold text-center text-foreground">
                Add Extras
              </h2>
              <p className="text-center text-muted-foreground">
                Optional — select as many as you like!
              </p>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
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
                    <CardContent className="p-6 flex items-center justify-between">
                      <h3 className="text-lg font-medium text-foreground">
                        {extra.name}
                      </h3>
                      <span className="text-primary font-bold">+${extra.price}</span>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Navigation & Summary */}
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-border pt-6">
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
              <p className="text-3xl font-bold text-primary">${calculateTotal()}</p>
            </div>

            {currentStep < steps.length - 1 ? (
              <Button onClick={handleNext} disabled={!canProceed()}>
                Next
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <Button onClick={() => navigate("/")} disabled={!canProceed()}>
                Add to Cart
                <Check className="h-4 w-4 ml-2" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Customize;
