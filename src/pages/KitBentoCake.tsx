import { useState, useMemo, useRef, useEffect } from "react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { format, addDays } from "date-fns";
import { CalendarIcon, Check, ShoppingCart, ChevronDown, ChevronUp, ChevronLeft } from "lucide-react";
import { useCart } from "@/context/CartContext";
import { NUMBER_CANDLE_ID, NUMBER_CANDLE_PRICE, NUMBER_CANDLE_DIGITS, priceCandleSelection, getSimpleCandleQty, changeSimpleCandleQty, upsertCandleSelection, removeCandleSelection } from "@/lib/candleCartHelpers";
import type { CandleSelection } from "@/context/CartContext";
import { ColorFamilyCandleCard, FAMILY_CANDLE_COLORS } from "@/components/ColorFamilyCandleCard";
import { useNavigate } from "react-router-dom";
import { AllergenDisplay, AllergenNotice } from "@/data/allergens";
import { FlavorDesc } from "@/data/flavorDesc";
import { toast } from "sonner";
import { useLang } from "@/context/LanguageContext";

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
import flavorTiramisu from "@/assets/flavor-tiramisu-new.png";
import flavorPraline from "@/assets/flavor-praline.png";
import flavorPistachio from "@/assets/flavor-pistachio.png";
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
import diyKitBox from "@/assets/diy-kit-box.jpg";

const BASE_PRICE = 40;

const shapes = [
  { id: "round", name: "Round", nameFr: "Rond", extraPrice: 0 },
  { id: "heart", name: "Heart", nameFr: "Cœur", extraPrice: 3 },
];

export const flavorCategories = [
  {
    name: "Standard Flavors",
    nameFr: "Parfums Standard",
    extraPrice: 0,
    flavors: [
      { id: "vanilla", name: "Vanilla", nameFr: "Vanilla", description: "Fluffy vanilla sponge with whipped cream", descriptionFr: "Génoise vanille moelleuse et crème fouettée", image: flavorVanilla },
      { id: "red-velvet", name: "Red Velvet", nameFr: "Red Velvet", description: "Fluffy vanilla and chocolate sponge with whipped cream", descriptionFr: "Génoise vanille et chocolat moelleuse et crème fouettée", image: flavorRedVelvet },
      { id: "chocolate", name: "Chocolate", nameFr: "Chocolate", description: "Fluffy chocolate sponge with whipped cream", descriptionFr: "Génoise chocolat moelleuse et crème fouettée", image: flavorChocolate },
    ],
  },
  {
    name: "Premium Flavors",
    nameFr: "Parfums Premium",
    extraPrice: 2,
    flavors: [
      { id: "chocolate-lovers", name: "Chocolate Lovers", nameFr: "Chocolate Lovers", description: "Moist chocolate sponge with rich chocolate ganache", descriptionFr: "Génoise chocolat moelleuse et riche ganache au chocolat", image: flavorChocolateLovers },
      { id: "dark-berrylicious", name: "Dark Berrylicious", nameFr: "Dark Berrylicious", description: "Fluffy chocolate sponge filled with a generous raspberry coulis and whipped cream", descriptionFr: "Génoise chocolat moelleuse garnie d'un généreux coulis de framboise et de crème fouettée", image: flavorDarkBerrylicious },
      { id: "white-berrylicious", name: "White Berrylicious", nameFr: "White Berrylicious", description: "Fluffy vanilla sponge filled with a generous raspberry coulis and whipped cream", descriptionFr: "Génoise vanille moelleuse garnie d'un généreux coulis de framboise et de crème fouettée", image: flavorWhiteBerrylicious },
      { id: "salted-caramel", name: "Salted Butter Caramel", nameFr: "Salted Butter Caramel", description: "Fluffy vanilla sponge filled with caramel and whipped cream", descriptionFr: "Génoise vanille moelleuse garnie de caramel et de crème fouettée", image: flavorSaltedCaramel },
      { id: "lemon-curd", name: "Lemon Curd", nameFr: "Lemon Curd", description: "Fluffy vanilla sponge filled with lemon curd and whipped cream", descriptionFr: "Génoise vanille moelleuse garnie de lemon curd et de crème fouettée", image: flavorLemonCurd },
    ],
  },
  {
    name: "Deluxe Flavors",
    nameFr: "Parfums Deluxe",
    extraPrice: 4,
    flavors: [
      { id: "chocolate-lover-berrylicious", name: "Chocolate Lover x Berrylicious", nameFr: "Chocolate Lover x Berrylicious", description: "Chocolate sponge with raspberry coulis and chocolate ganache", descriptionFr: "Génoise chocolat, coulis de framboise et ganache au chocolat", image: flavorChocolateLoverBerrylicious },
      { id: "tiramisu", name: "Tiramisu", nameFr: "Tiramisu", description: "Fluffy vanilla sponge filled with fresh coffee and whipped cream", descriptionFr: "Génoise vanille moelleuse garnie de café frais et de crème fouettée", image: flavorTiramisu },
      { id: "praline", name: "Praline Obsession", nameFr: "Praline Obsession", description: "Fluffy vanilla sponge filled with caramelised almond, hazelnut and whipped cream", descriptionFr: "Génoise vanille moelleuse garnie d'amandes et de noisettes caramélisées et de crème fouettée", image: flavorPraline },
      { id: "pistachio-lovers", name: "Pistachio Lovers", nameFr: "Pistachio Lovers", description: "Fluffy vanilla sponge filled with pistachio cream and whipped cream", descriptionFr: "Génoise vanille garnie de crème pistache et crème fouettée", image: flavorPistachio },
      { id: "passion-fruit", name: "Passion Fruit", nameFr: "Passion Fruit", description: "Fluffy vanilla sponge filled with fresh passion fruit curd and whipped cream", descriptionFr: "Génoise vanille moelleuse garnie de curd de fruit de la passion et de crème fouettée", image: flavorPassionFruit },
    ],
  },
];

// Separate export, NOT merged into `flavorCategories` — DotCakes.tsx imports
// that array directly with no filtering, so adding categories to it would
// silently make these new flavours selectable (and free, via its
// tierByCategory fallback) on Dot Cakes too.
export const glutenFreeFlavorCategories = [
  {
    name: "Gluten-Free Standard",
    nameFr: "Sans Gluten Standard",
    extraPrice: 0,
    flavors: [
      { id: "vanilla-gf", name: "Vanilla Gluten-Free", nameFr: "Vanilla Gluten-Free", description: "Fluffy gluten-free vanilla sponge with whipped cream", descriptionFr: "Génoise vanille sans gluten, moelleuse et crème fouettée", image: flavorVanilla },
      { id: "red-velvet-gf", name: "Red Velvet Gluten-Free", nameFr: "Red Velvet Gluten-Free", description: "Fluffy gluten-free vanilla and chocolate sponge with whipped cream", descriptionFr: "Génoise vanille et chocolat sans gluten, moelleuse et crème fouettée", image: flavorRedVelvet },
      { id: "chocolate-gf", name: "Chocolate Gluten-Free", nameFr: "Chocolate Gluten-Free", description: "Fluffy gluten-free chocolate sponge with whipped cream", descriptionFr: "Génoise chocolat sans gluten, moelleuse et crème fouettée", image: flavorChocolate },
    ],
  },

  {
    name: "Gluten-Free Premium",
    nameFr: "Sans Gluten Premium",
    extraPrice: 6,
    flavors: [
      { id: "chocolate-gf-berrylicious", name: "Chocolate GF × Berrylicious", nameFr: "Chocolate GF × Berrylicious", image: flavorDarkBerrylicious },
      { id: "vanilla-gf-berrylicious", name: "Vanilla GF × Berrylicious", nameFr: "Vanilla GF × Berrylicious", image: flavorWhiteBerrylicious },
      { id: "lemon-curd-gf", name: "Lemon Curd Gluten-free", nameFr: "Lemon Curd Gluten-free", image: flavorLemonCurd },
      { id: "chocolate-lovers-gf", name: "Chocolate Lovers Gluten-free", nameFr: "Chocolate Lovers Gluten-free", image: flavorChocolateLovers },
    ],
  },
  {
    name: "Gluten-Free Deluxe",
    nameFr: "Sans Gluten Deluxe",
    extraPrice: 8,
    flavors: [
      { id: "orange-blossom-gf", name: "Orange Blossom Gluten-free", nameFr: "Orange Blossom Gluten-free", image: flavorVanilla },
      { id: "pistachio-gf", name: "Pistachio Gluten-free", nameFr: "Pistachio Gluten-free", image: flavorPistachio },
      { id: "tiramisu-gf", name: "Tiramisu Gluten-free", nameFr: "Tiramisu Gluten-free", image: flavorTiramisu },
      { id: "passion-fruit-gf", name: "Passion Fruit Gluten-free", nameFr: "Passion Fruit Gluten-free", image: flavorPassionFruit },
      { id: "praline-gf", name: "Praline Gluten-free", nameFr: "Praline Gluten-free", image: flavorPraline },
    ],
  },
];

const baseColors = [
  { id: "white", name: "White", nameFr: "Blanc", color: "#FFFFFF" },
  { id: "cream", name: "Cream", nameFr: "Crème", color: "#FFF8E7" },
  { id: "pastel-pink", name: "Pastel Pink", nameFr: "Rose Pastel", color: "#FFE4EC" },
  { id: "pink", name: "Pink", nameFr: "Rose", color: "#FFC0CB" },
  { id: "dark-pink", name: "Dark Pink", nameFr: "Rose Foncé", color: "#DE4489" },
  { id: "dark-red", name: "Red", nameFr: "Rouge", color: "#CB2A1D" },
  { id: "burgundy", name: "Burgundy", nameFr: "Bordeaux", color: "#800020" },
  { id: "pastel-yellow", name: "Pastel Yellow", nameFr: "Jaune Pastel", color: "#FDFD96" },
  { id: "yellow", name: "Yellow", nameFr: "Jaune", color: "#FFD700" },
  { id: "pastel-orange", name: "Pastel Orange", nameFr: "Orange Pastel", color: "#F5BE6A" },
  { id: "orange", name: "Orange", nameFr: "Orange", color: "#EE7C3A" },
  { id: "mint-green", name: "Pastel Green", nameFr: "Vert Pastel", color: "#87C895" },
  { id: "green", name: "Green", nameFr: "Vert", color: "#429356" },
  { id: "forest-green", name: "Forest Green", nameFr: "Vert Forêt", color: "#14532D" },
  { id: "baby-blue", name: "Pastel Blue", nameFr: "Bleu Pastel", color: "#C7E4F8" },
  { id: "sky-blue", name: "Sky Blue", nameFr: "Bleu Ciel", color: "#70B8EC" },
  { id: "blue", name: "Blue", nameFr: "Bleu", color: "#3C88C9" },
  { id: "midnight-blue", name: "Midnight Blue", nameFr: "Bleu Nuit", color: "#122B6D" },
  { id: "lavender", name: "Lavender", nameFr: "Lavande", color: "#E6E6FA" },
  { id: "plum", name: "Plum", nameFr: "Prune", color: "#8E4585" },
  { id: "light-brown", name: "Light Brown", nameFr: "Brun Clair", color: "#C4A484" },
  { id: "dark-brown", name: "Dark Brown", nameFr: "Brun Foncé", color: "#654321" },
  { id: "black", name: "Black", nameFr: "Noir", color: "#000000" },
];

const pipingBagOptions = [
  { id: "2-bags", name: "2 Piping Bags", nameFr: "2 Poches à douille", count: 2, price: 0 },
  { id: "3-bags", name: "3 Piping Bags", nameFr: "3 Poches à douille", count: 3, price: 2 },
];

export const candles = [
  // Single ordered list (Blue Ombré, Thick Spiral, Shiny Spiral, Pastel Spiral, Rainbow, Pink Ombré, Daisy, Red Heart, then the rest)
  { id: "blue-ombre", name: "Blue Ombré", nameFr: "Ombré Bleu", image: candleBlueOmbre, unitPrice: 1, hasPack: true, packPrice: 5, packSize: 6 },
  { id: "thick-spiral", name: "Thick Spiral", nameFr: "Spirale Épaisse", image: candleThickSpiral, unitPrice: 2, hasPack: true, packPrice: 10, packSize: 6 },
  { id: "pink-gold-spiral", name: "Pink Gold Spiral", nameFr: "Spirale Or Rose", image: candleShinySpiral /* TODO: remplacer par une vraie photo produit */, unitPrice: 1, hasPack: true, packPrice: 5, packSize: 6 },
  { id: "silver-spiral", name: "Silver Spiral", nameFr: "Spirale Argent", image: candleShinySpiral /* TODO: remplacer par une vraie photo produit */, unitPrice: 1, hasPack: true, packPrice: 5, packSize: 6 },
  { id: "gold-spiral", name: "Gold Spiral", nameFr: "Spirale Or", image: candleShinySpiral /* TODO: remplacer par une vraie photo produit */, unitPrice: 1, hasPack: true, packPrice: 5, packSize: 6 },
  { id: "spiral-champagne", name: "Spiral Champagne", nameFr: "Spirale Champagne", image: candleShinySpiral /* TODO: remplacer par une vraie photo produit */, unitPrice: 1, hasPack: true, packPrice: 5, packSize: 6 },
  { id: "shiny-spiral", name: "Shiny Spiral", nameFr: "Spirale Brillante", image: candleShinySpiral, unitPrice: 1, hasPack: true, packPrice: 5, packSize: 6 },
  { id: "spiral-pastel", name: "Pastel Spiral", nameFr: "Spirale Pastel", image: candleSpiralPastel, unitPrice: 1, hasPack: true, packPrice: 5, packSize: 6 },
  { id: "rainbow", name: "Rainbow", nameFr: "Arc-en-ciel", image: candleRainbow, unitPrice: 1, hasPack: true, packPrice: 5, packSize: 6 },
  { id: "pink-ombre", name: "Pink Ombré", nameFr: "Ombré Rose", image: candlePinkOmbre, unitPrice: 1, hasPack: true, packPrice: 5, packSize: 6 },
  { id: "daisy", name: "Daisy", nameFr: "Marguerite", image: candleDaisy, unitPrice: 2, hasPack: false },
  { id: "heart", name: "Red Heart", nameFr: "Cœur Rouge", image: candleHeart, unitPrice: 2, hasPack: false },
  { id: "puppy", name: "Puppy", nameFr: "Chiot", image: candlePuppy, unitPrice: 2, hasPack: false },
  { id: "teddy-bear", name: "Teddy Bear", nameFr: "Ours en Peluche", image: candleTeddyBear, unitPrice: 2, hasPack: false },
  { id: "cherry", name: "Cherry", nameFr: "Cerise", image: candleCherry, unitPrice: 2, hasPack: false },
  { id: "ribbon", name: "Ribbon", nameFr: "Ruban", image: candleRibbon, unitPrice: 2, hasPack: false },
  { id: "soccer", name: "Footy Flame", nameFr: "Ballon de Foot", image: candleSoccer, unitPrice: 2, hasPack: false },
  { id: "pink-car", name: "Pink Car", nameFr: "Voiture Rose", image: candlePinkCar, unitPrice: 2, hasPack: false },
  { id: "red-car", name: "Red Car", nameFr: "Voiture Rouge", image: candleRedCar, unitPrice: 2, hasPack: false },
  { id: "blue-car", name: "Blue Car", nameFr: "Voiture Bleue", image: candleBlueCar, unitPrice: 2, hasPack: false },
  { id: "yellow-car", name: "Yellow Car", nameFr: "Voiture Jaune", image: candleYellowCar, unitPrice: 2, hasPack: false },
];

const tooltipTexts: Record<string, string> = {
  date: "Date required to schedule the preparation of your order (minimum 4 days in advance).",
  shape: "Choose the shape of your cake.",
  flavor: "Please select the flavour of your cake.",
  baseColor: "The base colour is essential to personalise your cake.",
  piping: "Choose the number of piping bags you would like with your cake.",
};

const tooltipTextsFr: Record<string, string> = {
  date: "Date requise pour planifier la préparation de votre commande (minimum 4 jours à l'avance).",
  shape: "Choisissez la forme de votre gâteau.",
  flavor: "Veuillez sélectionner le parfum de votre gâteau.",
  baseColor: "La couleur de base est essentielle pour personnaliser votre gâteau.",
  piping: "Choisissez le nombre de poches à douille que vous souhaitez avec votre gâteau.",
};

const KitBentoCake = () => {
  const { t } = useLang();
  const { addItem, cartOrderDate } = useCart();
  const navigate = useNavigate();

  const [orderDate, setOrderDate] = useState<Date | undefined>(() => (cartOrderDate ? new Date(cartOrderDate) : undefined));
  const [selectedShape, setSelectedShape] = useState("");
  const [selectedFlavor, setSelectedFlavor] = useState("");
  const [selectedPipingOption, setSelectedPipingOption] = useState("");
  const [pipingColors, setPipingColors] = useState<string[]>([]);
  const [candleSelections, setCandleSelections] = useState<CandleSelection[]>([]);
  const [numberCandleDigit, setNumberCandleDigit] = useState("0");
  const [showCartSheet, setShowCartSheet] = useState(false);
  const [showAllCandles, setShowAllCandles] = useState(false);
  const [showGlutenFreeFlavors, setShowGlutenFreeFlavors] = useState(false);
  const [step, setStep] = useState(1);

  const minDate = addDays(new Date(), 4);

  useEffect(() => {
    const option = pipingBagOptions.find(p => p.id === selectedPipingOption);
    if (option && pipingColors.length === option.count) {
    }
  }, [pipingColors, selectedPipingOption]);

  // Visibility flags
  const pipingComplete = (() => {
    const option = pipingBagOptions.find(p => p.id === selectedPipingOption);
    return !!selectedPipingOption && pipingColors.length === (option?.count || 0);
  })();

  const getFlavorCategoryPrice = () => {
    for (const category of flavorCategories) {
      if (category.flavors.some(f => f.id === selectedFlavor)) return category.extraPrice;
    }
    for (const category of glutenFreeFlavorCategories) {
      if (category.flavors.some(f => f.id === selectedFlavor)) return category.extraPrice;
    }
    return 0;
  };

  const getFlavorName = () => {
    for (const category of flavorCategories) {
      const flavor = category.flavors.find(f => f.id === selectedFlavor);
      if (flavor) return flavor.name;
    }
    for (const category of glutenFreeFlavorCategories) {
      const flavor = category.flavors.find(f => f.id === selectedFlavor);
      if (flavor) return flavor.name;
    }
    return "";
  };

  const getFlavorNameFr = () => {
    for (const category of flavorCategories) {
      const flavor = category.flavors.find(f => f.id === selectedFlavor);
      if (flavor) return flavor.nameFr;
    }
    for (const category of glutenFreeFlavorCategories) {
      const flavor = category.flavors.find(f => f.id === selectedFlavor);
      if (flavor) return flavor.nameFr;
    }
    return "";
  };

  const getShapePrice = () => shapes.find(s => s.id === selectedShape)?.extraPrice || 0;
  const getPipingPrice = () => pipingBagOptions.find(p => p.id === selectedPipingOption)?.price || 0;

  const getCandlePrice = (candleId: string) => {
    const entry = candleSelections.find(c => c.id === candleId);
    if (!entry) return 0;
    return priceCandleSelection(entry, candles.find(c => c.id === candleId), candleId === NUMBER_CANDLE_ID);
  };

  const getCandlesTotal = () => candleSelections.reduce((sum, entry) => sum + getCandlePrice(entry.id), 0);

  const totalPrice = useMemo(() => {
    return BASE_PRICE + getShapePrice() + getFlavorCategoryPrice() + getPipingPrice() + getCandlesTotal();
  }, [selectedShape, selectedFlavor, selectedPipingOption, candleSelections]);

  const handleCandleQtyChange = (candleId: string, delta: number) =>
    setCandleSelections(prev => changeSimpleCandleQty(prev, candleId, delta));

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
    return !!orderDate && !!selectedShape && !!selectedFlavor && pipingComplete;
  };

  const handleAddToCart = () => {
    /* Champ obligatoire manquant : message precis et retour au bon endroit */
    if (!orderDate) {
      toast.error(t("Please choose your pick-up date.", "Veuillez choisir votre date de retrait."));
      return;
    }
    if (!selectedShape) {
      toast.error(t("Please choose a shape.", "Veuillez choisir une forme."));
      return;
    }
    if (!selectedFlavor) {
      toast.error(t("Please choose a flavour.", "Veuillez choisir un parfum."));
      return;
    }
    if (!pipingComplete) {
      toast.error(t("Please choose your piping bags and their colours.", "Veuillez choisir vos poches à douille et leurs couleurs."));
      return;
    }
    if (!isFormComplete()) {
      toast.error(t("Please complete all required selections before proceeding.", "Veuillez compléter toutes les sélections requises avant de continuer."));
      return;
    }

    const pipingColorNames = pipingColors.map(id => baseColors.find(c => c.id === id)?.name || "").join(", ");
    const selectedCandles = candleSelections.map((c) =>
      c.id === NUMBER_CANDLE_ID ? { ...c, digit: numberCandleDigit } : c
    );

    const cartItem = {
      id: "",
      product: "diy_kit",
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
      baseColor: "",
      baseColorName: "",
      decorationColor: "",
      decorationColorName: "",
      cakeText: "",
      textColor: "",
      textColorName: "",
      extras: [`piping-${selectedPipingOption}`],
      extrasNames: [
        `${pipingBagOptions.find(p => p.id === selectedPipingOption)?.name}: ${pipingColorNames}`,
      ].filter(Boolean),
      ribbonColor: "",
      ribbonColorName: "",
      butterflyColor: "",
      butterflyColorName: "",
      candles: selectedCandles,
      comment: "",
      imageUrls: [],
      imageFiles: [],
      textStyle: "normal",
      total: totalPrice,
    };

    const added = addItem(cartItem);
    if (!added) {
      toast.error(t("This item's date doesn't match the rest of your cart. Please place a separate order.", "La date de cet article ne correspond pas au reste de votre panier. Merci de passer une commande séparée."));
      return;
    }
    setShowCartSheet(true);
  };

  const RequiredAsterisk = ({ tooltipKey }: { tooltipKey: string }) => (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-destructive ml-1 cursor-help">*</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {t(tooltipTexts[tooltipKey], tooltipTextsFr[tooltipKey])}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  // Candles split: packs first, then individual
  const packCandles = candles.filter(c => c.hasPack);
  const individualCandles = candles.filter(c => !c.hasPack);
  const INITIAL_CANDLES_SHOWN = 4;

  const goNext = () => {
    if (step === 1 && !orderDate) { toast.error(t("Please choose your pick-up date.", "Veuillez choisir votre date de retrait.")); return; }
    if (step === 2 && !selectedShape) { toast.error(t("Please choose a shape.", "Veuillez choisir une forme.")); return; }
    if (step === 3 && !selectedFlavor) { toast.error(t("Please choose a flavour.", "Veuillez choisir un parfum.")); return; }
    if (step === 4 && !pipingComplete) { toast.error(t("Please choose your piping bags and their colours.", "Veuillez choisir vos poches à douille et leurs couleurs.")); return; }
    setStep((s) => Math.min(s + 1, 6));
  };
  const goBack = () => { setStep((s) => Math.max(s - 1, 1)); };
  useEffect(() => { window.scrollTo({ top: 0, behavior: "smooth" }); }, [step]);

  const stepLabels = [t("Date","Date"), t("Shape","Forme"), t("Flavour","Parfum"), t("Piping","Poches"), t("Candles","Bougies"), t("Confirm","Confirmer")];

  return (
    <Layout>
      <div className="container mx-auto px-4 pt-12">
        <h1 className="font-sans text-4xl md:text-5xl text-center tracking-[0.105em] uppercase text-foreground mb-6 font-semibold">
          {t("DIY KIT", "DIY KIT")}
        </h1>
        <p className="text-center text-muted-foreground mb-4 max-w-2xl mx-auto">
          {t("A bento cake ready to decorate at home.", "Un bento cake prêt à décorer à la maison.")}
          <br />
          {t("Choose the flavour, shape and colours to create your own bento cake.", "Choisissez le parfum, la forme et les couleurs pour créer votre propre bento cake.")}
        </p>
        <p className="text-center text-muted-foreground mb-10 max-w-2xl mx-auto text-sm">
          {t("Starting from", "À partir de")} <span className="font-semibold text-foreground">CHF {BASE_PRICE}</span>
        </p>

        <div className="max-w-2xl mx-auto py-4 px-4">
          {/* Stepper */}
          <div className="flex items-start mb-10">
            {stepLabels.map((label, i) => {
              const num = i + 1;
              const isActive = step === num;
              const isDone = step > num;
              return (
                <div key={label} className="flex-1 flex flex-col items-center relative">
                  {i < stepLabels.length - 1 && (
                    <div className={cn("absolute top-[18px] left-1/2 w-full h-px transition-colors", isDone ? "bg-primary" : "bg-border")} />
                  )}
                  <div className={cn(
                    "w-9 h-9 flex items-center justify-center border transition-all relative z-10 text-sm font-semibold",
                    isActive && "bg-primary border-primary text-primary-foreground",
                    isDone && "bg-primary border-primary text-primary-foreground",
                    !isActive && !isDone && "bg-background border-border text-muted-foreground"
                  )}>
                    {isDone ? "✓" : num}
                  </div>
                  <span className={cn("text-[9px] font-semibold uppercase tracking-[0.12em] mt-1.5 text-center", (isActive || isDone) ? "text-primary" : "text-muted-foreground")}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* STEP 1: DATE */}
          {step === 1 && (
            <div className="space-y-6 max-w-2xl mx-auto">
              <h2 className="font-sans text-sm font-semibold uppercase tracking-[0.14em] text-foreground">
                {t("Choose Your Pickup Date", "Choisir votre date de retrait")}<span className="text-destructive ml-1">*</span>
              </h2>
              <p className="text-sm text-muted-foreground">{t("Minimum 4 days notice required.", "Un délai minimum de 4 jours est requis.")}</p>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" disabled={!!cartOrderDate}
                    className={cn("w-full max-w-xs justify-start text-left font-normal rounded-none px-3 text-sm", !orderDate && "text-muted-foreground", cartOrderDate && "opacity-60 cursor-not-allowed")}>
                    <CalendarIcon className="mr-2 h-4 w-4 flex-shrink-0" />
                    <span className="truncate">{orderDate ? format(orderDate, "PPP") : t("Select a date", "Choisir une date")}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={orderDate} onSelect={setOrderDate} disabled={(date) => date < minDate} initialFocus />
                </PopoverContent>
              </Popover>
              {cartOrderDate && (
                <p className="text-xs text-muted-foreground">
                  {t(`All items in this order will be prepared for ${format(new Date(cartOrderDate), "dd.MM.yyyy")}. To order for another date, please place a separate order.`,
                    `Tous les articles de cette commande seront préparés pour le ${format(new Date(cartOrderDate), "dd.MM.yyyy")}. Pour commander pour une autre date, veuillez passer une commande séparée.`)}
                </p>
              )}
              <div className="flex gap-3 pt-4">
                <Button onClick={goNext} className="bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-semibold uppercase tracking-[0.12em] rounded-none px-8 py-2.5">
                  {t("Next", "Suivant")} →
                </Button>
              </div>
            </div>
          )}

          {/* STEP 2: SHAPE */}
          {step === 2 && (
            <div className="space-y-6 max-w-2xl mx-auto">
              <h2 className="font-sans text-sm font-semibold uppercase tracking-[0.14em] text-foreground">
                {t("Choose Shape", "Choisir la forme")}<span className="text-destructive ml-1">*</span>
              </h2>
              <RadioGroup value={selectedShape} onValueChange={setSelectedShape} className="flex gap-6">
                {shapes.map((shape) => (
                  <div key={shape.id} className="flex items-center space-x-2">
                    <RadioGroupItem value={shape.id} id={`shape-${shape.id}`} />
                    <Label htmlFor={`shape-${shape.id}`} className="cursor-pointer">
                      {t(shape.name, shape.nameFr)} {shape.extraPrice > 0 && <span className="text-muted-foreground">(+CHF {shape.extraPrice})</span>}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={goBack} className="rounded-none border-border text-[11px] font-semibold uppercase tracking-[0.12em] px-6 py-2.5">← {t("Back","Retour")}</Button>
                <Button onClick={goNext} className="bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-semibold uppercase tracking-[0.12em] rounded-none px-8 py-2.5">{t("Next","Suivant")} →</Button>
              </div>
            </div>
          )}

          {/* STEP 3: FLAVOUR */}
          {step === 3 && (
            <div className="space-y-6 max-w-2xl mx-auto">
              <h2 className="font-sans text-sm font-semibold uppercase tracking-[0.14em] text-foreground">
                {t("Choose Flavour", "Choisir le parfum")}<span className="text-destructive ml-1">*</span>
              </h2>
              {flavorCategories.map((category) => (
                <div key={category.name} className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    {t(category.name.replace("Flavors","Flavours"), category.nameFr)}
                    {category.extraPrice > 0 && <span className="text-muted-foreground ml-2 font-normal">(+CHF {category.extraPrice})</span>}
                  </h3>
                  <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
                    {category.flavors.map((flavor) => (
                      <div key={flavor.id}
                        className={cn("bg-card rounded-none overflow-hidden shadow-sm hover:shadow-lg transition-shadow cursor-pointer", selectedFlavor === flavor.id && "ring-2 ring-primary")}
                        onClick={() => setSelectedFlavor(flavor.id)}>
                        <div className="aspect-square overflow-hidden bg-muted/30 p-2">
                          <img src={flavor.image} alt={t(flavor.name, flavor.nameFr)} className="w-full h-full object-contain" />
                        </div>
                        <div className="p-3 text-center">
                          <p className="font-sans font-medium text-sm tracking-[0.105em]">{t(flavor.name, flavor.nameFr)}</p>
                          <FlavorDesc flavorId={flavor.id} />
                          <AllergenDisplay flavorId={flavor.id} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => setShowGlutenFreeFlavors(v => !v)}
                className="flex items-center gap-2 text-sm font-semibold text-primary uppercase tracking-[0.08em] py-2 hover:underline">
                <ChevronDown className={cn("w-4 h-4 transition-transform", showGlutenFreeFlavors && "rotate-180")} />
                {showGlutenFreeFlavors ? t("Hide gluten-free flavours","Masquer les parfums sans gluten") : t("See all gluten-free flavours","Voir les parfums sans gluten")}
              </button>
              {showGlutenFreeFlavors && glutenFreeFlavorCategories.map((category) => (
                <div key={category.name} className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    {t(category.name.replace("Flavors","Flavours"), category.nameFr)}
                    {category.extraPrice > 0 && <span className="text-muted-foreground ml-2 font-normal">(+CHF {category.extraPrice})</span>}
                  </h3>
                  <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
                    {category.flavors.map((flavor) => (
                      <div key={flavor.id}
                        className={cn("bg-card rounded-none overflow-hidden shadow-sm hover:shadow-lg transition-shadow cursor-pointer", selectedFlavor === flavor.id && "ring-2 ring-primary")}
                        onClick={() => setSelectedFlavor(flavor.id)}>
                        <div className="aspect-square overflow-hidden bg-muted/30 p-2">
                          <img src={flavor.image} alt={t(flavor.name, flavor.nameFr)} className="w-full h-full object-contain" />
                        </div>
                        <div className="p-3 text-center">
                          <p className="font-sans font-medium text-sm tracking-[0.105em]">{t(flavor.name, flavor.nameFr)}</p>
                          <AllergenDisplay flavorId={flavor.id} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <AllergenNotice className="pt-2" />
              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={goBack} className="rounded-none border-border text-[11px] font-semibold uppercase tracking-[0.12em] px-6 py-2.5">← {t("Back","Retour")}</Button>
                <Button onClick={goNext} className="bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-semibold uppercase tracking-[0.12em] rounded-none px-8 py-2.5">{t("Next","Suivant")} →</Button>
              </div>
            </div>
          )}

          {/* STEP 4: PIPING */}
          {step === 4 && (
            <div className="space-y-6 max-w-2xl mx-auto">
              <div>
                <h2 className="font-sans text-sm font-semibold uppercase tracking-[0.14em] text-foreground mb-1">
                  {t("Choose Piping Bags","Choisir les poches à douille")}<span className="text-destructive ml-1">*</span>
                </h2>
                <p className="text-sm text-muted-foreground">{t("The piping bag is a pastry bag filled with buttercream, used to decorate your cake.","La poche à douille est une poche remplie de crème au beurre, utilisée pour décorer votre gâteau.")}</p>
              </div>
              <RadioGroup value={selectedPipingOption} onValueChange={(val) => { setSelectedPipingOption(val); setPipingColors([]); }} className="flex gap-6">
                {pipingBagOptions.map((option) => (
                  <div key={option.id} className="flex items-center space-x-2">
                    <RadioGroupItem value={option.id} id={option.id} />
                    <Label htmlFor={option.id} className="cursor-pointer">
                      {t(option.name, option.nameFr)} <span className="text-muted-foreground">(CHF {option.price})</span>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
              {selectedPipingOption && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {t("Select","Sélectionnez")} {pipingBagOptions.find(p => p.id === selectedPipingOption)?.count} {t("colours for your piping bags","couleurs pour vos poches à douille")}
                    {" "}({pipingColors.length}/{pipingBagOptions.find(p => p.id === selectedPipingOption)?.count})
                  </p>
                  <div className="grid grid-cols-4 md:grid-cols-6 gap-3">
                    {baseColors.map((color) => (
                      <button key={color.id} onClick={() => handlePipingColorToggle(color.id)}
                        className={cn("flex flex-col items-center gap-2 p-2 transition-all relative", pipingColors.includes(color.id) && "ring-2 ring-primary bg-secondary")}>
                        <div className="w-10 h-10 rounded-full border-2 border-border shadow-sm relative" style={{ backgroundColor: color.color }}>
                          {pipingColors.includes(color.id) && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <Check className={cn("w-5 h-5", color.id === "white" || color.id === "cream" || color.id === "pastel-yellow" ? "text-foreground" : "text-white")} />
                            </div>
                          )}
                        </div>
                        <span className="text-xs text-center">{t(color.name, color.nameFr)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={goBack} className="rounded-none border-border text-[11px] font-semibold uppercase tracking-[0.12em] px-6 py-2.5">← {t("Back","Retour")}</Button>
                <Button onClick={goNext} className="bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-semibold uppercase tracking-[0.12em] rounded-none px-8 py-2.5">{t("Next","Suivant")} →</Button>
              </div>
            </div>
          )}

          {/* STEP 5: CANDLES */}
          {step === 5 && (
            <div className="space-y-6 max-w-2xl mx-auto">
              <h2 className="font-sans text-sm font-semibold uppercase tracking-[0.14em] text-foreground">
                {t("Add Candles (Optional)","Ajouter des bougies (optionnel)")}
              </h2>
              <div className="flex flex-wrap justify-center gap-4">
                {candles.slice(0, showAllCandles ? undefined : INITIAL_CANDLES_SHOWN).map((candle) => {
                  const family = FAMILY_CANDLE_COLORS[candle.id];
                  if (family) {
                    return (
                      <div key={candle.id} className="w-40 sm:w-48 min-w-0">
                        <ColorFamilyCandleCard candle={candle} colors={family}
                          existing={candleSelections.find((c) => c.id === candle.id)}
                          onCommit={(entry) => setCandleSelections((prev) => upsertCandleSelection(prev, entry))}
                          onRemove={() => setCandleSelections((prev) => removeCandleSelection(prev, candle.id))}
                          imageClassName="h-56 w-56" compact />
                      </div>
                    );
                  }
                  const qty = getSimpleCandleQty(candleSelections, candle.id);
                  const price = getCandlePrice(candle.id);
                  const hasPackApplied = candle.packSize && qty >= candle.packSize;
                  return (
                    <div key={candle.id} className="w-40 sm:w-48 min-w-0">
                      <Card className={cn("flex flex-col overflow-hidden w-full bg-white/60 hover:bg-white/80 transition-all border-0 shadow-none", qty > 0 && "ring-2 ring-primary")}>
                        <div className="flex items-center justify-center bg-secondary/20 p-2">
                          <img src={candle.image} alt={t(candle.name, candle.nameFr)} className="h-56 w-56 object-contain" />
                        </div>
                        <CardContent className="p-2 text-center">
                          <h3 className="font-medium text-foreground text-xs mb-0.5">{t(candle.name, candle.nameFr)}</h3>
                          {candle.hasPack ? (
                            <p className="text-[10px] text-muted-foreground mb-1">CHF {candle.unitPrice}/pièce · Pack {candle.packSize}: CHF {candle.packPrice}</p>
                          ) : (
                            <p className="text-[10px] text-muted-foreground mb-1.5">CHF {candle.unitPrice} / pièce</p>
                          )}
                          <div className="flex items-center justify-center gap-1.5 mb-1">
                            <button onClick={() => handleCandleQtyChange(candle.id, -1)} disabled={qty === 0}
                              className={cn("w-6 h-6 rounded-none flex items-center justify-center text-xs font-bold transition-all", qty === 0 ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-primary text-primary-foreground hover:bg-primary/90")}>−</button>
                            <span className="w-5 text-center font-medium text-foreground text-sm">{qty}</span>
                            <button onClick={() => handleCandleQtyChange(candle.id, 1)}
                              className="w-6 h-6 rounded-none bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold hover:bg-primary/90 transition-all">+</button>
                          </div>
                          {qty > 0 && candle.hasPack && (
                            <p className={cn("text-[10px] font-medium", hasPackApplied ? "text-green-700" : "text-muted-foreground")}>
                              {hasPackApplied ? `✓ ${t("Pack price applied","Prix pack appliqué")}, CHF ${price}` : `CHF ${price}`}
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  );
                })}
                <div className="w-40 sm:w-48 min-w-0">
                  <Card className={cn("flex flex-col overflow-hidden w-full bg-white/60 hover:bg-white/80 transition-all", getSimpleCandleQty(candleSelections, NUMBER_CANDLE_ID) > 0 && "ring-2 ring-primary")}>
                    <div className="h-56 flex items-center justify-center bg-secondary/20 p-2">
                      <span className="text-6xl font-bold text-primary" aria-hidden="true">{numberCandleDigit}</span>
                    </div>
                    <CardContent className="p-2 text-center">
                      <h3 className="font-medium text-foreground text-xs mb-0.5">{t("Number Candle","Bougie chiffre")}</h3>
                      <p className="text-[10px] text-muted-foreground mb-1.5">CHF {NUMBER_CANDLE_PRICE} / pièce</p>
                      <Select value={numberCandleDigit} onValueChange={setNumberCandleDigit}>
                        <SelectTrigger className="h-7 text-xs mb-1.5"><SelectValue /></SelectTrigger>
                        <SelectContent>{NUMBER_CANDLE_DIGITS.map((digit) => <SelectItem key={digit} value={digit}>{digit}</SelectItem>)}</SelectContent>
                      </Select>
                      <div className="flex items-center justify-center gap-1.5 mb-1">
                        <button onClick={() => handleCandleQtyChange(NUMBER_CANDLE_ID, -1)} disabled={getSimpleCandleQty(candleSelections, NUMBER_CANDLE_ID) === 0}
                          className={cn("w-6 h-6 rounded-none flex items-center justify-center text-xs font-bold transition-all", getSimpleCandleQty(candleSelections, NUMBER_CANDLE_ID) === 0 ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-primary text-primary-foreground hover:bg-primary/90")}>−</button>
                        <span className="w-5 text-center font-medium text-foreground text-sm">{getSimpleCandleQty(candleSelections, NUMBER_CANDLE_ID)}</span>
                        <button onClick={() => handleCandleQtyChange(NUMBER_CANDLE_ID, 1)}
                          className="w-6 h-6 rounded-none bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold hover:bg-primary/90 transition-all">+</button>
                      </div>
                      {getSimpleCandleQty(candleSelections, NUMBER_CANDLE_ID) > 0 && (
                        <p className="text-[10px] text-primary font-medium">CHF {getCandlePrice(NUMBER_CANDLE_ID)}</p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
              <button onClick={() => setShowAllCandles(!showAllCandles)}
                className="w-full flex items-center justify-center gap-1 text-sm text-primary font-medium py-2 hover:underline">
                {showAllCandles ? <>{t("See less","Voir moins")} <ChevronUp className="w-4 h-4" /></> : <>{t("See more candles","Voir plus de bougies")} <ChevronDown className="w-4 h-4" /></>}
              </button>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={goBack} className="rounded-none border-border text-[11px] font-semibold uppercase tracking-[0.12em] px-6 py-2.5">← {t("Back","Retour")}</Button>
                <Button onClick={goNext} className="bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-semibold uppercase tracking-[0.12em] rounded-none px-8 py-2.5">{t("Review order","Vérifier la commande")} →</Button>
              </div>
            </div>
          )}

          {/* STEP 6: CONFIRM */}
          {step === 6 && orderDate && (
            <div className="space-y-6 max-w-2xl mx-auto">
              <h2 className="font-sans text-sm font-semibold uppercase tracking-[0.14em] text-foreground">
                {t("Review & Confirm","Vérifier et confirmer")}
              </h2>
              <div className="border border-border divide-y divide-border">
                <div className="flex justify-between px-4 py-3 text-sm">
                  <span className="text-muted-foreground">{t("Date","Date")}</span>
                  <span className="font-medium">{format(orderDate, "PPP")}</span>
                </div>
                <div className="flex justify-between px-4 py-3 text-sm">
                  <span className="text-muted-foreground">{t("Shape","Forme")}</span>
                  <span className="font-medium">{t(shapes.find(s => s.id === selectedShape)?.name || "", shapes.find(s => s.id === selectedShape)?.nameFr || "")}</span>
                </div>
                <div className="flex justify-between px-4 py-3 text-sm">
                  <span className="text-muted-foreground">{t("Flavour","Parfum")}</span>
                  <span className="font-medium">{t(getFlavorName(), getFlavorNameFr())}</span>
                </div>
                <div className="flex justify-between px-4 py-3 text-sm">
                  <span className="text-muted-foreground">{t("Piping","Poches à douille")}</span>
                  <span className="font-medium">{t(pipingBagOptions.find(p => p.id === selectedPipingOption)?.name || "", pipingBagOptions.find(p => p.id === selectedPipingOption)?.nameFr || "")} · {pipingColors.map(id => { const c = baseColors.find(c => c.id === id); return c ? t(c.name, c.nameFr) : ""; }).join(", ")}</span>
                </div>
                {getCandlesTotal() > 0 && (
                  <div className="flex justify-between px-4 py-3 text-sm">
                    <span className="text-muted-foreground">{t("Candles","Bougies")}</span>
                    <span className="font-medium">CHF {getCandlesTotal().toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between px-4 py-3">
                  <span className="text-sm font-semibold uppercase tracking-[0.08em]">{t("Total","Total")}</span>
                  <span className="font-semibold">CHF {totalPrice}</span>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={goBack} className="rounded-none border-border text-[11px] font-semibold uppercase tracking-[0.12em] px-6 py-2.5">← {t("Edit","Modifier")}</Button>
                <Button onClick={handleAddToCart} className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] rounded-none">
                  {t("ADD TO BASKET","AJOUTER AU PANIER")}
                </Button>
              </div>
            </div>
          )}

          {/* DIY Kit image */}
          <div className="pt-12 pb-8">
            <img src={diyKitBox} alt={t("Bento Cake Studio DIY kit","Kit DIY Bento Cake Studio")} loading="lazy" className="w-full max-w-md mx-auto" />
          </div>
        </div>
      </div>

      {/* Cart Confirmation Sheet */}
      <Sheet open={showCartSheet} onOpenChange={setShowCartSheet}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t("Your order has been added to the cart!","Votre commande a été ajoutée au panier !")}</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <div className="bg-secondary/50 p-4 space-y-2">
              <p><strong>{t("DIY Kit","Kit DIY")}</strong></p>
              <p className="text-sm text-muted-foreground">{t("Date:","Date :")} {orderDate ? format(orderDate, "dd.MM.yyyy") : ""}</p>
              <p className="text-sm text-muted-foreground">{t("Shape:","Forme :")} {t(shapes.find(s => s.id === selectedShape)?.name || "", shapes.find(s => s.id === selectedShape)?.nameFr || "")}</p>
              <p className="text-sm text-muted-foreground">{t("Flavour:","Parfum :")} {t(getFlavorName(), getFlavorNameFr())}</p>
              <p className="text-sm text-muted-foreground">
                {t("Piping:","Poches à douille :")} {t(pipingBagOptions.find(p => p.id === selectedPipingOption)?.name || "", pipingBagOptions.find(p => p.id === selectedPipingOption)?.nameFr || "")} - {pipingColors.map(id => { const c = baseColors.find(c => c.id === id); return c ? t(c.name, c.nameFr) : ""; }).join(", ")}
              </p>
              <p className="text-lg font-semibold mt-4">{t("Total:","Total :")} CHF {totalPrice}</p>
            </div>
            <div className="flex flex-col gap-3">
              <Button onClick={() => navigate("/cart")}>{t("View Cart","Voir le panier")}</Button>
              <Button variant="outline" onClick={() => { setShowCartSheet(false); navigate("/"); }}>{t("Continue Shopping","Continuer vos achats")}</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </Layout>
  );
};

export default KitBentoCake;
