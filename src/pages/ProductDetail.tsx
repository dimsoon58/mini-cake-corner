import { useParams, Link } from "react-router-dom";
import { products } from "@/data/products";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ArrowLeft, ShoppingCart } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

const ProductDetail = () => {
  const { id } = useParams();
  const { toast } = useToast();
  const product = products.find((p) => p.id === id);

  const [selectedFlavor, setSelectedFlavor] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [selectedDesign, setSelectedDesign] = useState("");

  if (!product) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Product not found</h2>
          <Link to="/">
            <Button>Back to Home</Button>
          </Link>
        </div>
      </div>
    );
  }

  const handleAddToCart = () => {
    if (!selectedFlavor || !selectedSize || !selectedDesign) {
      toast({
        title: "Please complete your selection",
        description: "Choose flavor, size, and design before adding to cart",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Added to cart! 🎉",
      description: `${product.name} - ${selectedFlavor}, ${selectedSize}`,
    });
  };

  const currentPrice =
    product.sizes.find((s) => s.name === selectedSize)?.price || product.price;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="text-2xl">🍰</div>
            <h1 className="text-2xl font-bold text-foreground">Sweet Bento</h1>
          </Link>
          <Button variant="outline" size="icon">
            <ShoppingCart className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="h-4 w-4" />
          Back to Shop
        </Link>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Product Image */}
          <div className="space-y-4">
            <div className="aspect-square overflow-hidden rounded-lg border border-border">
              <img
                src={product.image}
                alt={product.name}
                className="w-full h-full object-cover"
              />
            </div>
          </div>

          {/* Product Info */}
          <div className="space-y-6">
            <div>
              <span className="text-sm font-medium text-muted-foreground bg-secondary px-3 py-1 rounded-full">
                {product.category}
              </span>
              <h1 className="text-4xl font-bold text-foreground mt-4 mb-2">
                {product.name}
              </h1>
              <p className="text-lg text-muted-foreground">{product.description}</p>
            </div>

            <div className="text-3xl font-bold text-primary">${currentPrice}</div>

            {/* Flavor Selection */}
            <Card>
              <CardContent className="pt-6">
                <Label className="text-base font-semibold mb-3 block">
                  Choose Flavor
                </Label>
                <RadioGroup value={selectedFlavor} onValueChange={setSelectedFlavor}>
                  <div className="space-y-2">
                    {product.flavors.map((flavor) => (
                      <div key={flavor} className="flex items-center space-x-2">
                        <RadioGroupItem value={flavor} id={`flavor-${flavor}`} />
                        <Label
                          htmlFor={`flavor-${flavor}`}
                          className="cursor-pointer flex-1"
                        >
                          {flavor}
                        </Label>
                      </div>
                    ))}
                  </div>
                </RadioGroup>
              </CardContent>
            </Card>

            {/* Size Selection */}
            <Card>
              <CardContent className="pt-6">
                <Label className="text-base font-semibold mb-3 block">
                  Choose Size
                </Label>
                <RadioGroup value={selectedSize} onValueChange={setSelectedSize}>
                  <div className="space-y-2">
                    {product.sizes.map((size) => (
                      <div key={size.name} className="flex items-center space-x-2">
                        <RadioGroupItem value={size.name} id={`size-${size.name}`} />
                        <Label
                          htmlFor={`size-${size.name}`}
                          className="cursor-pointer flex-1 flex justify-between"
                        >
                          <span>{size.name}</span>
                          <span className="font-semibold">${size.price}</span>
                        </Label>
                      </div>
                    ))}
                  </div>
                </RadioGroup>
              </CardContent>
            </Card>

            {/* Design Selection */}
            <Card>
              <CardContent className="pt-6">
                <Label className="text-base font-semibold mb-3 block">
                  Choose Design
                </Label>
                <RadioGroup value={selectedDesign} onValueChange={setSelectedDesign}>
                  <div className="grid grid-cols-2 gap-3">
                    {product.designs.map((design) => (
                      <div key={design.name} className="relative">
                        <RadioGroupItem
                          value={design.name}
                          id={`design-${design.name}`}
                          className="peer sr-only"
                        />
                        <Label
                          htmlFor={`design-${design.name}`}
                          className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-muted bg-card p-4 hover:bg-accent cursor-pointer peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-accent"
                        >
                          <span className="text-3xl">{design.image}</span>
                          <span className="text-sm font-medium">{design.name}</span>
                        </Label>
                      </div>
                    ))}
                  </div>
                </RadioGroup>
              </CardContent>
            </Card>

            <Button size="lg" className="w-full" onClick={handleAddToCart}>
              <ShoppingCart className="mr-2 h-5 w-5" />
              Add to Cart - ${currentPrice}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductDetail;
