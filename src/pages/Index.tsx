import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShoppingBag, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import Layout from "@/components/Layout";
import { useCart } from "@/context/CartContext";
import logo from "@/assets/logo.png";
import heroBg from "@/assets/hero-bg.jpg";
import cakeHomemade from "@/assets/cake-homemade.png";
import cakeFresh from "@/assets/cake-fresh.png";
import cakeTrendy from "@/assets/cake-trendy.png";
import cakeMiniBento from "@/assets/cake-mini-bento.png";
import catalogRetroVintage from "@/assets/design-retro-cake-new.jpg";
import catalogRainbow from "@/assets/design-rainbow-cake-new.jpg";
import catalogShagCake from "@/assets/design-shag-cake-new.jpg";
import catalogGoldLeaves from "@/assets/design-gold-leaves-new.png";
import catalogScatteredPearls from "@/assets/design-scattered-pearls-new.jpg";
import catalogPearlBorders from "@/assets/design-pearl-borders-new.jpg";
import styleNormalWithBorder from "@/assets/style-normal-with-border.jpg";
import styleNormalWithoutBorder from "@/assets/style-normal-without-border.jpg";
import customer1 from "@/assets/customer-1.jpg";
import customer2 from "@/assets/customer-2.jpg";
import customer3 from "@/assets/customer-3.jpg";
import customer4 from "@/assets/customer-4.jpg";
import customer5 from "@/assets/customer-5.jpg";
import customer6 from "@/assets/customer-6.jpg";
import customer7 from "@/assets/customer-7.jpg";
import customer8 from "@/assets/customer-8.jpg";
import customer9 from "@/assets/customer-9.jpg";
import customer10 from "@/assets/customer-10.jpg";
import customer11 from "@/assets/customer-11.jpg";
import customer12 from "@/assets/customer-12.jpg";
import customer13 from "@/assets/customer-13.jpg";
import customer14 from "@/assets/customer-14.jpg";
import customer15 from "@/assets/customer-15.jpg";
import customer16 from "@/assets/customer-16.jpg";
import customer17 from "@/assets/customer-17.jpg";
import customer18 from "@/assets/customer-18.jpg";
import customer19 from "@/assets/customer-19.jpg";
import customer20 from "@/assets/customer-20.jpg";
import customer21 from "@/assets/customer-21.jpg";
import customer22 from "@/assets/customer-22.jpg";
import customer23 from "@/assets/customer-23.jpg";
import customer24 from "@/assets/customer-24.jpg";
import customer25 from "@/assets/customer-25.jpg";

const customerPhotos = [
  customer1, customer2, customer3, customer4, customer5,
  customer6, customer7, customer8, customer9, customer10,
  customer11, customer12, customer13, customer14, customer15,
  customer16, customer17, customer18, customer19, customer20,
  customer21, customer22, customer23, customer24, customer25,
];

const features = [
  {
    title: "Homemade goodness",
    description:
      "When you think of warmth, love, and comfort in a bite, think homemade. Our cakes are all about that authentic taste, paired with a cheeky wink.",
    image: cakeHomemade,
  },
  {
    title: "Trendy & personalized",
    description:
      "It's modern, it's unique and it's trendy. Ditch that regular cake and get a personalized piece of art, made with love and passion just for you.",
    image: cakeTrendy,
  },
  {
    title: "Fresh ingredients",
    description:
      "Because we believe that our cakes should be fresh, nutritious and prepared with care, we only use natural & fresh ingredients with no preservatives.",
    image: cakeFresh,
  },
];

import sizeBento from "@/assets/size-bento.png";
import sizeMediumHeart from "@/assets/size-medium-heart.png";
import sizeLargeRound from "@/assets/size-large-round.png";

const homeSizes = [
  {
    name: "Mini Bento Cake",
    size: "10 cm",
    servings: "2-4 servings",
    price: "From CHF 40",
    extra: "+CHF 3 Heart shape",
    image: sizeBento,
  },
  {
    name: "Medium Cake",
    size: "15 cm",
    servings: "5-8 servings",
    price: "From CHF 80",
    extra: "+CHF 5 Heart shape",
    image: sizeMediumHeart,
  },
  {
    name: "Large Cake",
    size: "20 cm",
    servings: "12-16 servings",
    price: "From CHF 160",
    extra: "+CHF 10 Heart shape",
    image: sizeLargeRound,
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

const catalog = [
  {
    id: "normal-without-border",
    name: "Normal without Border",
    description: "Clean and simple smooth finish",
    image: styleNormalWithoutBorder,
    styleId: "normal-without-border",
    styleName: "Normal without border",
    stylePrice: { bento: 0, retro: 0, medium: 0, large: 0 },
    disableText: false,
  },
  {
    id: "normal-with-border",
    name: "Normal with Border",
    description: "Classic cake with elegant piped border",
    image: styleNormalWithBorder,
    styleId: "normal-with-border",
    styleName: "Normal with border",
    stylePrice: { bento: 0, retro: 3, medium: 80, large: 170 },
    disableText: false,
  },
  {
    id: "retro-cake",
    name: "Retro Cake",
    description: "Vintage style with elegant decorations",
    image: catalogRetroVintage,
    styleId: "retro-vintage",
    styleName: "Retro / Vintage",
    stylePrice: { bento: 5, medium: 15, large: 20 },
    disableText: false,
  },
  {
    id: "rainbow-cake",
    name: "Rainbow Cake",
    description: "A fun retro-style cake with pastel rainbows, sprinkles, and piped borders",
    image: catalogRainbow,
    styleId: "rainbow-cake",
    styleName: "Rainbow Cake",
    stylePrice: { bento: 7, medium: 17, large: 30 },
    disableText: false,
  },
  {
    id: "shag-cake",
    name: "Shag Cake",
    description: "A retro inspired shag cake with rich texture and colorful details",
    image: catalogShagCake,
    styleId: "shag-cake",
    styleName: "Shag Cake",
    stylePrice: { bento: 8, medium: 20, large: 30 },
    disableText: false,
  },
  {
    id: "gold-leaves",
    name: "Gold Leaves",
    description: "Elegant cake with gold leaf border",
    image: catalogGoldLeaves,
    styleId: "gold-leaves-style",
    styleName: "Gold Leaves",
    stylePrice: { bento: 2, retro: 3, medium: 5, large: 8 },
    disableText: false,
  },
  {
    id: "scattered-retro-pearls",
    name: "Scattered Retro Pearls",
    description: "Delicate pearls scattered across the cake, with a pearl border and retro decoration",
    image: catalogScatteredPearls,
    styleId: "scattered-retro-pearls",
    styleName: "Scattered Retro Pearls",
    stylePrice: { bento: 15, medium: 30, large: 45 },
    disableText: false,
  },
  {
    id: "pearl-border-retro",
    name: "Pearl Border × Retro Decoration",
    description: "Three elegant pearl borders with a retro decoration",
    image: catalogPearlBorders,
    styleId: "pearl-border-retro",
    styleName: "Pearl Border × Retro Decoration",
    stylePrice: { bento: 25, medium: 50, large: 65 },
    disableText: false,
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

const CustomerCarousel = () => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: "left" | "right") => {
    if (!scrollRef.current) return;
    const scrollAmount = 320;
    scrollRef.current.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  };

  return (
    <div className="relative">
      <button
        onClick={() => scroll("left")}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-background/80 hover:bg-background rounded-full p-2 shadow-md -ml-4"
      >
        <ChevronLeft className="h-6 w-6 text-foreground" />
      </button>
      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto scrollbar-hide scroll-smooth px-4"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {customerPhotos.map((photo, index) => (
          <div
            key={index}
            className="flex-shrink-0 w-72 h-80 rounded-2xl overflow-hidden"
          >
            <img
              src={photo}
              alt={`Happy customer ${index + 1}`}
              className="w-full h-full object-cover"
            />
          </div>
        ))}
      </div>
      <button
        onClick={() => scroll("right")}
        className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-background/80 hover:bg-background rounded-full p-2 shadow-md -mr-4"
      >
        <ChevronRight className="h-6 w-6 text-foreground" />
      </button>
    </div>
  );
};

const Index = () => {
  const { addItem } = useCart();
  const [selectedCatalogCake, setSelectedCatalogCake] = useState<typeof catalog[0] | null>(null);
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

  const handleSelectCatalogCake = (cake: typeof catalog[0]) => {
    setSelectedCatalogCake(cake);
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
    if (!selectedCatalogCake) return 0;
    
    const sizeObj = sizes.find(s => s.id === selections.size);
    const shapeObj = shapes.find(s => s.id === selections.shape);
    const flavorObj = flavors.find(f => f.id === selections.flavor);
    
    const basePrice = sizeObj?.price || 40;
    const shapeExtra = shapeObj?.extraPrice[selections.size as keyof typeof shapeObj.extraPrice] || 0;
    const flavorExtra = flavorObj?.extraPrice[selections.size as keyof typeof flavorObj.extraPrice] || 0;
    const styleExtra = selectedCatalogCake.stylePrice[selections.size as keyof typeof selectedCatalogCake.stylePrice] || 0;
    
    return basePrice + shapeExtra + flavorExtra + styleExtra;
  };

  const handleAddToCart = () => {
    if (!selectedCatalogCake) return;
    
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
      style: selectedCatalogCake.styleId,
      styleName: selectedCatalogCake.styleName,
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
    setSelectedCatalogCake(null);
  };

  return (
    <Layout>
      {/* Hero Section */}
      <section className="relative text-primary-foreground overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${heroBg})` }}
        />
        <div className="absolute inset-0 bg-foreground/50" />
        <div className="relative container mx-auto px-4 py-24 md:py-32 text-center">
          <h1 className="font-serif text-4xl md:text-6xl lg:text-7xl font-light tracking-wide mb-6">
            NOT YOUR TRADITIONAL CAKES
          </h1>
          <p className="text-lg md:text-xl max-w-3xl mx-auto opacity-90 mb-10 font-light">
            Combining creativity and personalization to bring you unique cakes
            that are not only beautiful, but taste just as good.
          </p>
          <Button
            size="lg"
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-lg rounded-full font-medium tracking-wide"
            asChild
          >
            <Link to="/customize">Customize Your Cake</Link>
          </Button>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            {features.map((feature) => (
              <div key={feature.title} className="text-center">
                <img
                  src={feature.image}
                  alt={feature.title}
                  className="h-32 md:h-40 mx-auto mb-6 object-contain"
                />
                <h3 className="font-serif text-2xl md:text-3xl text-foreground mb-4">
                  {feature.title}
                </h3>
                <p className="text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sizes Section */}
      <section className="py-20 bg-cream">
        <div className="container mx-auto px-4">
          <h2 className="font-serif text-4xl md:text-5xl text-center text-foreground mb-16">
            SIZES
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {homeSizes.map((size) => (
              <div
                key={size.name}
                className="p-8 text-center shadow-sm rounded-2xl flex flex-col"
                style={{ backgroundColor: '#FFE4EC' }}
              >
                <img
                  src={size.image}
                  alt={size.name}
                  className="h-32 md:h-40 mx-auto mb-4 object-contain"
                />
                <h3 className="font-serif text-2xl text-foreground mb-4">
                  {size.name}
                </h3>
                <p className="text-muted-foreground mb-1">{size.size}</p>
                <p className="text-muted-foreground mb-4">{size.servings}</p>
                <p className="text-xl font-medium text-foreground mb-2">
                  {size.price}
                </p>
                <p className="text-sm text-primary mb-6">{size.extra}</p>
                <Link to="/customize">
                  <Button variant="outline" className="w-full rounded-full border-foreground text-foreground hover:bg-foreground hover:text-background">
                    Choose option
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Catalog Section */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4">
          <h2 className="font-serif text-4xl md:text-5xl text-center text-foreground mb-6">
            CATALOG
          </h2>
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
                    onClick={() => handleSelectCatalogCake(cake)}
                  >
                    Choose this style
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="text-center mt-12">
            <Link to="/catalog">
              <Button 
                variant="outline" 
                className="rounded-full border-foreground text-foreground hover:bg-foreground hover:text-background px-8"
              >
                See more
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Customers Section */}
      <section className="py-20 bg-cream">
        <div className="container mx-auto px-4">
          <h2 className="font-serif text-4xl md:text-5xl text-center text-foreground mb-16">
            OUR CUSTOMERS
          </h2>
          <CustomerCarousel />
        </div>
      </section>

      {/* Catalog Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-serif text-2xl">
              {selectedCatalogCake?.name}
            </SheetTitle>
            <SheetDescription>
              Customize your cake options
            </SheetDescription>
          </SheetHeader>
          
          {selectedCatalogCake && (
            <div className="mt-6 space-y-6">
              {/* Cake Image */}
              <div className="aspect-square rounded-lg overflow-hidden bg-muted/30">
                <img
                  src={selectedCatalogCake.image}
                  alt={selectedCatalogCake.name}
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
                    {sizes.filter((size) => selectedCatalogCake && size.id in selectedCatalogCake.stylePrice).map((size) => (
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

              {/* Text Toggle - hidden for printed-picture */}
              {!selectedCatalogCake?.disableText && (
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

              {/* Total Price */}
              <div className="flex justify-between items-center py-4 bg-secondary/50 rounded-lg px-4">
                <span className="font-medium text-foreground">Total</span>
                <span className="text-xl font-bold text-primary">
                  CHF {calculatePrice()}
                </span>
              </div>

              {/* Add to Cart Button */}
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

      {/* CTA Section */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4 text-center">
          <h2 className="font-serif text-3xl md:text-4xl text-foreground mb-6">
            Ready to create your perfect cake?
          </h2>
          <p className="text-muted-foreground mb-8 max-w-2xl mx-auto">
            Choose your size, shape, flavor, and extras to design a cake that's
            uniquely yours.
          </p>
          <Button
            size="lg"
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-lg rounded-none font-medium tracking-wide"
            asChild
          >
            <Link to="/customize">Customize Your Cake</Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-foreground text-primary-foreground py-12">
        <div className="container mx-auto px-4 text-center">
          <img
            src={logo}
            alt="Bento Cake Studio"
            className="h-16 mx-auto mb-6 brightness-200"
          />
          <p className="text-sm opacity-90 mb-4">
            © 2026 Bento Cake Studio SNC. All rights reserved.
          </p>
          <p className="text-sm opacity-70 mb-4">
            See our{" "}
            <Link to="/terms-and-conditions" className="underline hover:opacity-100">
              terms and conditions
            </Link>{" "}
            and{" "}
            <Link to="/privacy-policy" className="underline hover:opacity-100">
              privacy policy
            </Link>
            .
          </p>
          <p className="text-sm opacity-70 mb-6">
            <Link to="/newsletter" className="underline hover:opacity-100">
              Subscribe to newsletter
            </Link>
          </p>
          <p className="text-xs opacity-50">
            Website powered by{" "}
            <a 
              href="https://lovable.dev" 
              target="_blank" 
              rel="noopener noreferrer"
              className="underline hover:opacity-100"
            >
              Lovable
            </a>
          </p>
        </div>
      </footer>
    </Layout>
  );
};

export default Index;