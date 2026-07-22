import { useParams, Link } from "react-router-dom";
import { products } from "@/data/products";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ArrowLeft, ShoppingCart, MessageCircle, Upload, X } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

const ProductDetail = () => {
  const { id } = useParams();
  const { toast } = useToast();
  const product = products.find((p) => p.id === id);

  const [selectedFlavor, setSelectedFlavor] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [selectedDesign, setSelectedDesign] = useState("");
  const [uploadedImages, setUploadedImages] = useState<File[]>([]);
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; message: string }>>([]);
  const [currentMessage, setCurrentMessage] = useState("");

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

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setUploadedImages([...uploadedImages, ...newFiles]);
      toast({
        title: "Images uploaded!",
        description: `${newFiles.length} reference image(s) added`,
      });
    }
  };

  const removeImage = (index: number) => {
    setUploadedImages(uploadedImages.filter((_, i) => i !== index));
  };

  const handleSendMessage = () => {
    if (!currentMessage.trim()) return;
    
    setChatMessages([...chatMessages, { role: "user", message: currentMessage }]);
    
    // Simulate AI response
    setTimeout(() => {
      setChatMessages(prev => [...prev, { 
        role: "assistant", 
        message: "Thanks for your question! Our team will help you customize your perfect bento cake. You can add text, special decorations, or dietary requirements in the notes at checkout!" 
      }]);
    }, 1000);
    
    setCurrentMessage("");
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

            <div className="text-3xl font-bold text-primary">CHF {currentPrice}</div>

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
                          <span className="font-semibold">CHF {size.price}</span>
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

            {/* Picture Upload */}
            <Card>
              <CardContent className="pt-6">
                <Label className="text-base font-semibold mb-3 block">
                  Upload Reference Images
                </Label>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleImageUpload}
                      className="flex-1"
                    />
                    <Upload className="h-5 w-5 text-muted-foreground" />
                  </div>
                  {uploadedImages.length > 0 && (
                    <div className="grid grid-cols-3 gap-2">
                      {uploadedImages.map((file, index) => (
                        <div key={index} className="relative group">
                          <img
                            src={URL.createObjectURL(file)}
                            alt={`Reference ${index + 1}`}
                            className="w-full h-20 object-cover rounded-md border border-border"
                          />
                          <button
                            onClick={() => removeImage(index)}
                            className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Upload reference images for your custom design
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-3">
              <Button size="lg" className="flex-1" onClick={handleAddToCart}>
                <ShoppingCart className="mr-2 h-5 w-5" />
                Add to Cart - CHF {currentPrice}
              </Button>
              
              {/* Chatbot */}
              <Dialog>
                <DialogTrigger asChild>
                  <Button size="lg" variant="outline">
                    <MessageCircle className="h-5 w-5" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Customization Help</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="h-64 overflow-y-auto space-y-3 p-4 bg-muted rounded-lg">
                      {chatMessages.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center">
                          Ask us anything about customizing your cake!
                        </p>
                      ) : (
                        chatMessages.map((msg, idx) => (
                          <div
                            key={idx}
                            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                          >
                            <div
                              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                                msg.role === "user"
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-background text-foreground"
                              }`}
                            >
                              {msg.message}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Textarea
                        placeholder="Ask about flavors, designs, or special requests..."
                        value={currentMessage}
                        onChange={(e) => setCurrentMessage(e.target.value)}
                        onKeyPress={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
                        className="min-h-[60px]"
                      />
                      <Button onClick={handleSendMessage} size="icon">
                        <MessageCircle className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductDetail;
